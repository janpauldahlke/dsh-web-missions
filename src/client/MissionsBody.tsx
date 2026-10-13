/**
 * The Missions pane body (M6 6.2): the operator surface.
 *
 * - Board: active missions first (note, started, visited, budget), then
 *   recents (note, status, updated). Click a mission → detail.
 * - Detail: visited list (URL, quality badge full/thin/blocked, consent
 *   mark, age, artifact id), budget line, stop button (POST …/:id/stop),
 *   and the cookie/session hint line when the thin+attempted-not-improved
 *   condition holds.
 * - Data: only the M1–M5 host routes (GET /missions, GET /missions/:id,
 *   POST /missions/:id/stop). Initial load + refetch after actions; the
 *   15 s visible-tab polling arrives with M6 6.4 (D-M6.1).
 *
 * Inline styles only (no CSS pipeline). Runtime imports: react (+jsx-runtime)
 * and the local modules — the platform baseline for the CJS bundle.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  MISSIONS_ID_PREFIX,
  MISSIONS_ROUTE,
  type ListPayload,
  type MissionSummaryPayload,
  type StatusPayload,
  type StopPayload,
} from '../shared/types.ts'
import {
  budgetExhausted,
  budgetLine,
  formatAge,
  formatTime,
  qualityBadge,
  sessionHint,
  shortArtifact,
} from './paneModel.ts'

type View = { kind: 'board' } | { kind: 'detail'; missionId: string }

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function MissionsBody(): ReactNode {
  const [list, setList] = useState<ListPayload | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [detail, setDetail] = useState<StatusPayload | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'board' })
  const [stopping, setStopping] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)

  const sync = useCallback(async () => {
    try {
      const data = (await fetchJson(MISSIONS_ROUTE)) as ListPayload
      setList(data)
      setListError(null)
      setLastSync(new Date().toISOString())
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void sync()
  }, [sync])

  const detailToken = useRef(0)

  const openDetail = useCallback(
    async (missionId: string) => {
      const token = ++detailToken.current
      setView({ kind: 'detail', missionId })
      setDetail(null)
      setDetailError(null)
      try {
        const data = (await fetchJson(`${MISSIONS_ID_PREFIX}${missionId}`)) as StatusPayload
        if (token === detailToken.current) setDetail(data)
      } catch (error) {
        if (token === detailToken.current) {
          setDetailError(error instanceof Error ? error.message : String(error))
        }
      }
    },
    [],
  )

  const stopMission = useCallback(async () => {
    if (view.kind !== 'detail' || stopping) return
    setStopping(true)
    const missionId = view.missionId
    try {
      const data = (await fetchJson(`${MISSIONS_ID_PREFIX}${missionId}/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })) as StopPayload
      if (data.ok) {
        const token = ++detailToken.current
        const refreshed = (await fetchJson(`${MISSIONS_ID_PREFIX}${missionId}`)) as StatusPayload
        if (token === detailToken.current) setDetail(refreshed)
      }
    } catch {
      /* keep the last known state; the sync below re-renders the board */
    } finally {
      setStopping(false)
      await sync()
    }
  }, [view, stopping, sync])

  const hint = view.kind === 'detail' && detail ? sessionHint(detail.visited) : null

  return (
    <div style={styles.root}>
      <h2 style={styles.heading}>Missions</h2>
      <p style={listError ? styles.statusError : styles.status}>
        {listError
          ? `host: unreachable (${listError})`
          : lastSync
            ? `host: ok · updated ${new Date(lastSync).toLocaleTimeString()}`
            : 'host: …'}
      </p>

      {view.kind === 'board' ? (
        <Board list={list} onOpen={(id) => void openDetail(id)} />
      ) : (
        <Detail
          missionId={view.missionId}
          detail={detail}
          error={detailError}
          hint={hint}
          stopping={stopping}
          onBack={() => setView({ kind: 'board' })}
          onStop={() => void stopMission()}
        />
      )}
    </div>
  )
}

function Board({ list, onOpen }: { list: ListPayload | null; onOpen: (id: string) => void }): ReactNode {
  if (list === null) return <p style={styles.empty}>loading…</p>
  if (list.active.length === 0 && list.recents.length === 0) {
    return <p style={styles.empty}>no missions yet — start one from chat (mission_start)</p>
  }
  return (
    <div>
      {list.active.length > 0 && (
        <Section title={`active (${list.active.length})`}>
          {list.active.map((row) => (
            <Row key={row.mission_id} onClick={() => onOpen(row.mission_id)}>
              <RowNote note={row.note} active />
              <RowMeta>
                started {formatTime(row.started_at)} · {row.visited} visited
                <BudgetChip mission={row} />
              </RowMeta>
            </Row>
          ))}
        </Section>
      )}
      {list.recents.length > 0 && (
        <Section title={`recent (${list.recents.length})`}>
          {list.recents.map((row) => (
            <Row key={row.mission_id} onClick={() => onOpen(row.mission_id)}>
              <RowNote note={row.note} active={row.status === 'active'} />
              <RowMeta>
                {row.status} · updated {formatTime(row.updated_at)} · {row.pages} pages
              </RowMeta>
            </Row>
          ))}
        </Section>
      )}
    </div>
  )
}

