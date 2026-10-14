/**
 * Collapsible card chrome (GPU monitor / slot-health pattern).
 *
 * - Header: chevron ▸ + label chip + optional preview stats (right)
 * - Body: only while expanded; caller wraps long content in a scroll shell
 * - Default collapsed; optional localStorage persistence per storageKey
 * - currentColor-derived ink so the card rides the theme
 */
import { useState, type CSSProperties, type ReactNode } from 'react'

export type CardTone = 'na' | 'ok' | 'warn' | 'crit'

export interface CardPreviewStat {
  text: string
  title?: string
  tone?: CardTone
}

function readOverride(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
    return null
  } catch {
    return null
  }
}

const toneColor = (t: CardTone): string | undefined => {
  if (t === 'ok') return 'color-mix(in srgb, #22c55e 70%, currentColor)'
  if (t === 'warn') return 'color-mix(in srgb, #fbbf24 75%, currentColor)'
  if (t === 'crit') return 'color-mix(in srgb, #f87171 80%, currentColor)'
  return undefined
}

export function CollapsibleCard({
  storageKey,
  label,
  tone = 'na',
  defaultExpanded = false,
  headerTitle,
  accent,
  meta,
  preview = [],
  bodyMaxHeight = 200,
  children,
}: {
  storageKey: string
  label: string
  tone?: CardTone
  defaultExpanded?: boolean
  headerTitle?: string
  accent?: { text: string; color?: string; title?: string }
  meta?: { text: string; title?: string }
  preview?: CardPreviewStat[]
  /** Scroll cap for the expanded body (R5.U1). */
  bodyMaxHeight?: number
  children: ReactNode
}): ReactNode {
  const [override, setOverride] = useState<boolean | null>(() => readOverride(storageKey))
  const expanded = override ?? defaultExpanded
  const setExpanded = (next: boolean) => {
    setOverride(next)
    try {
      localStorage.setItem(storageKey, next ? '1' : '0')
    } catch {
      /* in-memory only */
    }
  }
  const [hover, setHover] = useState(false)
  const border =
    tone === 'crit'
      ? '1px solid color-mix(in srgb, #f87171 55%, transparent)'
      : tone === 'warn'
        ? '1px solid color-mix(in srgb, #fbbf24 45%, transparent)'
        : tone === 'ok'
          ? '1px solid color-mix(in srgb, #22c55e 40%, transparent)'
          : '1px solid color-mix(in srgb, currentColor 18%, transparent)'

  return (
    <div style={{ ...shell, border, marginBottom: 8 }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        title={headerTitle}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...header,
          background: hover ? 'color-mix(in srgb, currentColor 6%, transparent)' : 'transparent',
        }}
      >
        <span
          aria-hidden
          style={{
            ...chevron,
            transform: expanded ? 'rotate(90deg)' : 'none',
          }}
        >
          ▸
        </span>
        <span style={labelChip}>{label}</span>
        {accent !== undefined && (
          <span
            title={accent.title}
            style={{
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: accent.color ?? toneColor(tone) ?? 'inherit',
            }}
          >
            {accent.text}
          </span>
        )}
        {meta !== undefined && (
          <span
            title={meta.title}
            style={{
              fontSize: 11,
              whiteSpace: 'nowrap',
              color: 'color-mix(in srgb, currentColor 55%, transparent)',
            }}
          >
            {meta.text}
          </span>
        )}
        {preview.length > 0 && (
          <span style={previewCluster}>
            {preview.map((s, i) => (
              <span
                key={i}
                title={s.title}
                style={{
                  whiteSpace: 'nowrap',
                  ...(toneColor(s.tone ?? 'na') ? { color: toneColor(s.tone ?? 'na') } : {}),
                }}
              >
                {s.text}
              </span>
            ))}
          </span>
        )}
      </div>
      {expanded && (
        <div
          style={{
            ...body,
            maxHeight: bodyMaxHeight,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

const shell: CSSProperties = {
  borderRadius: 8,
  overflow: 'hidden',
}

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 10px',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background 120ms',
}

const chevron: CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  lineHeight: 1,
  transition: 'transform 150ms',
  color: 'color-mix(in srgb, currentColor 50%, transparent)',
}

const labelChip: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'color-mix(in srgb, currentColor 12%, transparent)',
  whiteSpace: 'nowrap',
}

const previewCluster: CSSProperties = {
  marginLeft: 'auto',
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 11,
  color: 'color-mix(in srgb, currentColor 75%, transparent)',
}

const body: CSSProperties = {
  padding: '8px 10px 10px',
  borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
}
