/**
 * The Missions pane body (M6 6.2 + R4): the operator surface.
 *
 * - Board: active XOR recent; discovery badge; store cwd from active chat.
 * - Detail: conclusion leads; briefing collapsible; mark-done stub conclusion.
 * - R4.0: seat props (sessionId + useSessions) pin the store to the open
 *   workspace cwd on tab open (long-horizon / memento pattern).
 *
 * Inline styles only (no CSS pipeline). Runtime imports: react (+jsx-runtime)
 * and the local modules — the platform baseline for the CJS bundle.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  CLEAR_ALL_ROUTE,
  HEALTH_ROUTE,
  MISSIONS_ROUTE,
  RECENTS_CLEAR_ROUTE,
  missionApiPath,
  type ClearAllPayload,
  type HealthPayload,
  type ListPayload,
  type MissionSummaryPayload,
  type RecentsClearedPayload,
  type StatusPayload,
  type StopPayload,
} from '../shared/types.ts'
import { CollapsibleCard } from './CollapsibleCard.tsx'
import {
  budgetExhausted,
  budgetLine,
  formatAge,
  formatBytes,
  formatTime,
  qualityBadge,
  sessionHint,
  shortArtifact,
} from './paneModel.ts'
import { POLL_INTERVAL_MS, createPoller } from './pollModel.ts'

type View = { kind: 'board' } | { kind: 'detail'; missionId: string }

/** Session store selector shape (framework seat prop — same as long-horizon). */
type UseSessions = <T>(selector: (state: {
  byId: Record<string, { cwd?: string | null } | undefined>
}) => T) => T

