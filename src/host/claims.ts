/**
 * Claim check (R2 / Q1) — reuse the spirit of scripts/check-s1-dod.mjs for
 * in-loop verify at mission_stop / mission_verify.
 *
 * Checks (general, fixture-agnostic):
 *  - every markdown citation [p-…](url) resolves to a ledger artifact
 *  - cited artifacts are quality `full` (not thin/blocked)
 *  - number-like tokens in mission.md appear verbatim in at least one cited
 *    artifact's stored text (when numberFormatCheck is on)
 *
 * Zero budget. Read-only. Never fetches.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readArtifact } from './artifacts.ts'
import { StoreError, readManifest, resolveMissionId } from './store.ts'

export interface ClaimCitation {
  artifact_id: string
  ok: boolean
  quality?: string
  reason?: string
}

export interface ClaimNumber {
  value: string
  ok: boolean
  reason?: string
}

export interface ClaimCheckResult {
  ok: boolean
  mission_id: string
  mission_md_path: string
  citations: ClaimCitation[]
  numbers: ClaimNumber[]
  summary: string
  /** R4.8 — present when 0 citations parsed (hint the expected form). */
  citation_format_example?: string
}

export interface ClaimCheckOptions {
  /** When true (default), require number-like tokens in mission.md to appear in cited pages. */
  numberFormatCheck?: boolean
}

const CITE_RE = /\[(p-[a-f0-9]{6,})\]\([^)]*\)/g
/** Integers ≥2 digits, decimals, percents, currency-ish — skip lone years-looking? keep simple. */
const NUMBER_RE = /(?<![\w.])(?:€|\$|£)?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?%?(?![\w.])/g

function missionMdPath(root: string, id: string): string {
  return join(root, id, 'mission.md')
}

function loadCitedText(root: string, missionId: string, artifactId: string): string {
  try {
    const { page, chunkCount } = readArtifact(root, missionId, artifactId)
    const parts: string[] = [page.content ?? '', page.title ?? '']
    const chunksDir = join(root, missionId, 'pages', artifactId, 'chunks')
    if (existsSync(chunksDir) && chunkCount > 0) {
      for (const e of readdirSync(chunksDir, { withFileTypes: true })) {
        if (!e.isFile()) continue
        try {
          parts.push(readFileSync(join(chunksDir, e.name), 'utf8'))
        } catch { /* skip */ }
      }
    }
    return parts.join('\n')
  } catch {
    return ''
  }
}

/**
 * Score mission.md claims against the ledger + stored pages.
 */
export function checkMissionClaims(
  root: string,
  missionIdArg?: string,
  opts: ClaimCheckOptions = {},
): ClaimCheckResult {
  const missionId = resolveMissionId(root, missionIdArg)
  const mdPath = missionMdPath(root, missionId)
  if (!existsSync(mdPath)) {
    throw new StoreError('corrupt', `mission.md missing for ${missionId}`)
  }
  const missionMd = readFileSync(mdPath, 'utf8')
  const manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)
  const byArtifact = Object.fromEntries(
    (manifest.fetched || []).map((r) => [r.artifact_id, r]),
  )

  const citeIds = [...missionMd.matchAll(CITE_RE)].map((m) => m[1])
  const uniqueCites = [...new Set(citeIds)]
  const citations: ClaimCitation[] = uniqueCites.map((id) => {
    const row = byArtifact[id]
    if (!row) return { artifact_id: id, ok: false, reason: 'unresolved' }
    if (row.quality !== 'full') {
      return { artifact_id: id, ok: false, quality: row.quality, reason: `cited_${row.quality}` }
    }
    return { artifact_id: id, ok: true, quality: row.quality }
  })

  const numbers: ClaimNumber[] = []
  const numberCheck = opts.numberFormatCheck !== false
  if (numberCheck && uniqueCites.length > 0) {
    const corpus = uniqueCites
      .filter((id) => byArtifact[id]?.quality === 'full')
      .map((id) => loadCitedText(root, missionId, id))
      .join('\n')
    // Strip citation lines somewhat to avoid matching artifact hex as numbers
    const body = missionMd.replace(CITE_RE, ' ')
    const seen = new Set<string>()
    for (const m of body.matchAll(NUMBER_RE)) {
      const raw = m[0]
      // Skip tiny ints that are almost always noise (1–9 alone already excluded by {1,3} with lookbehind)
      if (/^\d$/.test(raw.replace(/[€$£%]/g, ''))) continue
      if (seen.has(raw)) continue
      seen.add(raw)
      const ok = corpus.includes(raw)
      numbers.push(ok ? { value: raw, ok: true } : { value: raw, ok: false, reason: 'not_in_cited_pages' })
    }
  }

  const citeFail = citations.filter((c) => !c.ok).length
  const numFail = numbers.filter((n) => !n.ok).length
  // R4.8: zero parsed citations is NOT silent success — need `[p-…](url)`.
  const noCites = uniqueCites.length === 0
  const ok = !noCites && citeFail === 0 && numFail === 0
  const citeExample = 'expected form: [p-abcd1234](https://example.com/page)'
  let summary: string
  if (noCites) {
    summary =
      `claims failed: 0 citations parsed in mission.md — ${citeExample}; ` +
      `cite stored artifact_ids from mission_status.artifacts / mission_read`
  } else if (ok) {
    summary = `claims ok: ${citations.length} citation(s), ${numbers.length} number(s) checked`
  } else {
    summary =
      `claims failed: ${citeFail} bad citation(s), ${numFail} number(s) not in cited pages` +
      (citeFail > 0 ? ` (${citeExample})` : '')
  }

  return {
    ok,
    mission_id: missionId,
    mission_md_path: mdPath,
    citations,
    numbers,
    summary,
    ...(noCites ? { citation_format_example: citeExample } : {}),
  }
}
