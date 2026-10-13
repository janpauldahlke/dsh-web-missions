/**
 * C8 — Retrieval seam (born M4, v0 = LexicalEngine) — DESIGN.md §C8,
 * plan/M_4_find.md.
 *
 * The scorer is an **implementation, not the architecture**. The named
 * port is `RetrievalEngine.search`; the v0 implementation is
 * `LexicalEngine` (tf × IDF-lite, D-M4.1):
 *
 *   score(doc) = Σ over query terms t of (tf_t × w_t)
 *   w_t        = 1 + log10(N / df_t)
 *
 * N = documents in the scored corpus (chunk matches: ALL of the mission's
 * stored chunks; link matches: ALL stored links), df_t = docs containing t.
 * No precomputed index — missions are small (tens of chunks, D-M4.1).
 * Deterministic: same stored pages + query + config = same result (V3).
 *
 * Future embeddings / hybrid engines plug in here; the C5 tool signature and
 * the result shape below stay stable across engine swaps (DESIGN C8).
 *
 * v0 rules (M_4_find.md deep design):
 *  - Tokenize: lowercase, split on non-alphanumerics (unicode-aware — ä/ß/ü
 *    survive, so German words/plurals do), drop tokens < 3 chars (D-M4.2).
 *    No stemming in v0 (documented).
 *  - Chunks with score 0 are dropped; ties broken by `fetched_at` (newer
 *    first), then artifact_id asc, then chunk asc (final tiebreaks keep the
 *    order total + deterministic).
 *  - `limit`: default 5, max 20 (D-M4.4); out-of-range values are clamped.
 *  - Snippet (D-M4.3): ±`snippetWindow` chars (config, default 120) around
 *    the first occurrence of the highest-weighted query term, clipped at
 *    line boundaries, single-space collapse, `…` at clipped ends.
 *  - `link_matches`: links whose text scores > 0 (same formula, weights from
 *    the link corpus), ≤5, score desc then url/text asc.
 *  - Empty query / all tokens filtered → FindError('empty_query').
 *  - Scores are rounded to 2 decimals in results (example "2.41"); internal
 *    ordering uses the raw value.
 *  - `depth` is read from the stored page record (M5 fills it; 0 until then —
 *    schema stability, same pattern as consent_*).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_SNIPPET_WINDOW = 120
export const DEFAULT_FIND_LIMIT = 5
export const MAX_FIND_LIMIT = 20
export const MIN_TOKEN_LENGTH = 3
export const MAX_LINK_MATCHES = 5

/** Store scope for a search: the mission dir under `<root>` (C1 layout). */
export interface MissionScope {
  root: string
  missionId: string
}

export interface RetrievalMatch {
  artifact_id: string
  url: string
  /** 0-based chunk index. */
  chunk: number
  /** tf × IDF-lite score (2 decimals). */
  score: number
  /** Hops from nearest seed (receipt field; 0 in v0 — M5 fills). */
  depth: number
  snippet: string
}

export interface LinkMatch {
  url: string
  text: string
  score: number
}

export interface RetrievalResult {
  matches: RetrievalMatch[]
  best_match_url: string | null
  link_matches: LinkMatch[]
}

export interface RetrievalOptions {
  /** Default 5, clamped to 1..20 (D-M4.4). */
  limit?: number
  /**
   * Consumed by the C5 tool layer (url_only result shape); the engine always
   * computes the full result so the shape stays stable across engine swaps.
   */
  urlOnly?: boolean
}

/** C8 port — the only surface mission_find (and future engines) see. */
export interface RetrievalEngine {
  search(scope: MissionScope, query: string, opts?: RetrievalOptions): RetrievalResult
}

/** Engine-level error with a stable code (the tool layer renders `code: msg`). */
export class FindError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FindError'
  }
}

// --- tokenization -------------------------------------------------------------

/**
 * Lowercase, split on runs of non-alphanumerics (unicode-aware: `\p{L}\p{N}`
 * keeps ä/ß/ü so German words survive), drop tokens shorter than `minLen`.
 */
export function tokenize(text: string, minLen: number = MIN_TOKEN_LENGTH): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= minLen)
}

/** Dedupe, first occurrence wins (query terms counted once each). */
function uniqueTerms(terms: string[]): string[] {
  return [...new Set(terms)]
}

// --- corpus (scanned per call — no precomputed index, D-M4.1) ------------------

interface ChunkDoc {
  artifactId: string
  url: string
  chunk: number
  text: string
  tokens: string[]
  fetchedAt: string
  depth: number
}

