// src/host/store.ts
import { randomBytes } from "node:crypto";
import {
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  readdirSync as readdirSync2,
  renameSync,
  rmSync as rmSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { join as join3 } from "node:path";

// src/host/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
var CONFIG_FILENAME = "config.json";
var DEFAULT_FETCH_BUDGET = 10;
var DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
var DEFAULT_CONFIG = {
  chunkChars: 2e3,
  defaultFetchBudget: DEFAULT_FETCH_BUDGET,
  maxBytes: DEFAULT_MAX_BYTES,
  allowlist: "on",
  persistSessions: true,
  cacheHitCountsAsBudget: false,
  fetchTimeoutMs: 3e4,
  thinThresholdChars: 300,
  consentMaxAttempts: 2,
  snippetWindow: 120,
  maxDepth: 2,
  maxDiscoveredHosts: 3
};
var FIELDS = [
  { key: "chunkChars", kind: "number" },
  { key: "defaultFetchBudget", kind: "number" },
  { key: "maxBytes", kind: "number" },
  { key: "allowlist", kind: "enum", allowed: ["on", "off"] },
  { key: "persistSessions", kind: "boolean" },
  { key: "cacheHitCountsAsBudget", kind: "boolean" },
  { key: "fetchTimeoutMs", kind: "number" },
  { key: "thinThresholdChars", kind: "number" },
  { key: "consentMaxAttempts", kind: "number" },
  { key: "snippetWindow", kind: "number" },
  { key: "maxDepth", kind: "number" },
  { key: "maxDiscoveredHosts", kind: "number" }
];
function configPath(root) {
  return join(root, CONFIG_FILENAME);
}
function readConfig(root) {
  let raw;
  try {
    raw = readFileSync(configPath(root), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULT_CONFIG };
    throw new StoreError("config_unreadable", `cannot read ${CONFIG_FILENAME}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoreError("config_corrupt", `${CONFIG_FILENAME} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StoreError("config_corrupt", `${CONFIG_FILENAME} must be a JSON object`);
  }
  const record = parsed;
  const merged = { ...DEFAULT_CONFIG };
  const set = (key, value) => {
    ;
    merged[key] = value;
  };
  for (const spec of FIELDS) {
    const value = record[spec.key];
    if (value === void 0) continue;
    if (spec.kind === "enum") {
      if (typeof value !== "string" || !spec.allowed.includes(value)) {
        throw new StoreError("config_corrupt", `${CONFIG_FILENAME}: "${spec.key}" must be one of: ${spec.allowed.join(" | ")}`);
      }
      set(spec.key, value);
    } else if (spec.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new StoreError("config_corrupt", `${CONFIG_FILENAME}: "${spec.key}" must be a finite number`);
      }
      set(spec.key, value);
    } else {
      if (typeof value !== "boolean") {
        throw new StoreError("config_corrupt", `${CONFIG_FILENAME}: "${spec.key}" must be true or false`);
      }
      set(spec.key, value);
    }
  }
  return merged;
}

// src/host/sessions.ts
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var SESSIONS_DIR_ENV = "BROWSER39_SESSIONS_DIR";
function sessionsRoot(env = process.env) {
  const override = env[SESSIONS_DIR_ENV];
  if (override && override.trim() !== "") return override.trim();
  return join2(homedir(), ".dsh", "browser39", "sessions");
}
function sessionDirFor(root, sessionKey) {
  return join2(root, sessionKey);
}
function listSessionHosts(root = sessionsRoot()) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
function clearSessionHosts(root = sessionsRoot()) {
  let removed = 0;
  for (const host of listSessionHosts(root)) {
    rmSync(sessionDirFor(root, host), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

// src/host/normalize.ts
var WEB_SCHEME = /^(?:https?):$/;
function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new StoreError("normalize_failed", `unparsable url: ${raw}`);
  }
  if (!WEB_SCHEME.test(u.protocol)) {
    throw new StoreError(
      "normalize_failed",
      `unsupported scheme '${u.protocol}' (http/https only in v0): ${raw}`
    );
  }
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
  const pairs = [...new URLSearchParams(u.search).entries()];
  pairs.sort(
    (a, b) => a[0] === b[0] ? a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );
  const userinfo = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : "";
  const query = pairs.length ? `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
  return `${u.protocol}//${userinfo}${u.hostname}${u.port ? `:${u.port}` : ""}${path}${query}`;
}

// src/host/store.ts
var RECENTS_CAP = 50;
function budgetSpent(budget) {
  return budget.spent ?? 0;
}
function budgetRemaining(budget) {
  return budget.max - budgetSpent(budget);
}
function budgetView(budget) {
  return { max: budget.max, spent: budgetSpent(budget), remaining: budgetRemaining(budget), unit: "fetch_calls" };
}
function budgetExhausted(budget) {
  return budgetSpent(budget) >= budget.max;
}
function chargeBudget(root, missionId) {
  const manifest = readManifest(root, missionId);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${missionId}`);
  manifest.budget.spent = budgetSpent(manifest.budget) + 1;
  manifest.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  writeManifest(root, manifest);
  return manifest;
}
var DISCOVERY_FILENAME = "discovery.json";
function readDiscoverySurface(root, id) {
  assertSafeId(id, "mission");
  const parsed = readJsonFile(join3(missionDir(root, id), DISCOVERY_FILENAME));
  if (parsed === null) return null;
  const file = parsed;
  if (file === null || typeof file !== "object" || Array.isArray(file) || typeof file.updated_at !== "string" || !Array.isArray(file.urls)) {
    throw new StoreError("corrupt", `${DISCOVERY_FILENAME} in ${id} has a bad shape (need {updated_at: string, urls: [...]})`);
  }
  for (const entry of file.urls) {
    if (entry === null || typeof entry !== "object" || typeof entry.url !== "string") {
      throw new StoreError("corrupt", `${DISCOVERY_FILENAME} in ${id} has a bad urls[] entry (need {url: string, \u2026})`);
    }
  }
  return file;
}
var StoreError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "StoreError";
  }
};
function missionRoot(cwd) {
  return join3(cwd, ".dsh", "web-missions");
}
function missionDir(root, id) {
  return join3(root, id);
}
function manifestPath(root, id) {
  return join3(missionDir(root, id), "manifest.json");
}
function missionMdPath(root, id) {
  return join3(missionDir(root, id), "mission.md");
}
function indexPath(root) {
  return join3(root, "index.json");
}
function newMissionId() {
  return `m-${randomBytes(4).toString("hex")}`;
}
function newArtifactId() {
  return `p-${randomBytes(4).toString("hex")}`;
}
function assertSafeId(id, kind) {
  const ok = kind === "mission" ? /^m-[0-9a-f]{8}$/ : /^p-[0-9a-f]{8}$/;
  if (!ok.test(id)) throw new StoreError("bad_id", `${kind} id must match ${kind === "mission" ? "m-<8 hex>" : "p-<8 hex>"}: ${id}`);
}
function atomicWriteJson(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  writeFileSync2(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}
function atomicWriteText(path, text) {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  writeFileSync2(tmp, text, "utf8");
  renameSync(tmp, path);
}
function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new StoreError("corrupt", `cannot read ${path}: ${error.message}`);
  }
}
function readManifest(root, id) {
  assertSafeId(id, "mission");
  return readJsonFile(manifestPath(root, id));
}
function writeManifest(root, manifest) {
  atomicWriteJson(manifestPath(root, manifest.mission_id), manifest);
}
function readIndex(root) {
  const rows = readJsonFile(indexPath(root));
  return Array.isArray(rows) ? rows : [];
}
function writeIndex(root, rows) {
  atomicWriteJson(indexPath(root), rows);
}
function pageCount(root, id) {
  const pagesDir = join3(missionDir(root, id), "pages");
  try {
    return readdirSync2(pagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}
function initialMissionMd(note) {
  return `# Mission: ${note}

_status: active_

## Sources

`;
}
function appendStopFooter(root, id, reason) {
  const path = missionMdPath(root, id);
  const existing = readFileSync2(path, "utf8");
  const footer = `\u2014 stopped: ${reason?.trim() || "no reason given"} \u2014`;
  const withFooter = (existing.endsWith("\n") ? existing : `${existing}
`) + footer + "\n";
  atomicWriteText(path, withFooter);
}
function startMission(root, opts) {
  const note = opts.note?.trim();
  if (!note) throw new StoreError("note_required", "mission note is required");
  const defaultBudget = readConfig(root).defaultFetchBudget;
  if (defaultBudget <= 0 || !Number.isFinite(defaultBudget)) {
    throw new StoreError("bad_config", `defaultFetchBudget must be a positive number: ${String(defaultBudget)}`);
  }
  const budget = opts.budget ?? defaultBudget;
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new StoreError("bad_budget", `budget must be a positive number: ${String(opts.budget)}`);
  }
  const seeds = [...new Set((opts.seeds ?? []).map((s) => normalizeUrl(s)))];
  const id = newMissionId();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const manifest = {
    mission_id: id,
    note,
    ...opts.template_id ? { template_id: opts.template_id } : {},
    budget: { max: Math.floor(budget) },
    status: "active",
    created_at: now,
    updated_at: now,
    fetched: [],
    ...seeds.length > 0 ? { seeds } : {}
  };
  const dir = missionDir(root, id);
  mkdirSync2(join3(dir, "pages"), { recursive: true });
  writeManifest(root, manifest);
  atomicWriteText(missionMdPath(root, id), initialMissionMd(note));
  const row = {
    mission_id: id,
    note,
    ...opts.template_id ? { template_id: opts.template_id } : {},
    status: "active",
    started_at: now,
    updated_at: now
  };
  const rows = readIndex(root);
  rows.unshift(row);
  writeIndex(root, rows.slice(0, RECENTS_CAP));
  return manifest;
}
function stopMission(root, id, reason) {
  const manifest = readManifest(root, id);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${id}`);
  if (manifest.status !== "active") {
    return { manifest, already_stopped: true };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  manifest.status = "stopped";
  manifest.stop_reason = reason?.trim() || "no reason given";
  manifest.updated_at = now;
  writeManifest(root, manifest);
  appendStopFooter(root, id, reason);
  const rows = readIndex(root);
  const row = rows.find((r) => r.mission_id === id);
  if (row) {
    row.status = "stopped";
    row.updated_at = now;
    writeIndex(root, rows);
  }
  return { manifest, already_stopped: false };
}
function resolveMissionId(root, id) {
  if (id) {
    if (!readManifest(root, id)) throw new StoreError("unknown_mission", `no such mission: ${id}`);
    return id;
  }
  const rows = readIndex(root);
  const active = rows.find((r) => r.status === "active");
  if (!active) throw new StoreError("no_mission", "no active mission (pass mission_id or start one)");
  return active.mission_id;
}
function appendFetchedRow(root, missionId, row) {
  const manifest = readManifest(root, missionId);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${missionId}`);
  manifest.fetched.push(row);
  manifest.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  writeManifest(root, manifest);
  return manifest;
}
function updateFetchedRow(root, missionId, key, row) {
  const manifest = readManifest(root, missionId);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${missionId}`);
  const i = manifest.fetched.findIndex((r) => r.normalized_url === key);
  if (i === -1) throw new StoreError("corrupt", `no ledger row for key ${key}`);
  manifest.fetched[i] = row;
  manifest.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  writeManifest(root, manifest);
  return manifest;
}
function listMissions(root) {
  const rows = readIndex(root);
  const sum = (r) => {
    const manifest = readManifest(root, r.mission_id);
    return {
      ...r,
      pages: pageCount(root, r.mission_id),
      visited: manifest?.fetched.length ?? 0,
      // M6 6.2: the board shows budget remaining/max per active row — read
      // from the manifest the summary already loads (no new storage).
      budget: manifest ? budgetView(manifest.budget) : null
    };
  };
  return {
    active: rows.filter((r) => r.status === "active").map(sum),
    recents: rows.map(sum)
  };
}
function missionStatus(root, id) {
  const resolved = resolveMissionId(root, id);
  const manifest = readManifest(root, resolved);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${resolved}`);
  const discovery = readDiscoverySurface(root, resolved);
  return {
    ...manifest,
    budget: budgetView(manifest.budget),
    visited: manifest.fetched,
    // M7: surfaced only when present (field omitted = nothing discovered).
    ...discovery ? { discovery } : {}
  };
}
function listMissionIds(root) {
  let entries;
  try {
    entries = readdirSync2(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && /^m-[0-9a-f]{8}$/.test(e.name)).map((e) => e.name).sort();
}
function clearRecents(root) {
  const rows = readIndex(root);
  writeIndex(root, []);
  return { cleared: rows.length };
}
function clearAll(root) {
  const indexRows = readIndex(root).length;
  const ids = listMissionIds(root);
  for (const id of ids) rmSync2(missionDir(root, id), { recursive: true, force: true });
  rmSync2(indexPath(root), { force: true });
  const sessionHosts = clearSessionHosts(sessionsRoot());
  return { missions: ids.length, index_rows: indexRows, session_hosts: sessionHosts };
}
export {
  DEFAULT_FETCH_BUDGET,
  RECENTS_CAP,
  StoreError,
  appendFetchedRow,
  atomicWriteJson,
  atomicWriteText,
  budgetExhausted,
  budgetRemaining,
  budgetSpent,
  budgetView,
  chargeBudget,
  clearAll,
  clearRecents,
  listMissionIds,
  listMissions,
  missionRoot,
  missionStatus,
  newArtifactId,
  newMissionId,
  readDiscoverySurface,
  readIndex,
  readManifest,
  resolveMissionId,
  startMission,
  stopMission,
  updateFetchedRow
};
