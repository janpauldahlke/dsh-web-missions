/**
 * Pure display logic for the Missions pane (M6 6.2). No React, no node —
 * importable from the client bundle AND from a node smoke, so the operator-
 * visible rules (quality badge colors, age, the cookie/session hint) are
 * unit-testable without a browser.
 *
 * Every value rendered by the pane derives from an M1–M5 payload (the
 * shared/types.ts *Payload types); this module adds no data, only formatting
 * and the two operator-attention rules (quality color, thin-consent hint).
 */
import type { BudgetPayload, FetchedRowPayload } from '../shared/types.ts'

/** Host key per C7: lowercased hostname, no port (session dir name). */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export type QualityLevel = 'full' | 'thin' | 'blocked' | 'unknown'

export function qualityLevel(quality: string | undefined): QualityLevel {
  if (quality === 'full' || quality === 'thin' || quality === 'blocked') return quality
  return 'unknown'
}

/** Badge presentation: `full` subtle, `thin` amber, `blocked` red (plan spec). */
export interface QualityBadge {
  level: QualityLevel
  label: string
  /** Text color. */
  color: string
  /** Background (subtle chip). */
  background: string
}

export function qualityBadge(quality: string | undefined): QualityBadge {
  switch (qualityLevel(quality)) {
    case 'full':
      // subtle: muted green-grey, low contrast
      return { level: 'full', label: 'full', color: '#3f6212', background: '#ecfccb' }
    case 'thin':
      return { level: 'thin', label: 'thin', color: '#92400e', background: '#fef3c7' }
    case 'blocked':
      return { level: 'blocked', label: 'blocked', color: '#991b1b', background: '#fee2e2' }
    default:
      return { level: 'unknown', label: quality ?? 'unknown', color: '#525252', background: '#e5e5e5' }
  }
}

/** Whole days between `iso` and `now` (clamped ≥ 0). */
export function ageInDays(iso: string, now: Date = new Date()): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  const days = (now.getTime() - t) / 86_400_000
  return Math.max(0, Math.floor(days))
}

export function formatAge(iso: string, now: Date = new Date()): string {
  const d = ageInDays(iso, now)
  if (d === 0) return 'today'
  if (d === 1) return '1d'
  return `${d}d`
}

/**
 * Compact local time for board rows (HH:MM, 24-hour). Pinned to `en-GB` so
 * the output is deterministic across machines (S7: set by our code, never by
 * the host locale).
 */
export function formatTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Truncate an artifact id for the detail list. A standard id is `p-` + 8 hex
 * (10 chars) → `p-0102…`; anything ≤ 8 chars is already short enough.
 */
export function shortArtifact(artifactId: string): string {
  if (artifactId.length <= 8) return artifactId
  return artifactId.slice(0, 8) + '…'
}

/**
 * The cookie/session hint (D-M5.5/v0.1, M6 minimum form): when the mission
 * has ≥1 `thin` page with `consent_attempted && !consent_improved`, surface
 * the M5 escape hatch. Returns the hint line, or null when the condition
 * does not hold (so the line never renders otherwise).
 */
export function sessionHint(rows: FetchedRowPayload[]): string | null {
  for (const row of rows) {
    if (qualityLevel(row.quality) !== 'thin') continue
    if (row.consent_attempted !== true) continue
    if (row.consent_improved === true) continue
    const host = hostOf(row.url)
    if (!host) continue
    return `session thin on ${host} — export cookies or preload into ~/.dsh/browser39/sessions/${host}/`
  }
  return null
}

/** Budget line, e.g. `7/10 fetch calls`. */
export function budgetLine(budget: BudgetPayload): string {
  return `${budget.remaining}/${budget.max} ${budget.unit}`
}

/** True when the budget is fully spent (board dims the number red). */
export function budgetExhausted(budget: BudgetPayload): boolean {
  return budget.remaining <= 0
}
