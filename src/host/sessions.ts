/**
 * M5 5.4 — host-scoped browser39 sessions (C7; M_5_ledger.md "sessions").
 *
 * host-scoping = ONE browser39 session per host, shared across missions AND
 * projects:
 *
 *   ~/.dsh/browser39/sessions/<host>/
 *     config.toml    ← ours (created if absent): [session] persistence +
 *                      session_path pointing at this directory
 *     session.enc    ← browser39's (AES-256-GCM: cookies, localStorage,
 *                      history). Saved after each mutation, loaded on start.
 *
 * The fetcher points every browser39 invocation at the REQUESTED host's
 * config via `--config <dir>/config.toml`. The session file is governed by
 * the CONFIG (`[session]` section), not by any CLI flag — so the host scope
 * is exactly the config we pass, and nothing global is read or written.
 *
 * Why `watch`, not `batch` (D-M5.9): 2.0.0 one-shot `fetch` and `batch`
 * commands ALWAYS use in-memory sessions (docs, v2.0.0 `Loading Order`).
 * Only `watch`/`mcp` persist the `[session]` to disk. v0 transport = one
 * managed `watch` process per mission_fetch call: the command line(s) are
 * written BEFORE spawn (watch processes pre-existing lines at startup — no
 * startup race), the result line(s) are read from the output file, then the
 * process group is SIGTERM'd (session save flush) and the tempdir unlinked.
 * Same JSONL command/result contract as batch (C3).
 *
 * `persistSessions: false` (config, 5.1 knob) → the fetcher passes
 * `--no-persist` instead (forced in-memory; nothing written to disk).
 *
 * Escape hatch: the operator may hand-edit a host `config.toml` (e.g. add
 * `[[cookies]]` preloads — the plan's cookie-injection path); we create the
 * file ONLY if absent and never rewrite it. `BROWSER39_SESSIONS_DIR` env
 * overrides the root (test escape hatch, BROWSER39_BIN-style pattern).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Env override for the session root (test escape hatch). */
export const SESSIONS_DIR_ENV = 'BROWSER39_SESSIONS_DIR'

/**
 * Root of the host-scoped session directories.
 * Default: `~/.dsh/browser39/sessions/` (the plan's path; M6 "Clear all"
 * wipes it alongside the mission dirs).
 */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[SESSIONS_DIR_ENV]
  if (override && override.trim() !== '') return override.trim()
  return join(homedir(), '.dsh', 'browser39', 'sessions')
}

/** The session directory for a session key (C3: lowercased hostname, no port). */
export function sessionDirFor(root: string, sessionKey: string): string {
  return join(root, sessionKey)
}

export function sessionConfigPath(dir: string): string {
  return join(dir, 'config.toml')
}

/** The config.toml we write for a fresh host session directory. */
export function renderSessionConfig(dir: string): string {
  return `[session]
persistence = "disk"
session_path = "${join(dir, 'session.enc')}"
`
}

/**
 * `mkdir -p` the host session directory and ensure its `config.toml` exists.
 * CREATE-IF-ABSENT ONLY: an operator-managed host config (e.g. `[[cookies]]`
 * preloads) is used as-is — if it points the session elsewhere, the operator
 * owns that choice. Returns the config path to pass via `--config`.
 */
export function ensureSessionDir(sessionKey: string, root = sessionsRoot()): string {
  const dir = sessionDirFor(root, sessionKey)
  mkdirSync(dir, { recursive: true })
  const cfg = sessionConfigPath(dir)
  if (!existsSync(cfg)) {
    writeFileSync(cfg, renderSessionConfig(dir))
  }
  return cfg
}

// --- M6 6.1 — session visibility + wipe (C7; the pane's session data) ---------

/**
 * Hosts that have a session directory under `root` (sorted). Missing root →
 * `[]` (never throws — the pane polls this with no missions ever run).
 */
export function listSessionHosts(root: string = sessionsRoot()): string[] {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/**
 * Delete every host session directory under `root` (M6 "Clear all", D-M6.2).
 * Returns how many host dirs were removed. The root itself is kept.
 */
export function clearSessionHosts(root: string = sessionsRoot()): number {
  let removed = 0
  for (const host of listSessionHosts(root)) {
    rmSync(sessionDirFor(root, host), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

/**
 * ISO mtime of the newest file inside a host session dir (the dir may hold
 * config.toml + session.enc; anything newer wins). `null` when unreadable or
 * empty — the pane renders an unknown age rather than failing.
 */
export function sessionLastModified(dir: string): string | null {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  let newest: string | null = null
  for (const name of entries) {
    try {
      const mtime = statSync(join(dir, name)).mtime.toISOString()
      if (newest === null || mtime > newest) newest = mtime
    } catch {
      /* vanished mid-scan */
    }
  }
  return newest
}
