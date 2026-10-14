/**
 * The Missions pane body (M6 6.2): the operator surface.
 *
 * - Board: active missions first (note, started, visited, budget), then
 *   recents (note, status, updated). Click a mission → detail.
 * - Detail: visited list (URL, quality badge full/thin/blocked, consent
 *   mark, age, artifact id), budget line, stop button (POST …/:id/stop),
 *   and the cookie/session hint line when the thin+attempted-not-improved
 *   condition holds.
 * - Data: only the M1–M6 host routes (GET /missions, GET /missions/:id,
 *   POST /missions/:id/stop, POST /recents/clear, POST /clear-all).
 *   Initial load + refetch after actions; the board re-syncs every 15 s
 *   while the pane is mounted and the browser tab is visible (M6 6.4,
 *   D-M6.1) — the poller is disposed on unmount (no orphan timers, no
 *   global timers).
 *
 * Inline styles only (no CSS pipeline). Runtime imports: react (+jsx-runtime)
 * and the local modules — the platform baseline for the CJS bundle.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  CLEAR_ALL_ROUTE,
  MISSIONS_ID_PREFIX,
  MISSIONS_ROUTE,
  RECENTS_CLEAR_ROUTE,
  type ClearAllPayload,
  type ListPayload,
  type MissionSummaryPayload,
  type RecentsClearedPayload,
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
import { POLL_INTERVAL_MS, createPoller } from './pollModel.ts'

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

  // --- M6 6.4: 15 s visible-tab polling (D-M6.1) --------------------------------
  // The pane body is mounted only while its tab is visible (the tab type
  // registers without `keepMounted`, so the shell unmounts it otherwise),
  // which makes a component-scoped interval exactly "visible-tab only" with
  // no global timer. The browser-tab gate (document.hidden) skips hidden
  // ticks and refreshes once when the tab becomes visible again. Unmount
  // (tab switch/close or plugin unload via ctx.effect) disposes the poller.
  useEffect(() => {
    const poller = createPoller({
      sync: () => { void sync() },
      intervalMs: POLL_INTERVAL_MS,
      isHidden: () => (typeof document !== 'undefined' ? document.hidden : false),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      onVisibilityChange: (fn) => document.addEventListener('visibilitychange', fn),
      offVisibilityChange: (fn) => document.removeEventListener('visibilitychange', fn),
    })
    return () => poller.dispose()
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

  // --- M6 6.3: hygiene actions -------------------------------------------
  const [clearNote, setClearNote] = useState<string | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  const clearArmedTimer = useRef<number | null>(null)

  const disarmClear = useCallback(() => {
    setClearArmed(false)
    if (clearArmedTimer.current !== null) {
      window.clearTimeout(clearArmedTimer.current)
      clearArmedTimer.current = null
    }
  }, [])

  useEffect(() => () => disarmClear(), [disarmClear])

  /** Clear recents: confirm() → POST /recents/clear (keeps mission dirs). */
  const clearRecentsAction = useCallback(async () => {
    if (typeof window !== 'undefined' &&
        !window.confirm('Clear the recent-missions list? (mission data on disk is kept)')) return
    try {
      const data = (await fetchJson(RECENTS_CLEAR_ROUTE, { method: 'POST' })) as RecentsClearedPayload
      if (data.ok) {
        setClearNote(`recents cleared — ${data.cleared} row(s) removed, mission data kept`)
      } else {
        setClearNote('clear recents: no response from host')
      }
      await sync()
    } catch (error) {
      setClearNote('clear recents failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }, [sync])

  /**
   * Clear all: DOUBLE confirm (D-M6.2) — first click arms (6 s window),
   * second click executes POST /clear-all {confirm:true}. It touches
   * ~/.dsh/browser39/sessions, so no single accidental click wipes it.
   */
  const clearAllAction = useCallback(async () => {
    if (!clearArmed) {
      setClearArmed(true)
      if (clearArmedTimer.current !== null) window.clearTimeout(clearArmedTimer.current)
      clearArmedTimer.current = window.setTimeout(() => setClearArmed(false), 6000)
      return
    }
    disarmClear()
    try {
      const data = (await fetchJson(CLEAR_ALL_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })) as ClearAllPayload
      if (data.ok) {
        setClearNote(`cleared all — ${data.missions} mission(s), ${data.index_rows} index row(s), ${data.session_hosts} session host(s)`)
        setView({ kind: 'board' })
      } else {
        setClearNote('clear all: no response from host')
      }
      await sync()
    } catch (error) {
      setClearNote('clear all failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }, [clearArmed, disarmClear, sync])

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
      {list?.cwd && (
        <p style={styles.cwdLine} title={list.root ?? list.cwd}>
          store: {list.cwd}
        </p>
      )}

      {view.kind === 'board' ? (
        <div>
          <Board list={list} onOpen={(id) => void openDetail(id)} />
          {list !== null && (
            <Hygiene
              clearNote={clearNote}
              clearArmed={clearArmed}
              onClearRecents={() => void clearRecentsAction()}
              onClearAll={() => void clearAllAction()}
            />
          )}
        </div>
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

/** Presentational board (exported for the render smoke; no hooks). */
export function Board({ list, onOpen }: { list: ListPayload | null; onOpen: (id: string) => void }): ReactNode {
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
                in progress · started {formatTime(row.started_at)} · {row.visited} visited
                <BudgetChip mission={row} />
                <FenceChip mission={row} />
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

function FenceChip({ mission }: { mission: MissionSummaryPayload }): ReactNode {
  if (!mission.fence) return null
  return (
    <span style={styles.fenceChip}>
      {' '}· depth≤{mission.fence.maxDepth} · hosts≤{mission.fence.maxDiscoveredHosts}
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

/**
 * Hygiene section (M6 6.3): Clear recents (confirm) + Clear all (double
 * confirm — D-M6.2). Presentational (no hooks; exported for the render
 * smoke) — the arm/execute state machine lives in MissionsBody.
 */
export function Hygiene({
  clearNote,
  clearArmed,
  onClearRecents,
  onClearAll,
}: {
  clearNote: string | null
  clearArmed: boolean
  onClearRecents: () => void
  onClearAll: () => void
}): ReactNode {
  return (
    <div style={styles.hygiene}>
      <button style={styles.hygieneButton} onClick={onClearRecents}>
        clear recents
      </button>
      <button
        style={clearArmed ? styles.hygieneButtonArmed : styles.hygieneButtonDanger}
        onClick={onClearAll}
      >
        {clearArmed ? 'click again to clear ALL (~/.dsh sessions too)' : 'clear all'}
      </button>
      {clearNote && <p style={styles.hygieneNote}>{clearNote}</p>}
    </div>
  )
}

/** Presentational detail (exported for the render smoke; no hooks). */
export function Detail({
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
            {detail.fence
              ? ` · fence depth≤${detail.fence.maxDepth} hosts≤${detail.fence.maxDiscoveredHosts}`
              : ''}
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
  status: { margin: '0 0 4px', opacity: 0.75, fontSize: 12 },
  statusError: { margin: '0 0 10px', color: '#f87171', fontSize: 12 },
  cwdLine: {
    margin: '0 0 10px',
    fontSize: 11,
    opacity: 0.55,
    fontFamily: 'ui-monospace, monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fenceChip: { opacity: 0.85 },
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
  hygiene: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: '1px solid rgba(128,128,128,0.15)',
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  hygieneButton: {
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.3)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 12,
  },
  hygieneButtonDanger: {
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid rgba(185,28,28,0.35)',
    background: 'transparent',
    color: '#991b1b',
    cursor: 'pointer',
    fontSize: 12,
  },
  hygieneButtonArmed: {
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid #b91c1c',
    background: '#fee2e2',
    color: '#991b1b',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 12,
  },
  hygieneNote: { margin: 0, width: '100%', fontSize: 11.5, opacity: 0.8 },
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
