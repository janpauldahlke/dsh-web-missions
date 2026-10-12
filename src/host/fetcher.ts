import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FetchedPage, PageFetcher, PageQuality } from '../shared/types'

/**
 * C3 — Browser39Fetcher, the v0 PageFetcher implementation (DESIGN.md §C3).
 *
 * Transport: `browser39 batch` JSONL (review #4, Eris-proven). One batch
 * invocation per fetch: write a one-line commands.jsonl, spawn
 * `browser39 batch <in> --output <out>`, read the result line. One-shot
 * `fetch` is rejected — consent (C10, M5) needs the batch action protocol.
 *
 * Contract pinned by the 2.0.0 probe (M2 board, slice 2.1):
 *  - result line `url` = FINAL post-redirect URL
 *  - HTTP 4xx/5xx → `ok:true` line with `status` (NOT an error line)
 *  - `ok:false` line → {error, code, retryable} (INVALID_URL, HTTP_ERROR, …)
 *  - output file is APPENDED by browser39 → unlink before spawn
 *  - `show_selectors_first` defaults true in 2.0.0 → set false for raw content
 *  - `links[].href` is relative → resolve against the final URL
 *  - batch sessions are always in-memory (no disk persistence)
 */

/** v0 CMP marker list (D-M2.5); named constant, amended in the M2 board when it misfires. */
export const CMP_MARKERS = [
  'cookie',
  'consent',
  'datenschutz',
  'akzeptieren',
  'accept all',
  'alle akzeptieren',
] as const

/** Hand-set defaults (ENV.md; no UI surface until M6+). */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000
export const DEFAULT_THIN_THRESHOLD_CHARS = 300
/** CMP marker scan scope: title + first N chars of content. */
const CMP_SCAN_CHARS = 500

/** Error classes surface in the C4 receipt envelope (`<class>: <message>`). */
export class FetchError extends Error {
  constructor(
    readonly code: 'fetch_failed' | 'spawn_failed',
    message: string,
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

export interface FetcherConfig {
  /** Per-spawn wall-clock timeout (default 30 000 ms). */
  fetchTimeoutMs: number
  /** `thin` threshold: content length below this (default 300). */
  thinThresholdChars: number
  /** Explicit browser39 binary (BROWSER39_BIN equivalent). */
  browser39Bin?: string
}

export interface Browser39Bin {
  cmd: string
  args: string[]
}

/**
 * Binary resolution order (S1 flipped, 2026-10-12):
 *   1. explicit `browser39Bin` / `BROWSER39_BIN` env (escape hatch),
 *   2. plugin's own node_modules: require.resolve package → dir → bin.js,
 *      spawned as `node <bin.js> …` (deterministic; no exec-bit/PATH dependence),
 *   3. `browser39` on PATH (global installs, legacy Eris box).
 * `null` = missing everywhere → caller raises `spawn_failed`.
 */
export function resolveBrowser39Bin(explicit?: string): Browser39Bin | null {
  const envBin = explicit ?? process.env.BROWSER39_BIN
  if (envBin && envBin.trim() !== '') return { cmd: envBin.trim(), args: [] }

  try {
    const require = createRequire(import.meta.url)
    const pkgJson = require.resolve('@aquintanar/browser39/package.json')
    const binJs = join(dirname(pkgJson), 'bin.js')
    if (existsSync(binJs)) return { cmd: process.execPath, args: [binJs] }
  } catch {
    // not resolvable from this bundle location — fall through to PATH
  }

  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'browser39')
    try {
      if (statSync(candidate).mode & 0o111) return { cmd: candidate, args: [] }
    } catch {
      // missing — keep looking
    }
  }
  return null
}

/**
 * Deterministic quality label (S7: the label is OURS).
 *   blocked: HTTP 4xx/5xx, or zero content
 *   thin:    content < thinThresholdChars, or CMP marker in title + first 500 chars
 *   full:    otherwise
 */
export function assessQuality(opts: {
  status: number
  title: string
  content: string
  thinThresholdChars: number
}): { quality: PageQuality; qualitySignals: string[] } {
  const { status, title, content, thinThresholdChars } = opts
  if (status >= 400) {
    return { quality: 'blocked', qualitySignals: [`http-${status}`] }
  }
  if (content.trim() === '') {
    return { quality: 'blocked', qualitySignals: ['empty-content'] }
  }
  const signals: string[] = []
  if (content.length < thinThresholdChars) {
    signals.push(`text<${thinThresholdChars}chars`)
  }
  const scan = `${title} ${content.slice(0, CMP_SCAN_CHARS)}`.toLowerCase()
  for (const marker of CMP_MARKERS) {
    if (scan.includes(marker)) signals.push(`cmp-marker:${marker}`)
  }
  if (signals.length > 0) return { quality: 'thin', qualitySignals: signals }
  return { quality: 'full', qualitySignals: [] }
}

interface B39ResultLine {
  id?: string
  ok?: boolean
  seq?: number
  url?: string
  title?: string
  status?: number
  markdown?: string
  links?: { i?: number; text?: string; href?: string }[]
  meta?: { lang?: string; description?: string; content_type?: string }
  stats?: { fetch_ms?: number; tokens_est?: number; content_bytes?: number }
  truncated?: boolean
  next_offset?: number | null
  error?: string
  code?: string
  retryable?: boolean
}

function tail(s: string, max = 200): string {
  const t = s.trim()
  return t.length > max ? `…${t.slice(-max)}` : t
}

export class Browser39Fetcher implements PageFetcher {
  constructor(
    private readonly config: Partial<FetcherConfig> = {},
  ) {}

  private get timeoutMs(): number {
    return this.config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  }

  private get thinThresholdChars(): number {
    return this.config.thinThresholdChars ?? DEFAULT_THIN_THRESHOLD_CHARS
  }

