/**
 * Skill registration (M4, D5: ritual + templates, not a second tool).
 *
 * Registers `web-mission-workflow` on the harness skill registry
 * (`ctx.skills.register`) at apply time, so the skill is listed/available in
 * the profile exactly like harness skills. The body is the out-of-tree file
 * `skills/web-mission-workflow/SKILL.md` in this package (shipped via
 * `files[]`); reading it at registration keeps the file the single source of
 * truth. The `kurzprofil` template is part of the skill body — scaffolding
 * for the model's text, not host logic (anti-creep, PLAN §11).
 *
 * Degraded mode (apply must never throw): no `skills` face on the context, or
 * the file missing/unparseable at runtime → logged warning, skip.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN } from '../shared/types.ts'

/** Kebab-case skill name registered on `ctx.skills`. */
export const SKILL_NAME = 'web-mission-workflow'

/** Input accepted by `ctx.skills.register` (runtime skill contribution). */
export interface SkillRegistrationInput {
  name: string
  description: string
  whenToUse?: string
  source: string
  content: string
  resourceBase?: { kind: 'directory'; path: string }
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

interface SkillsFace {
  register: (skill: SkillRegistrationInput) => () => void
}

/** Parsed skill file: frontmatter metadata + body (mirrors harness semantics: body excludes frontmatter). */
export interface ParsedSkillFile {
  name: string
  description: string
  whenToUse?: string
  body: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Parse the frontmatter subset the harness filesystem provider reads from
 * SKILL.md files: single-line `key: value` fields. Returns metadata plus the
 * body with the frontmatter removed. Throws on missing/unclosed frontmatter
 * or missing name/description (same rules as the harness loader).
 */
export function parseSkillFile(raw: string): ParsedSkillFile {
  const lines = raw.split('\n')
  if (lines[0] !== '---') throw new Error('skill file missing YAML frontmatter')
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break }
  }
  if (end === -1) throw new Error('skill frontmatter not terminated')
  const meta: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) {
      v = v.slice(1, -1)
    }
    meta[m[1]] = v
  }
  if (!meta.name) throw new Error('skill frontmatter requires name')
  if (!meta.description) throw new Error('skill frontmatter requires description')
  return {
    name: meta.name,
    description: meta.description,
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
    body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''),
  }
}

/**
 * Register the package's skill file on `ctx.skills`. No-op (with a warning)
 * when the skills face is absent or the file cannot be read.
 */
export function registerMissionSkill(ctx: Context): void {
  const skills = (ctx as unknown as { skills?: SkillsFace }).skills
  if (!skills || typeof skills.register !== 'function') {
    ctx.logger?.(PLUGIN).warn('skills face unavailable — skipping %s skill registration', SKILL_NAME)
    return
  }
  let parsed: ParsedSkillFile
  let skillDir: string
  try {
    // The host bundle lives at <packageRoot>/lib/index.js, so one level up
    // from the bundle's directory is the package root. link:/ and npm installs
    // both keep the real directory layout on disk, and import.meta.url is a
    // stable ESM anchor in the harness loader.
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    skillDir = join(packageRoot, 'skills', SKILL_NAME)
    parsed = parseSkillFile(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'))
    if (parsed.name !== SKILL_NAME) throw new Error(`skill file name "${parsed.name}" != ${SKILL_NAME}`)
  } catch (error) {
    ctx.logger?.(PLUGIN).warn('skill file unreadable — skipping %s skill registration: %s', SKILL_NAME, errorMessage(error))
    return
  }
  const unregister = skills.register({
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
    source: 'bundled',
    content: parsed.body,
    resourceBase: { kind: 'directory', path: skillDir },
    invocation: { modelInvocable: true, userInvocable: true },
  })
  ctx.effect(() => { unregister() }, `web-missions: skill ${SKILL_NAME}`)
}