interface LinkDoc {
  url: string
  text: string
  tokens: string[]
}

interface Corpus {
  chunks: ChunkDoc[]
  links: LinkDoc[]
}

/**
 * Scan the mission's stored artifacts. Unreadable/corrupt artifact dirs and
 * links entries are skipped (deterministic degradation to the readable
 * subset) — a find must not die on one bad dir.
 */
function loadCorpus(root: string, missionId: string): Corpus {
  const chunks: ChunkDoc[] = []
  const links: LinkDoc[] = []
  const pagesDir = join(root, missionId, 'pages')
  if (!existsSync(pagesDir)) return { chunks, links }

  for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const artifactId = entry.name
    const dir = join(pagesDir, artifactId)
    const pagePath = join(dir, 'page.json')
    if (!existsSync(pagePath)) continue
    let page: {
      url?: unknown
      finalUrl?: unknown
      fetchedAt?: unknown
      depth?: unknown
    }
    try {
      page = JSON.parse(readFileSync(pagePath, 'utf8'))
    } catch {
      continue // corrupt page.json → skip the dir
    }
    const url = typeof page.finalUrl === 'string' ? page.finalUrl : typeof page.url === 'string' ? page.url : ''
    const fetchedAt = typeof page.fetchedAt === 'string' ? page.fetchedAt : ''
    const depth = typeof page.depth === 'number' ? page.depth : 0

    const linksPath = join(dir, 'links.json')
    if (existsSync(linksPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(linksPath, 'utf8'))
        if (Array.isArray(parsed)) {
          for (const l of parsed) {
            if (l && typeof l === 'object' && typeof (l as { url?: unknown }).url === 'string' && typeof (l as { text?: unknown }).text === 'string') {
              links.push({ url: (l as { url: string }).url, text: (l as { text: string }).text, tokens: tokenize((l as { text: string }).text) })
            }
          }
        }
      } catch {
        /* unreadable links.json → no link docs from this page */
      }
    }

    const chunksDir = join(dir, 'chunks')
    if (existsSync(chunksDir)) {
      const files = readdirSync(chunksDir, { withFileTypes: true })
        .filter((e) => e.isFile() && /^\d{3}\.md$/.test(e.name))
        .map((e) => e.name)
        .sort()
      for (const name of files) {
        const chunk = parseInt(name.slice(0, 3), 10)
        try {
          const text = readFileSync(join(chunksDir, name), 'utf8')
          chunks.push({ artifactId, url, chunk, text, tokens: tokenize(text), fetchedAt, depth })
        } catch {
          continue // unreadable chunk file → skip it
        }
      }
    }
  }
  return { chunks, links }
}

// --- scoring -------------------------------------------------------------------

/**
 * IDF-lite weights per query term: `1 + log10(N / df)`; terms absent from the
 * corpus weigh 0. N = 0 → all weights 0 (nothing scores).
 */
function termWeights(terms: string[], docs: Array<{ tokens: string[] }>): Map<string, number> {
  const weights = new Map<string, number>()
  const n = docs.length
  if (n === 0) {
    for (const t of terms) weights.set(t, 0)
    return weights
  }
  const df = new Map<string, number>()
  for (const doc of docs) {
    const present = new Set(doc.tokens)
    for (const t of terms) if (present.has(t)) df.set(t, (df.get(t) ?? 0) + 1)
  }
  for (const t of terms) {
    const d = df.get(t) ?? 0
    weights.set(t, d > 0 ? 1 + Math.log10(n / d) : 0)
  }
  return weights
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  return counts
}

function scoreDoc(terms: string[], weights: Map<string, number>, tokens: string[]): number {
  const counts = countTokens(tokens)
  let raw = 0
  for (const t of terms) {
    const tf = counts.get(t) ?? 0
    if (tf > 0) raw += tf * (weights.get(t) ?? 0)
  }
  return raw
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Default 5, clamped to 1..20 (D-M4.4); non-finite → default. */
function resolveLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_FIND_LIMIT
  return Math.min(MAX_FIND_LIMIT, Math.max(1, Math.floor(limit)))
}

/**
 * Snippet rule (D-M4.3): window ±`window` chars around the first occurrence
 * of the highest-weighted query term present in the text; edges snapped OUT
 * to line boundaries; single-space collapse; `…` where content was clipped.
 * Highest-weight tie → earliest occurrence, then query order.
 */
