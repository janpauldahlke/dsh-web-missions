/**
 * M6 6.1 (D-M6.4) — session visibility for the pane, v0.1: the hosts that
 * have a browser39 session dir (C7) + each host's LAST consent outcome,
 * scanned from the mission ledgers (rows with `consent_attempted` — the
 * M6 6.1 FetchedRow field; M5-era rows read as not-attempted).
 *
 * Read-only: never touches the session dirs (the fetcher owns their
 * lifecycle). The hint-line *condition* itself is client-side over the
 * `/missions/:id` rows (M6 6.3) — this route is the cheap host-side view.
 */
import { hostKey } from './depth-fence.ts'
import {
  listSessionHosts,
  sessionDirFor,
  sessionLastModified,
  sessionsRoot,
} from './sessions.ts'
import { listMissionIds, readManifest } from './store.ts'

/** Last consent outcome on a host, from the ledger. */
export interface SessionLastConsent {
  improved: boolean
  mission_id: string
  fetched_at: string
}

export interface SessionView {
  host: string
  /** Absolute session dir (the pane's hint line points operators at it). */
  dir: string
  /** Newest file mtime inside the dir, or null (empty/unreadable). */
  last_modified: string | null
  /** Newest row with `consent_attempted` on this host, or null. */
  last_consent: SessionLastConsent | null
}

export function sessionViews(root: string, sessionsDir: string = sessionsRoot()): SessionView[] {
  const views = new Map<string, SessionView>()
  for (const host of listSessionHosts(sessionsDir)) {
    const dir = sessionDirFor(sessionsDir, host)
    views.set(host, { host, dir, last_modified: sessionLastModified(dir), last_consent: null })
  }
  for (const id of listMissionIds(root)) {
    const manifest = readManifest(root, id)
    if (!manifest) continue
    for (const row of manifest.fetched) {
      if (!row.consent_attempted) continue
      let host: string
      try {
        host = hostKey(row.url)
      } catch {
        continue // non-normalizable row url — skip
      }
      const view = views.get(host)
      if (!view) continue
      if (view.last_consent === null || row.fetched_at > view.last_consent.fetched_at) {
        view.last_consent = {
          improved: row.consent_improved === true,
          mission_id: id,
          fetched_at: row.fetched_at,
        }
      }
    }
  }
  return [...views.values()].sort((a, b) => a.host.localeCompare(b.host))
}
