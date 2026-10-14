#!/usr/bin/env node
/**
 * R0/R5 minimal transcript harness — score a saved agent transcript (or probe :3090).
 *
 * Modes:
 *   node scripts/transcript-harness.mjs score <transcript.json>
 *   node scripts/transcript-harness.mjs health [http://127.0.0.1:3090]
 *
 * Transcript shape (flexible):
 *   { model?, tools_called?: string[], messages?: [{role, content|tool_calls}] }
 * Scores: tools called, unregistered names, allowlist/ghost refusals.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const evidenceDir = join(repo, 'plan', 'REVIEW', 'evidence')

/** Tools this plugin registers after R2 (canonical surface). */
const REGISTERED = new Set([
  'mission_start',
  'mission_list',
  'mission_status',
  'mission_fetch',
  'mission_find',
  'mission_read',
  'mission_verify',
  'mission_stop',
  // companion (when wired on profile)
  'discovery_search',
])

const GHOST_HINTS = ['web_search', 'browser_search', 'exa_search', 'tavily', 'serp']

function extractToolNames(doc) {
  const names = []
  if (Array.isArray(doc.tools_called)) names.push(...doc.tools_called)
  const msgs = doc.messages || doc.turns || []
  for (const m of msgs) {
    const calls = m.tool_calls || m.toolCalls || []
    for (const c of calls) {
      const n = c.name || c.function?.name || c.tool
      if (n) names.push(n)
    }
    if (typeof m.content === 'string') {
      for (const re of [/mission_\w+/g, /discovery_\w+/g]) {
        const hits = m.content.match(re)
        if (hits) names.push(...hits)
      }
    }
  }
  return names
}

function score(doc) {
  const called = extractToolNames(doc)
  const unique = [...new Set(called)]
  const unregistered = unique.filter((n) => n.startsWith('mission_') || n.startsWith('discovery_')
    ? !REGISTERED.has(n)
    : GHOST_HINTS.some((g) => n.toLowerCase().includes(g)))
  const refusals = []
  const blob = JSON.stringify(doc)
  for (const code of ['allowlist_denied', 'allowlist_empty', 'budget_exhausted', 'depth_exceeded', 'no_engine']) {
    if (blob.includes(code)) refusals.push(code)
  }
  return {
    model: doc.model || doc.model_id || null,
    tools_called: unique,
    unregistered,
    refusals,
    has_fetch: unique.includes('mission_fetch'),
    has_find: unique.includes('mission_find'),
    has_read: unique.includes('mission_read'),
    has_verify: unique.includes('mission_verify') || unique.includes('mission_stop'),
    ok: unregistered.length === 0,
  }
}

async function health(base) {
  const url = `${base.replace(/\/$/, '')}/api/web-missions/health`
  const res = await fetch(url)
  const body = await res.json()
  return { status: res.status, body }
}

const [,, mode, arg] = process.argv
if (mode === 'health') {
  const base = arg || 'http://127.0.0.1:3090'
  try {
    const h = await health(base)
    console.log(JSON.stringify(h, null, 2))
    process.exit(h.body?.ok ? 0 : 1)
  } catch (e) {
    console.error('health failed:', e.message)
    process.exit(2)
  }
} else if (mode === 'score') {
  if (!arg) {
    console.error('usage: transcript-harness.mjs score <transcript.json>')
    process.exit(2)
  }
  const doc = JSON.parse(readFileSync(resolve(arg), 'utf8'))
  const result = score(doc)
  mkdirSync(evidenceDir, { recursive: true })
  const out = join(evidenceDir, `score-${Date.now()}.json`)
  writeFileSync(out, JSON.stringify({ scored_at: new Date().toISOString(), result, source: resolve(arg) }, null, 2))
  console.log(JSON.stringify(result, null, 2))
  console.log('wrote', out)
  process.exit(result.ok ? 0 : 1)
} else {
  console.log(`transcript-harness — R0/R5 scorer
  score <file.json>   score a saved transcript
  health [base]       GET /api/web-missions/health (default :3090)

Registered mission tools: ${[...REGISTERED].filter((n) => n.startsWith('mission_')).join(', ')}
Evidence dir: ${evidenceDir}
Exists: ${existsSync(evidenceDir)}`)
  process.exit(0)
}