function RowNote({ note, active }: { note: string; active: boolean }): ReactNode {
  return <span style={active ? styles.rowNoteActive : styles.rowNote}>{note}</span>
}

function RowMeta({ children }: { children: ReactNode }): ReactNode {
  return <span style={styles.rowMeta}>{children}</span>
}

function BudgetChip({ mission }: { mission: MissionSummaryPayload }): ReactNode {
  if (!mission.budget) return null
  const exhausted = budgetExhausted(mission.budget)
  return (
    <span style={exhausted ? styles.budgetExhausted : styles.budgetOk}>
      {' '}· {budgetLine(mission.budget)}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function Row({ children, onClick }: { children: ReactNode; onClick: () => void }): ReactNode {
  return (
    <div style={styles.row} onClick={onClick} role="button" tabIndex={0}>
      {children}
    </div>
  )
}

function Detail({
  missionId,
  detail,
  error,
  hint,
  stopping,
  onBack,
  onStop,
}: {
  missionId: string
  detail: StatusPayload | null
  error: string | null
  hint: string | null
  stopping: boolean
  onBack: () => void
  onStop: () => void
}): ReactNode {
  return (
    <div>
      <button style={styles.backButton} onClick={onBack}>
        ← board
      </button>
      <div style={styles.detailHeader}>
        <span style={styles.detailNote}>{detail?.note ?? '…'}</span>
        {detail && (
          <span style={detail.status === 'active' ? styles.statusActive : styles.statusStopped}>
            {detail.status}
          </span>
        )}
      </div>
      <p style={styles.detailMeta}>
        {missionId}
        {detail?.stop_reason ? ` · stopped: ${detail.stop_reason}` : ''}
      </p>

      {error && <p style={styles.detailError}>load failed: {error}</p>}
      {detail === null && !error && <p style={styles.empty}>loading…</p>}

      {detail && (
        <>
          <p style={budgetExhausted(detail.budget) ? styles.budgetExhausted : styles.budgetLine}>
            budget {budgetLine(detail.budget)}
          </p>
          {hint && <p style={styles.hint}>{hint}</p>}
          {detail.status === 'active' && (
            <button style={styles.stopButton} onClick={onStop} disabled={stopping}>
              {stopping ? 'stopping…' : 'stop mission'}
            </button>
          )}
          {detail.visited.length === 0 ? (
            <p style={styles.empty}>no pages yet</p>
          ) : (
            <div style={styles.visitedList}>
              {detail.visited.map((row) => {
                const badge = qualityBadge(row.quality)
                return (
                  <div key={row.artifact_id} style={styles.visitedRow}>
                    <span style={{ ...styles.qualityBadge, color: badge.color, background: badge.background }}>
                      {badge.label}
                    </span>
                    <span style={styles.visitedUrl} title={row.url}>
                      {row.url}
                    </span>
                    <span style={styles.visitedMeta}>
                      {formatAge(row.fetched_at)} · <span style={styles.artifactId} title={row.artifact_id}>{shortArtifact(row.artifact_id)}</span>
                      {row.consent_improved === true && <span style={styles.consentMark}> ✓ consent</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { padding: 12, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 },
  heading: { margin: '0 0 6px', fontSize: 15, fontWeight: 600 },
  status: { margin: '0 0 10px', opacity: 0.75, fontSize: 12 },
  statusError: { margin: '0 0 10px', color: '#f87171', fontSize: 12 },
  empty: { margin: 0, opacity: 0.55, fontStyle: 'italic' },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.55, margin: '0 0 4px' },
  row: {
    padding: '6px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.15)',
    marginBottom: 4,
  },
  rowNoteActive: { fontWeight: 600 },
  rowNote: { fontWeight: 400 },
  rowMeta: { display: 'block', fontSize: 11.5, opacity: 0.7 },
  budgetOk: { color: '#3f6212' },
  budgetExhausted: { color: '#b91c1c', fontWeight: 600 },
  budgetLine: { margin: '0 0 8px' },
  backButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    marginBottom: 6,
    fontSize: 13,
    color: 'inherit',
    opacity: 0.7,
  },
  detailHeader: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' },
  detailNote: { fontWeight: 600 },
  statusActive: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#14532d',
    background: '#dcfce7',
  },
  statusStopped: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 8,
    color: '#525252',
    background: '#e5e5e5',
  },
  detailMeta: { margin: '2px 0 8px', fontSize: 11.5, opacity: 0.65, fontFamily: 'ui-monospace, monospace' },
  detailError: { color: '#f87171', fontSize: 12 },
  hint: {
    margin: '0 0 8px',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    color: '#92400e',
    background: '#fef3c7',
  },
  stopButton: {
    marginTop: 4,
    marginBottom: 10,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid rgba(185,28,28,0.4)',
    background: '#fee2e2',
    color: '#991b1b',
    cursor: 'pointer',
    fontSize: 12.5,
  },
  visitedList: { marginTop: 6 },
  visitedRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'baseline',
    padding: '4px 0',
    borderBottom: '1px solid rgba(128,128,128,0.12)',
  },
  qualityBadge: { fontSize: 10.5, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' },
  visitedUrl: { flex: 1, wordBreak: 'break-all', fontSize: 12 },
  visitedMeta: { fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap' },
  artifactId: { fontFamily: 'ui-monospace, monospace' },
  consentMark: { color: '#14532d' },
}