function makeSnippet(text: string, terms: string[], weights: Map<string, number>, window: number): string {
  const lower = text.toLowerCase()
  let bestPos = -1
  let bestW = -Infinity
  for (const t of terms) {
    const w = weights.get(t) ?? 0
    if (w <= 0) continue
    const pos = lower.indexOf(t)
    if (pos === -1) continue
    if (w > bestW || (w === bestW && pos < bestPos)) {
      bestPos = pos
      bestW = w
    }
  }
  if (bestPos === -1) return '' // unreachable: only scored docs get snippets
  const len = text.length
  const l0 = Math.max(0, bestPos - window)
  const r0 = Math.min(len, bestPos + window)
  const left = text.lastIndexOf('\n', l0 - 1) + 1 // line start of the left edge
  let right = text.indexOf('\n', r0)
  if (right === -1) right = len // line end of the right edge
  const lead = text.slice(0, left).trim() !== ''
  const trail = text.slice(right).trim() !== ''
  const collapsed = text.slice(left, right).replace(/\s+/g, ' ').trim()
  return (lead ? '…' : '') + collapsed + (trail ? '…' : '')
}

// --- engine --------------------------------------------------------------------

export interface LexicalEngineConfig {
  /** ±chars snippet window (config knob, default 120, D-M4.3). */
  snippetWindow?: number
  /** Minimum token length (default 3, D-M4.2). */
  minTokenLength?: number
}

/** v0 C8 implementation — tf × IDF-lite (D-M4.1). Deterministic. */
export class LexicalEngine implements RetrievalEngine {
  private readonly snippetWindow: number
  private readonly minTokenLength: number

  constructor(cfg: LexicalEngineConfig = {}) {
    const w = cfg.snippetWindow ?? DEFAULT_SNIPPET_WINDOW
    if (!Number.isInteger(w) || w <= 0) throw new FindError('bad_config', `snippetWindow must be a positive integer: ${w}`)
    const m = cfg.minTokenLength ?? MIN_TOKEN_LENGTH
    if (!Number.isInteger(m) || m <= 0) throw new FindError('bad_config', `minTokenLength must be a positive integer: ${m}`)
    this.snippetWindow = w
    this.minTokenLength = m
  }

  search(scope: MissionScope, query: string, opts: RetrievalOptions = {}): RetrievalResult {
    const terms = uniqueTerms(tokenize(query, this.minTokenLength))
    if (terms.length === 0) {
      throw new FindError('empty_query', `no searchable terms in query: ${JSON.stringify(query)}`)
    }

    const corpus = loadCorpus(scope.root, scope.missionId)

    // chunk matches
    const chunkWeights = termWeights(terms, corpus.chunks)
    const scored: Array<{ doc: ChunkDoc; raw: number }> = []
    for (const doc of corpus.chunks) {
      const raw = scoreDoc(terms, chunkWeights, doc.tokens)
      if (raw > 0) scored.push({ doc, raw })
    }
    scored.sort(
      (a, b) =>
        b.raw - a.raw ||
        (a.doc.fetchedAt === b.doc.fetchedAt ? 0 : a.doc.fetchedAt < b.doc.fetchedAt ? 1 : -1) ||
        (a.doc.artifactId === b.doc.artifactId ? 0 : a.doc.artifactId < b.doc.artifactId ? -1 : 1) ||
        a.doc.chunk - b.doc.chunk,
    )
    const limit = resolveLimit(opts.limit)
    const matches: RetrievalMatch[] = scored.slice(0, limit).map(({ doc, raw }) => ({
      artifact_id: doc.artifactId,
      url: doc.url,
      chunk: doc.chunk,
      score: round2(raw),
      depth: doc.depth,
      snippet: makeSnippet(doc.text, terms, chunkWeights, this.snippetWindow),
    }))

    // link matches (same formula, weights from the link corpus)
    const linkWeights = termWeights(terms, corpus.links)
    const linkScored: Array<{ url: string; text: string; raw: number }> = []
    for (const l of corpus.links) {
      const raw = scoreDoc(terms, linkWeights, l.tokens)
      if (raw > 0) linkScored.push({ url: l.url, text: l.text, raw })
    }
    linkScored.sort(
      (a, b) =>
        b.raw - a.raw ||
        (a.url === b.url ? 0 : a.url < b.url ? -1 : 1) ||
        (a.text === b.text ? 0 : a.text < b.text ? -1 : 1),
    )
    const link_matches: LinkMatch[] = linkScored.slice(0, MAX_LINK_MATCHES).map((l) => ({
      url: l.url,
      text: l.text,
      score: round2(l.raw),
    }))

    return {
      matches,
      best_match_url: matches.length > 0 ? matches[0].url : null,
      link_matches,
    }
  }
}
