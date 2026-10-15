/**
 * Tiny conclusion markdown — human-readable pane, not a full MD engine.
 *
 * Supported subset (what we ask the model to emit):
 *   ## / ### headings · - / * bullets · **bold** · `code` · [label](url)
 * Everything else is plain text. No HTML, no nested lists, no tables.
 */
import type { CSSProperties, ReactNode } from 'react'

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // bold | code | markdown link — left-to-right, non-overlapping
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<strong key={`${keyPrefix}-b${i++}`}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(
        <code key={`${keyPrefix}-c${i++}`} style={codeStyle}>
          {tok.slice(1, -1)}
        </code>,
      )
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      if (lm) {
        out.push(
          <a
            key={`${keyPrefix}-a${i++}`}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            style={linkStyle}
            title={lm[2]}
          >
            {lm[1]}
          </a>,
        )
      } else {
        out.push(tok)
      }
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function ConclusionMarkdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let bi = 0

  const flushBullets = () => {
    if (bullets.length === 0) return
    const items = bullets
    bullets = []
    blocks.push(
      <ul key={`ul-${bi++}`} style={ulStyle}>
        {items.map((item, j) => (
          <li key={j} style={liStyle}>{inline(item, `li${bi}-${j}`)}</li>
        ))}
      </ul>,
    )
  }

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]
    const trimmed = raw.trim()
    if (trimmed === '') {
      flushBullets()
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      bullets.push(bullet[1])
      continue
    }
    flushBullets()
    const h3 = /^###\s+(.+)$/.exec(trimmed)
    if (h3) {
      blocks.push(<h4 key={`h3-${li}`} style={hStyle}>{inline(h3[1], `h3${li}`)}</h4>)
      continue
    }
    const h2 = /^##\s+(.+)$/.exec(trimmed)
    if (h2) {
      blocks.push(<h3 key={`h2-${li}`} style={{ ...hStyle, fontSize: 13.5 }}>{inline(h2[1], `h2${li}`)}</h3>)
      continue
    }
    blocks.push(
      <p key={`p-${li}`} style={pStyle}>{inline(trimmed, `p${li}`)}</p>,
    )
  }
  flushBullets()

  return <div style={shell}>{blocks}</div>
}

const shell: CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, #22c55e 28%, transparent)',
  background: 'color-mix(in srgb, #22c55e 7%, transparent)',
  fontSize: 12.5,
  lineHeight: 1.55,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  wordBreak: 'break-word',
}

const hStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: 0.01,
}

const pStyle: CSSProperties = {
  margin: '0 0 8px',
}

const ulStyle: CSSProperties = {
  margin: '0 0 8px',
  paddingLeft: 18,
}

const liStyle: CSSProperties = {
  marginBottom: 3,
}

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 11.5,
  padding: '0 3px',
  borderRadius: 3,
  background: 'color-mix(in srgb, currentColor 8%, transparent)',
}

const linkStyle: CSSProperties = {
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  opacity: 0.9,
}
