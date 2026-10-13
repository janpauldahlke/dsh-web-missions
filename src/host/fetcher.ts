import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ConsentAttempt, FetchedPage, PageFetcher, PageQuality } from '../shared/types'
import { DEFAULT_MAX_BYTES } from './config.ts'
import { ensureSessionDir, sessionsRoot } from './sessions.ts'

/**
 * C3 — Browser39Fetcher, the v0 PageFetcher implementation (DESIGN.md §C3).
 *
 * Transport: `browser39 watch` JSONL (5.4, D-M5.9 — was `batch`, review #4).
 * One managed `watch` process per fetch: write the command line(s) BEFORE
 * spawn (watch processes pre-existing lines at startup — no startup race),
 * spawn `browser39 watch <in> --output <out>`, poll the output file for the
 * result line, then SIGTERM the process group (session-save flush) and
 * unlink the tempdir. One-shot `fetch` is rejected — consent (C10, 5.5)
 * needs the multi-command session protocol.
 *
 * Sessions (5.4, C7): `persistSessions` (config, default on) + a sessionKey
 * (C3: lowercased hostname, no port) → `--config
 * <~/.dsh/browser39/sessions/<host>/config.toml>` (created if absent,
 * sessions.ts), so cookies persist to a per-host `session.enc` shared across
 * missions and projects. `persistSessions: false` or no sessionKey →
 * `--no-persist` (forced in-memory).
 *
 * Contract pinned by the 2.0.0 probe (M2 board, slice 2.1):
 *  - result line `url` = FINAL post-redirect URL
 *  - HTTP 4xx/5xx → `ok:true` line with `status` (NOT an error line)
 *  - `ok:false` line → {error, code, retryable} (INVALID_URL, HTTP_ERROR, …)
 *  - output file is APPENDED by browser39 → start from a clean file
 *  - `show_selectors_first` defaults true in 2.0.0 → set false for raw content
 *  - `links[].href` is relative → resolve against the final URL
 *  - one-shot `fetch`/`batch` are ALWAYS in-memory (2.0.0 docs) — persistence
 *    requires `watch`/`mcp`; hence the transport amendment (D-M5.9)
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

/** A browser39 JSONL command (one line of the input file). */
export interface B39Command {
  id: string
  action: string
  [key: string]: unknown
}

/**
 * C10 (M5 5.5): the best-effort element click. JSON.stringify embeds the
 * label safely (no script injection). Matches trimmed text, case-insensitive,
 * across the usual consent-widget element set.
 */
function clickScript(label: string): string {
  const t = JSON.stringify(label.trim()).toLowerCase()
  return (
    `(function(){var t=${t};` +
    `var els=document.querySelectorAll('a,button,input[type=submit],input[type=button],label');` +
    `for(var i=0;i<els.length;i++){var e=els[i];` +
    `var txt=(e.textContent||'').trim();` +
    `if(txt.toLowerCase()===t){e.click();return 'clicked';}}` +
    `return 'notfound';})()`
  )
}

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
  /**
   * M5 5.4 (C7): host-scoped persistent browser39 sessions (config knob,
   * default on). Off → `--no-persist` (in-memory, nothing written).
   */
  persistSessions?: boolean
  /** Test escape hatch: session-directory root (default per sessions.ts). */
  sessionsRoot?: string
  /** M5 5.6: stored-content cap in bytes (default 2 MB via config). */
  maxBytes?: number
}

/**
 * M5 5.6: cap content at `maxBytes` UTF-8 bytes, cutting on a character
 * boundary (never a split code point). `truncated` iff bytes were dropped.
 */
export function truncateToBytes(
  content: string,
  maxBytes: number,
): { content: string; bytes: number; truncated: boolean } {
  const buf = Buffer.from(content, 'utf8')
  if (buf.length <= maxBytes) return { content, bytes: buf.length, truncated: false }
  let cut = maxBytes
  // step back off continuation bytes (0b10xxxxxx) to a valid boundary
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--
  return { content: buf.subarray(0, cut).toString('utf8'), bytes: cut, truncated: true }
}

