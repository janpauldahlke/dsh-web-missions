/**
 * The Missions pane body (M0): heading + one-shot host ping + empty state.
 *
 * The ping is a single `fetch('/api/web-missions/health')` on mount — it
 * proves the host ↔ UI loop at zero polling cost (D-M0.4). No polling in M0;
 * no mission data yet (M1+ fills this pane).
 *
 * Inline styles only (no CSS pipeline). Runtime imports: react (+jsx-runtime)
 * and the local modules — the platform baseline for the CJS bundle.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { HEALTH_ROUTE, PLUGIN, VERSION, type HealthPayload } from '../shared/types.ts'

type PingState =
  | { status: 'pending' }
  | { status: 'ok'; name: string; version: string }
  | { status: 'error' }

export function MissionsBody(): ReactNode {
  const [ping, setPing] = useState<PingState>({ status: 'pending' })

  useEffect(() => {
    let cancelled = false
    fetch(HEALTH_ROUTE, { method: 'GET' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: HealthPayload) => {
        if (cancelled || !data.ok) return
        setPing({ status: 'ok', name: data.name ?? PLUGIN, version: data.version ?? VERSION })
      })
      .catch(() => {
        if (!cancelled) setPing({ status: 'error' })
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={styles.root}>
      <h2 style={styles.heading}>Missions</h2>
      <p style={ping.status === 'error' ? styles.pingError : styles.ping}>
        {ping.status === 'pending' && 'host: …'}
        {ping.status === 'ok' && `host: ok · ${ping.name} v${ping.version}`}
        {ping.status === 'error' && 'host: unreachable'}
      </p>
      <p style={styles.empty}>no missions yet</p>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { padding: 12, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 },
  heading: { margin: '0 0 8px', fontSize: 15, fontWeight: 600 },
  ping: { margin: '0 0 12px', opacity: 0.9 },
  pingError: { margin: '0 0 12px', color: '#f87171' },
  empty: { margin: 0, opacity: 0.55, fontStyle: 'italic' },
}
