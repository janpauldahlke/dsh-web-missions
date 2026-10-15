#!/usr/bin/env node
/**
 * R3.4 — tool-face smoke: mission_* must stay registered after Cordis-style
 * effect wiring (the self-dispose scar). Optionally probes live :3080 health.
 *
 * Usage:
 *   node test/smoke-tool-face.mjs
 *   DSH_WEB_BASE=http://127.0.0.1:3080 node test/smoke-tool-face.mjs
 */
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const require = createRequire(import.meta.url)

let fail = 0
let pass = 0
const check = (label, cond, detail) => {
  if (cond) {
    pass++
    console.log('ok   ' + label)
  } else {
    fail++
    console.error('FAIL ' + label + (detail ? ' :: ' + detail : ''))
  }
}

const EXPECTED = [
  'mission_start',
  'mission_list',
  'mission_status',
  'mission_fetch',
  'mission_find',
  'mission_read',
  'mission_verify',
  'mission_stop',
]

let assertSupportedJsonSchema
for (const candidate of [
  join(root, '../deepseek-harness/packages/core/tools/lib/index.js'),
  '@deepseek-ai/dsh-tools',
]) {
  try {
    assertSupportedJsonSchema = require(candidate).assertSupportedJsonSchema
    break
  } catch {
    /* try next */
  }
}

const lib = require(join(root, 'lib/index.js'))
const alive = []
const disposed = []

lib.apply({
  tools: {
    register(def) {
      if (assertSupportedJsonSchema) {
        assertSupportedJsonSchema(def.parameters)
        assertSupportedJsonSchema(def.output.schema)
      }
      alive.push(def.name)
      return () => {
        const i = alive.indexOf(def.name)
        if (i >= 0) alive.splice(i, 1)
        disposed.push(def.name)
      }
    },
  },
  effect(fn) {
    const d = fn()
    if (typeof d !== 'function') throw new Error('effect body must return a disposer')
    return d
  },
  inject() {},
  logger: () => ({ warn() {}, error() {} }),
})

check('8 mission tools registered', alive.length === 8, JSON.stringify(alive))
for (const name of EXPECTED) check(`has ${name}`, alive.includes(name))
check('none disposed during apply (effect scar)', disposed.length === 0, JSON.stringify(disposed))

const base = process.env.DSH_WEB_BASE
if (base) {
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/web-missions/health`)
    const body = await res.json()
    check('live health ok', body.ok === true)
    check(
      'live health lists 8 tools',
      Array.isArray(body.tools) && body.tools.length === 8,
      JSON.stringify(body.tools),
    )
    for (const name of EXPECTED) {
      check(`live has ${name}`, (body.tools || []).includes(name))
    }
  } catch (error) {
    check('live health reachable', false, error instanceof Error ? error.message : String(error))
  }
} else {
  console.log('(skip live health — set DSH_WEB_BASE to probe)')
}

if (fail > 0) {
  console.error(`TOOL-FACE SMOKE: ${fail} failed / ${pass} passed`)
  process.exit(1)
}
console.log(`TOOL-FACE SMOKE: all checks passed (${pass})`)