function useNoopSessions<T>(selector: (state: { byId: Record<string, never> }) => T): T {
  return selector({ byId: {} })
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function withCwd(path: string, cwd: string | null): string {
  if (!cwd) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}cwd=${encodeURIComponent(cwd)}`
}

/** Store path for the quiet chrome line — full path stays in title. */
function shortStore(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length <= 2) return cwd.startsWith('/') ? cwd : parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

/**
 * Color grammar (final):
 * - Pane chrome + labels stay neutral. Color = signal, not decoration.
 * - Green: conclusion delivered · page quality "full".
 * - Amber: conclusion missing after stop · page "thin" · hints (attention).
 * - Red: page "blocked" · budget exhausted.
 * - Active/stopped status pills stay grey/slate (lifecycle, not quality).
 * Preview chips only color when the chip itself is a quality/exhaustion signal.
 */

export function MissionsBody(props: {
  sessionId?: string
  useSessions?: UseSessions
} = {}): ReactNode {
  const { sessionId, useSessions = useNoopSessions } = props
  const sessionCwd = useSessions((sessions) => {
    if (!sessionId) return null
    const cwd = sessions.byId[sessionId]?.cwd
    return typeof cwd === 'string' && cwd.trim() ? cwd.trim() : null
  })

  const [list, setList] = useState<ListPayload | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [detail, setDetail] = useState<StatusPayload | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'board' })
  const [stopping, setStopping] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [discovery, setDiscovery] = useState<'on' | 'off' | null>(null)

  const sync = useCallback(async () => {
    try {
      const data = (await fetchJson(withCwd(MISSIONS_ROUTE, sessionCwd))) as ListPayload
      setList(data)
      setListError(null)
      setLastSync(new Date().toISOString())
      if (data.discovery === 'on' || data.discovery === 'off') setDiscovery(data.discovery)
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error))
    }
  }, [sessionCwd])

  // Health probe for discovery badge when list has not reported yet.
  useEffect(() => {
    void (async () => {
      try {
        const h = (await fetchJson(HEALTH_ROUTE)) as HealthPayload
        if (h.discovery === 'on' || h.discovery === 'off') setDiscovery(h.discovery)
      } catch { /* list sync will retry */ }
    })()
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
        const data = (await fetchJson(withCwd(missionApiPath(missionId), sessionCwd))) as StatusPayload
        if (token === detailToken.current) setDetail(data)
      } catch (error) {
        if (token === detailToken.current) {
          setDetailError(error instanceof Error ? error.message : String(error))
        }
      }
    },
    [sessionCwd],
  )

  /** Mark done / stop — works from detail or an active board row (R3.0 / R4.3 stub). */
  const markDone = useCallback(async (missionId: string, reason?: string) => {
    if (stopping) return
    setStopping(true)
    try {
      const data = (await fetchJson(withCwd(missionApiPath(missionId, 'stop'), sessionCwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: reason ?? 'marked done from pane',
          from_pane: true,
        }),
      })) as StopPayload
      if (data.ok && view.kind === 'detail' && view.missionId === missionId) {
        const token = ++detailToken.current
        const refreshed = (await fetchJson(withCwd(missionApiPath(missionId), sessionCwd))) as StatusPayload
        if (token === detailToken.current) setDetail(refreshed)
      }
    } catch {
      /* keep the last known state; the sync below re-renders the board */
    } finally {
      setStopping(false)
      await sync()
    }
  }, [view, stopping, sync, sessionCwd])

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

  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={styles.root}>
      <div style={styles.paneChrome}>
        <h2 style={styles.heading}>Missions</h2>
        {listError ? (
          <p style={styles.statusError}>unreachable · {listError}</p>
        ) : (
          <div style={styles.chromeMeta} title={list?.root ?? list?.cwd ?? undefined}>
            <span style={styles.chromeQuiet}>
              {[
                syncLabel ? `updated ${syncLabel}` : null,
                discovery ? `discovery ${discovery}` : null,
              ].filter(Boolean).join(' · ') || 'syncing…'}
            </span>
            {list?.cwd ? (
              <span style={styles.chromeStore} title={list.cwd}>
                {shortStore(list.cwd)}
                {typeof list.store_bytes === 'number' ? ` · ${formatBytes(list.store_bytes)}` : ''}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {view.kind === 'board' ? (
        <div>
          <Board
            list={list}
            stopping={stopping}
            onOpen={(id) => void openDetail(id)}
            onMarkDone={(id) => void markDone(id)}
          />
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
          onMarkDone={() => void markDone(view.missionId)}
        />
      )}
    </div>
  )
}

/** Presentational board (exported for the render smoke; no hooks). */
export function Board({
  list,
  onOpen,
  onMarkDone,
  stopping = false,
}: {
  list: ListPayload | null
  onOpen: (id: string) => void
  onMarkDone?: (id: string) => void
  stopping?: boolean
}): ReactNode {
  if (list === null) return <p style={styles.empty}>loading…</p>
  if (list.active.length === 0 && list.recents.length === 0) {
    return <p style={styles.empty}>no missions yet — start one from chat (mission_start)</p>
  }
  return (
    <div>
      {list.active.length > 0 && (
        <CollapsibleCard
          storageKey="wm-board-active"
          label="active"
          defaultExpanded={list.active.length <= 3}
          headerTitle="Active missions"
          preview={[{ text: `${list.active.length}`, title: 'active count' }]}
          bodyMaxHeight={220}
        >
          {list.active.map((row) => (
            <Row key={row.mission_id} onClick={() => onOpen(row.mission_id)}>
              <div style={styles.rowTop}>
                <RowNote note={row.note} active />
                {onMarkDone && (
                  <button
                    type="button"
                    style={styles.markDoneChip}
                    disabled={stopping}
                    title="Mark this mission done (stop)"
                    onClick={(e) => {
                      e.stopPropagation()
                      onMarkDone(row.mission_id)
                    }}
                  >
                    {stopping ? '…' : 'done'}
                  </button>
                )}
              </div>
              <RowMeta>
                in progress · started {formatTime(row.started_at)} · {row.visited} visited
                {typeof row.bytes === 'number' ? ` · ${formatBytes(row.bytes)}` : ''}
                <BudgetChip mission={row} />
                <FenceChip mission={row} />
              </RowMeta>
            </Row>
          ))}
        </CollapsibleCard>
      )}
      {list.recents.length > 0 && (
        <CollapsibleCard
          storageKey="wm-board-recents"
          label="recent"
          headerTitle="Stopped / done missions"
          preview={[{ text: `${list.recents.length}`, title: 'recent count' }]}
          bodyMaxHeight={220}
        >
          {list.recents.map((row) => (
            <Row key={row.mission_id} onClick={() => onOpen(row.mission_id)}>
              <div style={styles.rowTop}>
                <RowNote note={row.note} active={row.status === 'active'} />
                {row.status === 'active' && onMarkDone && (
                  <button
                    type="button"
                    style={styles.markDoneChip}
                    disabled={stopping}
                    title="Mark this mission done (stop)"
                    onClick={(e) => {
                      e.stopPropagation()
                      onMarkDone(row.mission_id)
                    }}
                  >
                    {stopping ? '…' : 'done'}
                  </button>
                )}
              </div>
              <RowMeta>
                {row.status} · updated {formatTime(row.updated_at)} · {row.pages} pages
                {typeof row.bytes === 'number' ? ` · ${formatBytes(row.bytes)}` : ''}
              </RowMeta>
            </Row>
          ))}
        </CollapsibleCard>
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
  onMarkDone,
}: {
  missionId: string
  detail: StatusPayload | null
  error: string | null
  hint: string | null
  stopping: boolean
  onBack: () => void
  onMarkDone: () => void
}): ReactNode {
  const briefing = detail?.briefing?.trim() ?? ''
  const hasBriefing = briefing.length > 0
  const conclusion = detail?.conclusion?.trim() ?? ''
  const cooled = detail?.host_cooldowns
    ? Object.entries(detail.host_cooldowns).filter(([, e]) => e.cooldown).map(([h]) => h)
    : []
  const exhausted = detail ? (detail.budget_exhausted || budgetExhausted(detail.budget)) : false
  const sk = (suffix: string) => `wm-detail-${missionId}-${suffix}`
  const fullCount = detail?.visited.filter((v) => v.quality === 'full').length ?? 0
  const thinCount = detail?.visited.filter((v) => v.quality === 'thin').length ?? 0
  const blockedCount = detail?.visited.filter((v) => v.quality === 'blocked').length ?? 0
  // Conclusion: green = delivered; amber only if stopped with nothing written.
  const conclusionTone = conclusion
    ? 'ok'
    : detail?.status === 'stopped'
      ? 'warn'
      : 'na'
  const hintCount = (hint ? 1 : 0) + cooled.length

  return (
    <div style={styles.detailRoot}>
      <button type="button" style={styles.backButton} onClick={onBack}>
        ← board
      </button>
      <div style={styles.detailHeader}>
        <span style={styles.detailNote}>{detail?.note ?? '…'}</span>
        <span style={styles.detailHeaderActions}>
          {detail && (
            <span
              style={detail.status === 'active' ? styles.statusActive : styles.statusStopped}
              title={detail.status === 'active' ? 'Mission running' : 'Mission stopped'}
            >
              {detail.status}
            </span>
          )}
          {detail?.status === 'active' && (
            <button type="button" style={styles.stopButtonHeader} onClick={onMarkDone} disabled={stopping}>
              {stopping ? '…' : 'mark done'}
            </button>
          )}
        </span>
      </div>
      <p style={styles.detailId} title={missionId}>{missionId}</p>
      {detail?.stop_reason ? (
        <p style={styles.outcomeLine} title={detail.stop_reason}>
          {detail.stop_reason}
        </p>
      ) : null}

      {error && <p style={styles.detailError}>load failed: {error}</p>}
      {detail === null && !error && <p style={styles.empty}>loading…</p>}

      {detail && (
        <>
          {/* Answer-first order: goal → conclusion → briefing → pages → budget → hints */}
          {detail.goal ? (
            <CollapsibleCard
              storageKey={sk('goal')}
              label="goal"
              headerTitle="Pinned research goal"
              preview={[{
                text: detail.goal.length > 48 ? `${detail.goal.slice(0, 48)}…` : detail.goal,
                title: detail.goal,
              }]}
              bodyMaxHeight={120}
            >
              <p style={styles.goalScroll}>{detail.goal}</p>
            </CollapsibleCard>
          ) : null}

          <CollapsibleCard
            storageKey={sk('conclusion')}
            label="conclusion"
            tone={conclusionTone}
            headerTitle={
              conclusion
                ? 'Green = delivered answer'
                : detail.status === 'stopped'
                  ? 'Amber = stopped with no conclusion'
                  : 'No conclusion yet'
            }
            accent={
              conclusion
                ? { text: 'delivered', color: 'color-mix(in srgb, #22c55e 70%, currentColor)' }
                : detail.status === 'stopped'
                  ? { text: 'missing', color: 'color-mix(in srgb, #fbbf24 75%, currentColor)' }
                  : undefined
            }
            preview={[{
              text: conclusion
                ? (conclusion.length > 40 ? `${conclusion.replace(/\s+/g, ' ').slice(0, 40)}…` : conclusion.replace(/\s+/g, ' '))
                : '—',
              title: conclusion || 'no conclusion yet',
            }]}
            bodyMaxHeight={220}
          >
            {conclusion ? (
              <pre style={styles.conclusion}>{conclusion}</pre>
            ) : (
              <p style={styles.empty}>
                {detail.status === 'active'
                  ? 'no conclusion yet — mission_stop({ conclusion }) or ## Conclusion in mission.md'
                  : 'no conclusion recorded'}
              </p>
            )}
          </CollapsibleCard>

          <CollapsibleCard
            storageKey={sk('briefing')}
            label="briefing"
            headerTitle="Full mission.md"
            meta={{ text: 'mission.md', title: detail.mission_md_path }}
            preview={[{
              text: hasBriefing ? `${Math.min(briefing.length, 9999)} chars` : 'empty',
              title: hasBriefing ? 'mission.md body length' : 'no briefing yet',
            }]}
            bodyMaxHeight={200}
          >
            {hasBriefing ? (
              <pre style={styles.briefing}>{briefing}</pre>
            ) : (
              <p style={styles.empty}>no briefing yet — mission.md is empty</p>
            )}
          </CollapsibleCard>

          <CollapsibleCard
            storageKey={sk('pages')}
            label="pages"
            headerTitle="Chip colors = fetch quality (full / thin / blocked)"
            preview={[
              { text: `${detail.visited.length}`, title: 'visited count' },
              ...(fullCount ? [{ text: `${fullCount} full`, title: 'quality: full', tone: 'ok' as const }] : []),
              ...(thinCount ? [{ text: `${thinCount} thin`, title: 'quality: thin', tone: 'warn' as const }] : []),
              ...(blockedCount ? [{ text: `${blockedCount} blocked`, title: 'quality: blocked', tone: 'crit' as const }] : []),
            ]}
            bodyMaxHeight={240}
          >
            {detail.visited.length === 0 ? (
              <p style={styles.empty}>no pages yet</p>
            ) : (
              <div style={styles.visitedListInner}>
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
                      <div style={styles.visitedMeta}>
                        {formatAge(row.fetched_at)} ·{' '}
                        <span style={styles.artifactId} title={row.artifact_id}>{shortArtifact(row.artifact_id)}</span>
                        {row.consent_improved === true && <span style={styles.consentMark}> ✓ consent</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CollapsibleCard>

          <CollapsibleCard
            storageKey={sk('budget')}
            label="budget"
            tone={exhausted ? 'crit' : 'na'}
            headerTitle={exhausted ? 'Red = fetch budget exhausted' : 'Fetch budget + depth/host fence'}
            accent={
              exhausted
                ? { text: 'exhausted', color: 'color-mix(in srgb, #f87171 80%, currentColor)' }
                : undefined
            }
            preview={[
              {
                text: budgetLine(detail.budget),
                title: 'remaining / max fetch_calls',
                tone: exhausted ? 'crit' : 'na',
              },
              ...(detail.fence
                ? [{
                    text: `d≤${detail.fence.maxDepth} h≤${detail.fence.maxDiscoveredHosts}`,
                    title: 'depth fence · max discovered hosts',
                  }]
                : []),
            ]}
            bodyMaxHeight={100}
          >
            <p style={exhausted ? styles.budgetBodyExhausted : styles.budgetCardBody}>
              {budgetLine(detail.budget)}
              {detail.fence
                ? ` · fence depth≤${detail.fence.maxDepth} hosts≤${detail.fence.maxDiscoveredHosts}`
                : ''}
            </p>
            {exhausted && (
              <p style={{ ...styles.hint, marginTop: 6, marginBottom: 0 }}>
                {detail.wrap_up_hint ??
                  'budget exhausted — write a conclusion and stop; do not invent more fetches'}
              </p>
            )}
          </CollapsibleCard>

          {(cooled.length > 0 || hint) && (
            <CollapsibleCard
              storageKey={sk('hints')}
              label="hints"
              tone="warn"
              headerTitle="Amber = needs attention (session walls / host cooldown)"
              accent={{ text: 'attention', color: 'color-mix(in srgb, #fbbf24 75%, currentColor)' }}
              preview={[{
                text: hintCount === 1 ? '1 note' : `${hintCount} notes`,
                title: [hint, ...cooled.map((h) => `cooldown:${h}`)].filter(Boolean).join('\n'),
              }]}
              bodyMaxHeight={160}
            >
              <div style={styles.hintsStack}>
                {cooled.map((host) => (
                  <div key={host} style={styles.hintBlock}>
                    host cooldown: {host}
                  </div>
                ))}
                {hint ? <div style={styles.hintBlock}>{hint}</div> : null}
              </div>
            </CollapsibleCard>
          )}
        </>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  /* R5.U1 — pane scrolls inside the sidebar instead of growing forever */
  root: {
    padding: 12,
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    height: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  detailRoot: {
    minHeight: 0,
  },
  paneChrome: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)',
  },
  heading: { margin: '0 0 4px', fontSize: 15, fontWeight: 600 },
  chromeMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '4px 8px',
    fontSize: 11,
    lineHeight: 1.35,
  },
  chromeQuiet: {
    opacity: 0.48,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 11,
  },
  chromeStore: {
    opacity: 0.4,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 10.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  status: { margin: '0 0 4px', opacity: 0.75, fontSize: 12 },
  statusError: { margin: '0 0 4px', color: '#f87171', fontSize: 12 },
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
  /* R5.U1 — shared scroll shells for any unit that can grow */
  boardScroll: {
    maxHeight: 220,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  cardScroll: {
    maxHeight: 180,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  hintsScroll: {
    maxHeight: 120,
    overflowY: 'auto',
    overflowX: 'hidden',
    marginBottom: 8,
  },
  row: {
    padding: '6px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.15)',
    marginBottom: 4,
  },
  rowTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowNoteActive: { fontWeight: 600, flex: 1, minWidth: 0 },
  rowNote: { fontWeight: 400, flex: 1, minWidth: 0 },
  rowMeta: { display: 'block', fontSize: 11.5, opacity: 0.7 },
  markDoneChip: {
    flexShrink: 0,
    padding: '1px 8px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'color-mix(in srgb, currentColor 6%, transparent)',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1.4,
    opacity: 0.85,
  },
  conclusion: {
    margin: 0,
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid color-mix(in srgb, #22c55e 28%, transparent)',
    background: 'color-mix(in srgb, #22c55e 7%, transparent)',
    fontSize: 12.5,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontWeight: 400,
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  briefing: {
    margin: 0,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.18)',
    background: 'color-mix(in srgb, currentColor 4%, transparent)',
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  budgetOk: { color: '#3f6212' },
  budgetExhausted: { color: '#b91c1c', fontWeight: 600 },
  budgetLine: { margin: '0 0 8px' },
  budgetCard: {
    margin: '0 0 10px',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid rgba(128,128,128,0.22)',
    background: 'color-mix(in srgb, currentColor 5%, transparent)',
  },
  budgetCardExhausted: {
    margin: '0 0 10px',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid rgba(185,28,28,0.4)',
    background: '#fee2e2',
  },
  budgetCardTitle: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.55,
    marginBottom: 2,
  },
  budgetCardBody: {
    fontSize: 12.5,
    fontWeight: 500,
    maxHeight: 72,
    overflowY: 'auto',
  },
  budgetBodyExhausted: {
    fontSize: 12.5,
    fontWeight: 600,
    color: '#b91c1c',
    maxHeight: 72,
    overflowY: 'auto',
  },
  goalCard: {
    margin: '0 0 8px',
    padding: '6px 8px',
    borderRadius: 6,
    background: 'color-mix(in srgb, currentColor 5%, transparent)',
    border: '1px solid rgba(128,128,128,0.15)',
  },
  goalScroll: {
    fontSize: 12,
    opacity: 0.9,
    maxHeight: 72,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
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
  detailHeader: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  detailHeaderActions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  detailNote: { fontWeight: 600, flex: 1, minWidth: 0 },
  /* Lifecycle only — not quality green (that is reserved for conclusion/pages). */
  statusActive: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: '1px 7px',
    borderRadius: 6,
    color: 'color-mix(in srgb, currentColor 78%, transparent)',
    background: 'color-mix(in srgb, currentColor 10%, transparent)',
    lineHeight: 1.4,
  },
  statusStopped: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: '1px 7px',
    borderRadius: 6,
    color: 'color-mix(in srgb, currentColor 55%, transparent)',
    background: 'color-mix(in srgb, currentColor 8%, transparent)',
    lineHeight: 1.4,
  },
  detailMeta: { margin: '2px 0 8px', fontSize: 11.5, opacity: 0.65, fontFamily: 'ui-monospace, monospace' },
  detailId: {
    margin: '2px 0 2px',
    fontSize: 10.5,
    opacity: 0.42,
    fontFamily: 'ui-monospace, monospace',
  },
  outcomeLine: {
    margin: '0 0 12px',
    fontSize: 12,
    lineHeight: 1.45,
    opacity: 0.68,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  } as CSSProperties,
  detailError: { color: '#f87171', fontSize: 12 },
  hint: {
    margin: '0 0 6px',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    color: '#92400e',
    background: '#fef3c7',
  },
  stopButtonHeader: {
    padding: '2px 8px',
    borderRadius: 6,
    border: '1px solid rgba(185,28,28,0.4)',
    background: '#fee2e2',
    color: '#991b1b',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1.4,
    flexShrink: 0,
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
  visitedListInner: { margin: 0 },
  visitedRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'baseline',
    padding: '6px 0',
    borderBottom: '1px solid rgba(128,128,128,0.12)',
  },
  qualityBadge: { fontSize: 10.5, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' },
  visitedUrl: { flex: '1 1 100%', wordBreak: 'break-all', fontSize: 12 },
  visitedMeta: {
    flex: '1 1 100%',
    fontSize: 11,
    opacity: 0.7,
    display: 'block',
  },
  artifactId: { fontFamily: 'ui-monospace, monospace' },
  consentMark: { color: '#14532d' },
  hintsStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  hintBlock: {
    display: 'block',
    margin: 0,
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.45,
    color: '#92400e',
    background: '#fef3c7',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
}
