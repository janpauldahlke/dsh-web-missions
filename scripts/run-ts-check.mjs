#!/usr/bin/env node
// Run a TS checker (esbuild-bundled, same as the smokes) and forward exit.
// Usage: node scripts/run-ts-check.mjs <file.ts>
import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const entry = resolve(process.cwd(), process.argv[2])
const dir = mkdtempSync(join(tmpdir(), 'run-ts-check-'))
const out = join(dir, 'check.mjs')
try {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    absWorkingDir: process.cwd(),
  })
  const res = spawnSync(process.execPath, [out], { stdio: 'inherit', env: { ...process.env, DSH_CHECK_REPO_ROOT: process.cwd() } })
  process.exit(res.status ?? 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
