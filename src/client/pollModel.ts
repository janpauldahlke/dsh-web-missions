/**
 * The pane's polling policy (M6 6.4, D-M6.1) — pure, no React/node.
 *
 * The Missions pane re-fetches the board (GET /missions) every
 * POLL_INTERVAL_MS while the pane is mounted (mount ⇔ the tab is visible —
 * the tab registers without `keepMounted`, so the shell unmounts the body for
 * an inactive tab) and the browser tab is visible (document.hidden gate).
 * When the browser tab becomes visible again, it refreshes once immediately
 * instead of waiting up to a full interval.
 *
 * `createPoller` takes its whole environment as dependencies so the policy is
 * unit-testable without a browser; MissionsBody binds the real window/document
 * and disposes the poller in its effect cleanup — tab switch, tab close, or
 * plugin unload leaves no orphan poller and no global timer.
 */

/** D-M6.1: board refresh cadence (ms) while the pane is visible. */
export const POLL_INTERVAL_MS = 15_000

export interface PollerDeps {
  /** Re-fetch the board. */
  readonly sync: () => void
  /** Refresh cadence in ms. */
  readonly intervalMs: number
  /** Whether the browser tab is currently hidden (tick is skipped). */
  readonly isHidden: () => boolean
  readonly setInterval: (tick: () => void, ms: number) => number
  readonly clearInterval: (id: number) => void
  /** Subscribe to browser-tab visibility changes (fires both directions). */
  readonly onVisibilityChange: (handler: () => void) => void
  /** Unsubscribe the same handler reference. */
  readonly offVisibilityChange: (handler: () => void) => void
}

export interface Poller {
  /** Stop the interval and drop the visibility subscription. Idempotent. */
  dispose: () => void
}

/**
 * Start the visible-tab poller.
 *
 * @param deps - the environment (sync, timers, visibility) as dependencies.
 * @returns the handle; call `dispose` to tear down (idempotent).
 */
export function createPoller(deps: PollerDeps): Poller {
  const tick = (): void => {
    if (deps.isHidden()) return
    deps.sync()
  }
  const onVisible = (): void => {
    if (!deps.isHidden()) deps.sync()
  }
  const id = deps.setInterval(tick, deps.intervalMs)
  deps.onVisibilityChange(onVisible)
  let disposed = false
  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      deps.clearInterval(id)
      deps.offVisibilityChange(onVisible)
    },
  }
}
