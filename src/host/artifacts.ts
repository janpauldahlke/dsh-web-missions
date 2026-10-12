/**
 * Artifact storage (M2 slice 2.4, layout C1) — pages/{p-<8hex>}/ under a
 * mission dir:
 *
 *   page.json    = FetchedPage + { artifact_id, mission_id, normalized_url, stored_at }
 *   links.json   = FetchedPage.links, deduped by normalized url (first-seen text wins)
 *   chunks/NNN.md = content split at chunkChars (default 2000, hand config);
 *                   boundary = nearest newline within ±20% of the limit
 *
 * Blocked pages (4xx/5xx, empty body) are stored as page.json (+ links if any)
 * with NO chunks (D-M2.1) — so the ledger can say *why* a URL is dead and M3
 * can return the blocked receipt without re-spawning.
 *
 * The ledger key is the normalized FINAL url (D-M2.2) — page.json records it
 * as `normalized_url`. All writes go through the store's atomic temp+rename.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { FetchedPage } from '../shared/types.ts'
import { normalizeUrl } from './normalize.ts'
import {
  StoreError,
  atomicWriteJson,
  atomicWriteText,
  newArtifactId,
} from './store.ts'

/** Hand-set knob (ENV.md): default chunk size in characters. */
export const DEFAULT_CHUNK_CHARS = 2000
/** Receipt preview length (C4: "first ~300 chars of stored text"). */
export const PREVIEW_HEAD_CHARS = 300

/**
 * Split content into chunks of ~chunkChars. A boundary is the newline
 * closest to the chunkChars limit within ±20% of it; if the window has no
 * newline the chunk hard-cuts at the limit (long unbroken lines).
 */
export function splitContent(content: string, chunkChars: number): string[] {
  if (chunkChars <= 0) throw new Error(`chunkChars must be positive: ${chunkChars}`)
  if (content.length === 0) return []
  const chunks: string[] = []
  let start = 0
  while (start < content.length) {
    const limit = start + chunkChars
    if (limit >= content.length) {
      chunks.push(content.slice(start))
      break
    }
    const lo = Math.max(start + Math.floor(chunkChars * 0.8), start + 1)
    const hi = Math.min(start + Math.ceil(chunkChars * 1.2), content.length)
    let cut = -1
    for (let i = limit; i >= lo; i--) {
      if (content.charCodeAt(i) === 10) { cut = i; break }
    }
    if (cut === -1) {
      for (let i = Math.min(limit + 1, hi); i < hi; i++) {
        if (content.charCodeAt(i) === 10) { cut = i; break }
      }
    }
    const endCut = cut === -1 ? limit : cut + 1
    chunks.push(content.slice(start, endCut))
    start = endCut
  }
  return chunks
}

/** Dedupe links by normalized url; first-seen text wins (C1: url + text). */
export function dedupeLinks(links: FetchedPage['links']): Array<{ url: string; text: string }> {
  const seen = new Map<string, { url: string; text: string }>()
  for (const link of links) {
    let key: string
    try {
      key = normalizeUrl(link.url)
    } catch {
      continue // non-normalizable (should not happen — fetcher filters http/https)
    }
    if (!seen.has(key)) seen.set(key, { url: link.url, text: link.text })
  }
  return [...seen.values()]
}

export interface StoredArtifact {
  artifactId: string
  chunkCount: number
  previewHead: string
  links: Array<{ url: string; text: string }>
}

export interface StoreArtifactOptions {
  /** Default DEFAULT_CHUNK_CHARS (2000, hand config). */
  chunkChars?: number
  /** M3: reuse an existing artifact id instead of minting a new one. */
  artifactId?: string
  /** M3: wipe the existing artifact dir contents first (force overwrite). */
  replace?: boolean
}

/** page.json record = FetchedPage + stored metadata. */
export interface StoredPageRecord extends FetchedPage {
  artifact_id: string
  mission_id: string
  normalized_url: string
  stored_at: string
}

export interface ReadArtifactResult {
  page: StoredPageRecord
  /** Deduped links as stored in links.json (absent file → []). */
  links: Array<{ url: string; text: string }>
  /** Chunk files on disk (0 when no chunks dir). */
  chunkCount: number
}

/**
 * Store a fetched page under <root>/<missionId>/pages/<p-<8hex>>/ and return
 * the receipt-relevant summary. Pure fs — no network, no fetcher.
 */
export function storeArtifact(
  root: string,
  missionId: string,
  page: FetchedPage,
  opts: StoreArtifactOptions = {},
): StoredArtifact {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS
  const artifactId = opts.artifactId ?? newArtifactId()
  const dir = join(root, missionId, 'pages', artifactId)
  if (opts.replace) {
    // M3 force: overwrite in place — drop stale page.json/links.json/chunks
    // so the new fetch is the sole truth (stale chunks/links never survive).
    if (existsSync(dir)) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) rmSync(join(dir, e.name), { recursive: true, force: true })
        else rmSync(join(dir, e.name), { force: true })
      }
    }
    mkdirSync(dir, { recursive: true })
  } else {
    mkdirSync(dir, { recursive: true })
  }

  const storedAt = new Date().toISOString()
  const pageRecord = {
    ...page,
    artifact_id: artifactId,
    mission_id: missionId,
    normalized_url: normalizeUrl(page.finalUrl), // D-M2.2: ledger key = normalized final URL
    stored_at: storedAt,
  }
  atomicWriteJson(join(dir, 'page.json'), pageRecord)

  const links = dedupeLinks(page.links)
  if (links.length > 0) atomicWriteJson(join(dir, 'links.json'), links)

  let chunkCount = 0
  if (page.quality !== 'blocked' && page.content.trim().length > 0) {
    const chunks = splitContent(page.content, chunkChars)
    mkdirSync(join(dir, 'chunks'), { recursive: true })
    for (const [i, chunk] of chunks.entries()) {
      atomicWriteText(join(dir, 'chunks', `${String(i).padStart(3, '0')}.md`), chunk)
    }
    chunkCount = chunks.length
  }

  return {
    artifactId,
    chunkCount,
    previewHead: page.content.slice(0, PREVIEW_HEAD_CHARS),
    links,
  }
}

/**
 * Read a stored artifact back (M3 hit path). page.json is required (a missing
 * or corrupt record is a store fault, surfaced as `corrupt`); links.json and
 * chunks/ are optional (blocked pages / link-less pages).
 */
export function readArtifact(root: string, missionId: string, artifactId: string): ReadArtifactResult {
  const dir = join(root, missionId, 'pages', artifactId)
  const pagePath = join(dir, 'page.json')
  if (!existsSync(pagePath)) {
    throw new StoreError('corrupt', `page.json missing for artifact ${artifactId}`)
  }
  let page: StoredPageRecord
  try {
    page = JSON.parse(readFileSync(pagePath, 'utf8')) as StoredPageRecord
  } catch (error) {
    throw new StoreError('corrupt', `cannot read ${pagePath}: ${(error as Error).message}`)
  }

  let links: Array<{ url: string; text: string }> = []
  const linksPath = join(dir, 'links.json')
  if (existsSync(linksPath)) {
    try {
      const parsed = JSON.parse(readFileSync(linksPath, 'utf8'))
      if (Array.isArray(parsed)) links = parsed
    } catch {
      links = [] // unreadable links.json degrades to no sample links (page itself is intact)
    }
  }

  let chunkCount = 0
  const chunksDir = join(dir, 'chunks')
  if (existsSync(chunksDir)) {
    chunkCount = readdirSync(chunksDir, { withFileTypes: true }).filter((e) => e.isFile()).length
  }

  return { page, links, chunkCount }
}
