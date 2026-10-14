/**
 * mission_read (R2 / G5) — one stored chunk → text + quality. Zero budget.
 * Page text is untrusted (Q2): always marked so the model does not treat it
 * as operator instructions.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readArtifact } from './artifacts.ts'
import { readConfig } from './config.ts'
import { StoreError, resolveMissionId } from './store.ts'
import { prepareUntrustedPageText } from './untrusted.ts'

export interface RunReadArgs {
  artifact_id: string
  chunk?: number
  mission_id?: string
}

export interface ReadResult {
  mission_id: string
  artifact_id: string
  chunk: number
  chunk_count: number
  page_quality: string
  quality_signals: string[]
  /** Always true — page text is untrusted content from the open web. */
  untrusted: true
  text: string
  mission_md_path: string
  next_step_hint: string
  url: string
  title: string
}

function listChunkFiles(chunksDir: string): string[] {
  if (!existsSync(chunksDir)) return []
  return readdirSync(chunksDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
}

export function runRead(root: string, args: RunReadArgs): ReadResult {
  const artifactId = String(args.artifact_id ?? '').trim()
  if (!artifactId) throw new StoreError('bad_args', 'artifact_id required')
  const missionId = resolveMissionId(root, args.mission_id)
  const config = readConfig(root)
  const stored = readArtifact(root, missionId, artifactId)
  const chunksDir = join(root, missionId, 'pages', artifactId, 'chunks')
  const files = listChunkFiles(chunksDir)
  const chunkCount = files.length
  const chunkIdx = args.chunk === undefined || args.chunk === null ? 0 : Number(args.chunk)
  if (!Number.isInteger(chunkIdx) || chunkIdx < 0) {
    throw new StoreError('bad_args', `chunk must be a non-negative integer: ${args.chunk}`)
  }
  if (chunkCount === 0) {
    // Blocked / empty — return empty text with quality so the model does not invent.
    return {
      mission_id: missionId,
      artifact_id: artifactId,
      chunk: 0,
      chunk_count: 0,
      page_quality: stored.page.quality,
      quality_signals: stored.page.qualitySignals ?? [],
      untrusted: true,
      text: '',
      mission_md_path: join(root, missionId, 'mission.md'),
      next_step_hint: 'no chunks stored — do not claim content from this page; try another artifact',
      url: stored.page.finalUrl || stored.page.url,
      title: stored.page.title ?? '',
    }
  }
  if (chunkIdx >= chunkCount) {
    throw new StoreError('bad_args', `chunk ${chunkIdx} out of range (0..${chunkCount - 1})`)
  }
  let text = readFileSync(join(chunksDir, files[chunkIdx]), 'utf8')
  const cap = config.readChars
  if (Number.isInteger(cap) && cap > 0 && text.length > cap) {
    text = text.slice(0, cap)
  }
  text = prepareUntrustedPageText(text, {
    markUntrustedText: config.markUntrustedText,
    stripInstructionLike: config.stripInstructionLike,
  })
  const more = chunkIdx + 1 < chunkCount
  return {
    mission_id: missionId,
    artifact_id: artifactId,
    chunk: chunkIdx,
    chunk_count: chunkCount,
    page_quality: stored.page.quality,
    quality_signals: stored.page.qualitySignals ?? [],
    untrusted: true,
    text,
    mission_md_path: join(root, missionId, 'mission.md'),
    next_step_hint: more
      ? `append a note to mission.md citing ${artifactId}, then mission_read chunk ${chunkIdx + 1} or mission_verify`
      : `Re-read the Goal in mission.md, append a note citing ${artifactId}, then mission_verify before mission_stop`,
    url: stored.page.finalUrl || stored.page.url,
    title: stored.page.title ?? '',
  }
}