/** SIGTERM grace before SIGKILL when shutting a `watch` process down. */
const WATCH_SHUTDOWN_GRACE_MS = 1500
/** Result-file poll interval (watch writes the line well under this). */
const RESULT_POLL_MS = 75

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
  /** `dom_query` (and other query actions): the script's return value. */
  result?: unknown
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

  private get persistSessions(): boolean {
    return this.config.persistSessions ?? true
  }

  private get maxBytes(): number {
    return this.config.maxBytes ?? DEFAULT_MAX_BYTES
  }

  /** v0 fetch options (2.0.0 contract; `show_selectors_first` defaults true
   *  in 2.0.0 → stub pages; we want the raw page). */
  private static readonly FETCH_OPTIONS = {
    include_links: true,
    strip_nav: true,
    show_selectors_first: false,
  }

  private fetchCommand(id: string, seq: number, url: string): B39Command {
    return { id, action: 'fetch', v: 1, seq, url, options: Browser39Fetcher.FETCH_OPTIONS }
  }

  async fetch(
    url: string,
    opts?: { signal?: AbortSignal; sessionKey?: string },
  ): Promise<FetchedPage> {
    const lines = await this.runBatch([this.fetchCommand('f1', 1, url)], opts)
    const line = lines.get('f1')
    if (!line) throw new FetchError('fetch_failed', 'browser39 returned no result line')
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
  }

  /**
   * C10 (M5 5.5): one consent attempt in the SAME host session — ONE
   * browser39 invocation (a batch), so cookies land and stick within the
   * call and flush to the on-disk session on SIGTERM:
   *
   *   c1  fetch(url)                 restore the page (a fresh process has
   *                                  no DOM; the click script needs one)
   *   c2  dom_query(clickScript)     best-effort element `.click()` — a
   *                                  no-op on 2.0.0 page handlers, kept for
   *                                  transports that honor it
   *   c3  fetch(linkUrl)  [if any]   the WORKING path: navigating a link whose
   *                                  text matches the label is a real
   *                                  navigation — Set-Cookie lands
   *   f1  fetch(url)                 the measuring refetch (the line we wait for)
   *
   * null = the batch failed (spawn/timeout/abort) — the caller counts the
   * attempt and continues.
   */
  async consentAttempt(
    url: string,
    label: string,
    linkUrl: string | null,
    opts?: { signal?: AbortSignal; sessionKey?: string },
  ): Promise<ConsentAttempt | null> {
    const commands: B39Command[] = [
      this.fetchCommand('c1', 1, url),
      { id: 'c2', action: 'dom_query', v: 1, seq: 2, script: clickScript(label) },
    ]
    if (linkUrl !== null) commands.push(this.fetchCommand('c3', 3, linkUrl))
    commands.push(this.fetchCommand('f1', commands.length + 1, url))

    let lines: Map<string, B39ResultLine>
    try {
      lines = await this.runBatch(commands, opts)
    } catch {
      // batch failed (spawn/timeout/abort) — counted by the tactic
      return null
    }

    const refetch = lines.get('f1')
    if (!refetch || refetch.ok !== true) return { clicked: linkUrl !== null, page: null }

    const clickLine = lines.get('c2')
    const elementClicked = clickLine?.ok === true && String(clickLine.result ?? '') === 'clicked'
    return {
      clicked: elementClicked || linkUrl !== null,
      page: this.toFetchedPage(url, refetch),
    }
  }

  /**
   * One managed `watch` process per batch (D-M5.9): write the command
   * line(s) BEFORE spawn (watch processes pre-existing lines at startup —
   * no startup race), spawn `browser39 watch <in> --output <out>`, poll the
   * output file until the LAST command's result line appears, then SIGTERM
   * the group (flush the session save) → SIGKILL after a grace → resolve
   * with all result lines (id → line). The deadline covers the whole call.
   */
  private async runBatch(
    commands: B39Command[],
    opts?: { signal?: AbortSignal; sessionKey?: string },
  ): Promise<Map<string, B39ResultLine>> {
    const bin = resolveBrowser39Bin(this.config.browser39Bin)
    if (!bin) {
      throw new FetchError(
        'spawn_failed',
        'browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH)',
      )
    }

    // M5 5.4 (C7): host-scoped session — the per-host config IS the session
    // scope. No sessionKey (or knob off) → forced in-memory, nothing written.
    const sessionConfig =
      this.persistSessions && opts?.sessionKey
        ? ensureSessionDir(opts.sessionKey, this.config.sessionsRoot ?? sessionsRoot())
        : null

    const workdir = mkdtempSync(join(tmpdir(), 'web-missions-b39-'))
    const inPath = join(workdir, 'commands.jsonl')
    const outPath = join(workdir, 'results.jsonl')
    try {
      writeFileSync(inPath, commands.map((c) => JSON.stringify(c)).join('\n') + '\n')
      writeFileSync(outPath, '')
      return await this.spawnWatch(
        bin,
        inPath,
        outPath,
        sessionConfig,
        commands[commands.length - 1].id,
        commands.length > 1,
        opts?.signal,
      )
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  }

  private spawnWatch(
    bin: Browser39Bin,
    inPath: string,
    outPath: string,
    sessionConfig: string | null,
    waitId: string,
    isBatch: boolean,
    signal?: AbortSignal,
  ): Promise<Map<string, B39ResultLine>> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        const args = [...bin.args, 'watch', inPath]
        if (sessionConfig) args.push('--config', sessionConfig)
        else args.push('--no-persist')
        args.push('--output', outPath)
        child = spawn(bin.cmd, args, {
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
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null
      let shutdownStarted = false

      const finish = (
        err: Error | null,
        lines?: Map<string, B39ResultLine>,
      ): void => {
        if (settled) return
        settled = true
        if (pollTimer !== null) clearInterval(pollTimer)
        if (deadlineTimer !== null) clearTimeout(deadlineTimer)
        signal?.removeEventListener('abort', onAbort)
        if (err) reject(err)
        else resolve(lines as Map<string, B39ResultLine>)
      }

      // Graceful shutdown: SIGTERM the group (browser39 flushes the session
      // save), SIGKILL after the grace if it is still alive.
      const beginShutdown = (): void => {
        if (shutdownStarted) return
        shutdownStarted = true
        this.killGroup(child, 'SIGTERM')
        setTimeout(() => this.killGroup(child, 'SIGKILL'), WATCH_SHUTDOWN_GRACE_MS).unref()
      }

      // Poll the appended result file until the LAST command's result line
      // (id `waitId`) has fully landed; return every parsed line (id → line).
      const readResults = (): Map<string, B39ResultLine> | undefined => {
        let raw: string
        try {
          raw = readFileSync(outPath, 'utf8')
        } catch {
          return undefined
        }
        const map = new Map<string, B39ResultLine>()
        for (const phys of raw.split('\n')) {
          if (phys.trim() === '') continue
          try {
            const l = JSON.parse(phys) as B39ResultLine
            if (typeof l.id === 'string') map.set(l.id, l)
          } catch {
            // partial line still being written — keep polling
          }
        }
        return map.has(waitId) ? map : undefined
      }

      const onAbort = (): void => {
        beginShutdown()
        finish(new FetchError('fetch_failed', 'fetch aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      deadlineTimer = setTimeout(() => {
        beginShutdown()
        finish(
          new FetchError(
            'fetch_failed',
            `browser39 ${isBatch ? 'consent batch' : 'fetch'} timed out after ${this.timeoutMs} ms`,
          ),
        )
      }, this.timeoutMs)

      pollTimer = setInterval(() => {
        const lines = readResults()
        if (lines) {
          beginShutdown()
          finish(null, lines)
        }
      }, RESULT_POLL_MS)

      child.stderr?.on('data', (d: Buffer) => {
        stderrBuf = (stderrBuf + d.toString()).slice(-2000)
      })
      child.on('error', (e: NodeJS.ErrnoException) => {
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
        // Early exit (e.g. invalid config): settle with what the file holds.
        const lines = readResults()
        if (lines) {
          finish(null, lines)
          return
        }
        finish(
          new FetchError(
            'fetch_failed',
            `browser39 exited (code ${code}) without a result line: ${tail(stderrBuf)}`,
          ),
        )
      })
    })
  }

  private killGroup(child: ReturnType<typeof spawn>, signalName: 'SIGTERM' | 'SIGKILL'): void {
    try {
      if (child.pid !== undefined) {
        // Kill the whole process group (bin.js shims execFileSync the platform binary).
        process.kill(-child.pid, signalName)
        return
      }
    } catch {
      // not a group leader (or already dead) — fall through
    }
    try {
      child.kill(signalName)
    } catch {
      // already dead
    }
  }

  private toFetchedPage(requestedUrl: string, line: B39ResultLine): FetchedPage {
    const finalUrl = line.url ?? requestedUrl
    const status = typeof line.status === 'number' ? line.status : 0

    // M5 5.6: cap stored content at maxBytes (byte-exact, char-boundary
    // safe) BEFORE quality assessment — a capped page is what gets stored,
    // chunked, previewed, and searched.
    const cap = truncateToBytes(line.markdown ?? '', this.maxBytes)
    const content = cap.content

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

    const byteLength = cap.truncated
      ? cap.bytes
      : typeof line.stats?.content_bytes === 'number'
        ? line.stats.content_bytes
        : cap.bytes

    const { quality, qualitySignals } = assessQuality({
      status,
      title: line.title ?? '',
      content,
      thinThresholdChars: this.thinThresholdChars,
    })
    const qualitySignalsFinal = cap.truncated ? [...qualitySignals, 'truncated'] : qualitySignals

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
      qualitySignals: qualitySignalsFinal,
      consentAttempted: false,
      consentImproved: false,
    }
  }
}