  async fetch(
    url: string,
    opts?: { signal?: AbortSignal; sessionKey?: string },
  ): Promise<FetchedPage> {
    // sessionKey is schema-stable now; C7/M5 owns its use (consent re-injection).
    const bin = resolveBrowser39Bin(this.config.browser39Bin)
    if (!bin) {
      throw new FetchError(
        'spawn_failed',
        'browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH)',
      )
    }

    const workdir = mkdtempSync(join(tmpdir(), 'web-missions-b39-'))
    const inPath = join(workdir, 'commands.jsonl')
    const outPath = join(workdir, 'results.jsonl')
    try {
      writeFileSync(
        inPath,
        `${JSON.stringify({
          id: 'f1',
          action: 'fetch',
          v: 1,
          seq: 1,
          url,
          options: {
            include_links: true,
            strip_nav: true,
            // 2.0.0 defaults show_selectors_first=true (stub pages); we want the raw page.
            show_selectors_first: false,
          },
        })}\n`,
      )
      // browser39 APPENDS to the output file — start clean.
      try {
        unlinkSync(outPath)
      } catch {
        // fresh tempdir; nothing to unlink
      }

      const line = await this.spawnBatch(bin, inPath, outPath, opts?.signal)

      if (line.ok === false) {
        throw new FetchError(
          'fetch_failed',
          `browser39 rejected fetch: ${line.error ?? 'unknown error'} (code: ${line.code ?? 'unknown'})`,
        )
      }
      if (line.ok !== true) {
        throw new FetchError('fetch_failed', 'malformed browser39 result line (no ok flag)')
      }
      return this.toFetchedPage(url, line)
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  }

  private spawnBatch(
    bin: Browser39Bin,
    inPath: string,
    outPath: string,
    signal?: AbortSignal,
  ): Promise<B39ResultLine> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(bin.cmd, [...bin.args, 'batch', inPath, '--output', outPath], {
          cwd: dirname(inPath),
          stdio: ['ignore', 'ignore', 'pipe'],
          // New process group so timeout/abort kills the whole tree (bin.js
          // execFileSyncs the platform binary as its child).
          detached: true,
        })
      } catch (e) {
        reject(
          new FetchError('spawn_failed', `browser39 spawn failed: ${(e as Error).message}`),
        )
        return
      }

      let stderrBuf = ''
      let settled = false
      const finish = (err: Error | null, line?: B39ResultLine): void => {
        if (settled) return
        settled = true
        if (err) reject(err)
        else resolve(line as B39ResultLine)
      }

      const timer = setTimeout(() => {
        this.killChild(child)
        finish(
          new FetchError(
            'fetch_failed',
            `browser39 spawn timed out after ${this.timeoutMs} ms`,
          ),
        )
      }, this.timeoutMs)

      const onAbort = (): void => {
        this.killChild(child)
        finish(new FetchError('fetch_failed', 'fetch aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      child.stderr?.on('data', (d: Buffer) => {
        stderrBuf = (stderrBuf + d.toString()).slice(-2000)
      })
      child.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        finish(
          new FetchError(
            'spawn_failed',
            e.code === 'ENOENT'
              ? `browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH): ${tail(e.message)}`
              : `browser39 spawn failed: ${tail(e.message)}`,
          ),
        )
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        let lines: B39ResultLine[] = []
        try {
          const raw = readFileSync(outPath, 'utf8')
          lines = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => JSON.parse(l) as B39ResultLine)
        } catch (e) {
          finish(
            new FetchError(
              'fetch_failed',
              `browser39 produced no parseable results (exit ${code}): ${tail(stderrBuf)}`,
            ),
          )
          return
        }
        // Single command per batch; match by id, fall back to the first line.
        const line = lines.find((l) => l.id === 'f1') ?? lines[0]
        if (!line) {
          finish(
            new FetchError(
              'fetch_failed',
              `browser39 produced no result line (exit ${code}): ${tail(stderrBuf)}`,
            ),
          )
          return
        }
        finish(null, line)
      })
    })
  }

  private killChild(child: ReturnType<typeof spawn>): void {
    try {
      if (child.pid !== undefined) {
        // Kill the whole process group (bin.js shims execFileSync the platform binary).
        process.kill(-child.pid, 'SIGKILL')
        return
      }
    } catch {
      // not a group leader (or already dead) — fall through
    }
    try {
      child.kill('SIGKILL')
    } catch {
      // already dead
    }
  }

  private toFetchedPage(requestedUrl: string, line: B39ResultLine): FetchedPage {
    const finalUrl = line.url ?? requestedUrl
    const content = line.markdown ?? ''
    const status = typeof line.status === 'number' ? line.status : 0

    const links: { url: string; text: string }[] = []
    for (const l of line.links ?? []) {
      if (typeof l.href !== 'string' || l.href === '') continue
      try {
        const absolute = new URL(l.href, finalUrl).toString()
        if (!/^(?:https?):$/.test(new URL(absolute).protocol)) continue
        links.push({ url: absolute, text: l.text ?? '' })
      } catch {
        // unresolvable href — skip
      }
    }

    const byteLength =
      typeof line.stats?.content_bytes === 'number'
        ? line.stats.content_bytes
        : Buffer.byteLength(content, 'utf8')

    const { quality, qualitySignals } = assessQuality({
      status,
      title: line.title ?? '',
      content,
      thinThresholdChars: this.thinThresholdChars,
    })

    return {
      url: requestedUrl,
      finalUrl,
      status,
      contentType: line.meta?.content_type ?? '',
      title: line.title ?? '',
      content,
      links,
      byteLength,
      fetchedAt: new Date().toISOString(),
      quality,
      qualitySignals,
      consentAttempted: false,
      consentImproved: false,
    }
  }
}
