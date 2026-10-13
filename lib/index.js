// src/shared/types.ts
var PLUGIN = "dsh-local-web-missions";
var VERSION = "1.0.0";
var HEALTH_ROUTE = "/api/web-missions/health";
var MISSIONS_ROUTE = "/api/web-missions/missions";
var MISSIONS_ID_PREFIX = "/api/web-missions/missions";
var MISSION_ID_PATTERN = /^m-[0-9a-f]{8}$/;
var RECENTS_CLEAR_ROUTE = "/api/web-missions/recents/clear";
var CLEAR_ALL_ROUTE = "/api/web-missions/clear-all";
var SESSIONS_ROUTE = "/api/web-missions/sessions";
var DO_NOT_CLAIM = "do not claim content from this page";

// src/host/routes.ts
import { URL as URL2 } from "node:url";

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
function sessionConfigPath(dir) {
  return join2(dir, "config.toml");
}
function renderSessionConfig(dir) {
  return `[session]
persistence = "disk"
session_path = "${join2(dir, "session.enc")}"
`;
}
function ensureSessionDir(sessionKey, root = sessionsRoot()) {
  const dir = sessionDirFor(root, sessionKey);
  mkdirSync(dir, { recursive: true });
  const cfg = sessionConfigPath(dir);
  if (!existsSync(cfg)) {
    writeFileSync(cfg, renderSessionConfig(dir));
  }
  return cfg;
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
function sessionLastModified(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let newest = null;
  for (const name2 of entries) {
    try {
      const mtime = statSync(join2(dir, name2)).mtime.toISOString();
      if (newest === null || mtime > newest) newest = mtime;
    } catch {
    }
  }
  return newest;
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
  return { ...manifest, budget: budgetView(manifest.budget), visited: manifest.fetched };
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

// src/host/depth-fence.ts
import { existsSync as existsSync2, readFileSync as readFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
var FENCE_HINT = "fence refused this fetch: follow a nearer link, raise the knob in config, or start a new mission rooted at the URL";
function hostKey(url) {
  return new URL(url).hostname.toLowerCase();
}
function manifestSeeds(manifest) {
  return Array.isArray(manifest.seeds) ? manifest.seeds : [];
}
function seedHosts(manifest) {
  const hosts = /* @__PURE__ */ new Set();
  for (const seed of manifestSeeds(manifest)) {
    try {
      hosts.add(hostKey(seed));
    } catch {
    }
  }
  return hosts;
}
function discoveredHosts(manifest) {
  const exempt = seedHosts(manifest);
  const hosts = /* @__PURE__ */ new Set();
  for (const row of manifest.fetched) {
    try {
      const host = hostKey(row.url);
      if (!exempt.has(host)) hosts.add(host);
    } catch {
    }
  }
  return hosts;
}
function readStoredLinks(root, missionId, artifactId) {
  const path = join4(root, missionId, "pages", artifactId, "links.json");
  if (!existsSync2(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function computeLineage(root, manifest, url) {
  const key = normalizeUrl(url);
  if (manifestSeeds(manifest).includes(key)) {
    return { depth: 0, parent_artifact_id: null };
  }
  const candidates = [];
  for (const row of manifest.fetched) {
    const rowDepth = typeof row.depth === "number" ? row.depth : 0;
    if (row.normalized_url === key) {
      candidates.push({ depth: rowDepth, parent_artifact_id: row.parent_artifact_id ?? null });
    }
    for (const link of readStoredLinks(root, manifest.mission_id, row.artifact_id)) {
      let linkKey;
      try {
        linkKey = normalizeUrl(link.url);
      } catch {
        continue;
      }
      if (linkKey === key) {
        candidates.push({ depth: rowDepth + 1, parent_artifact_id: row.artifact_id });
      }
    }
  }
  if (candidates.length === 0) {
    return { depth: 0, parent_artifact_id: null };
  }
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    if (c.depth < best.depth || c.depth === best.depth && (c.parent_artifact_id ?? "") < (best.parent_artifact_id ?? "")) {
      best = c;
    }
  }
  return best;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
function checkDepthFence(root, manifest, url, knobs) {
  const key = normalizeUrl(url);
  const lineage = computeLineage(root, manifest, key);
  if (lineage.depth > knobs.maxDepth) {
    throw new StoreError(
      "depth_exceeded",
      `${url} is ${lineage.depth} hops from nearest seed (maxDepth: ${knobs.maxDepth}) \u2014 ${FENCE_HINT}`
    );
  }
  const host = hostKey(key);
  const exempt = seedHosts(manifest);
  const discovered = discoveredHosts(manifest);
  const isNewHost = !exempt.has(host) && !discovered.has(host);
  if (isNewHost && discovered.size >= knobs.maxDiscoveredHosts) {
    throw new StoreError(
      "host_breadth_exceeded",
      `${host} would be the ${ordinal(discovered.size + 1)} non-seed host (maxDiscoveredHosts: ${knobs.maxDiscoveredHosts}) \u2014 ${FENCE_HINT}`
    );
  }
  return {
    ...lineage,
    discovered_hosts: discovered.size,
    new_host: isNewHost ? host : null
  };
}

// src/host/sessions-view.ts
function sessionViews(root, sessionsDir = sessionsRoot()) {
  const views = /* @__PURE__ */ new Map();
  for (const host of listSessionHosts(sessionsDir)) {
    const dir = sessionDirFor(sessionsDir, host);
    views.set(host, { host, dir, last_modified: sessionLastModified(dir), last_consent: null });
  }
  for (const id of listMissionIds(root)) {
    const manifest = readManifest(root, id);
    if (!manifest) continue;
    for (const row of manifest.fetched) {
      if (!row.consent_attempted) continue;
      let host;
      try {
        host = hostKey(row.url);
      } catch {
        continue;
      }
      const view = views.get(host);
      if (!view) continue;
      if (view.last_consent === null || row.fetched_at > view.last_consent.fetched_at) {
        view.last_consent = {
          improved: row.consent_improved === true,
          mission_id: id,
          fetched_at: row.fetched_at
        };
      }
    }
  }
  return [...views.values()].sort((a, b) => a.host.localeCompare(b.host));
}

// src/host/routes.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function sendError(res, status, code, message) {
  send(res, status, { ok: false, error: `${code}: ${message}` });
}
function httpStatusFor(error) {
  if (error instanceof StoreError) {
    if (error.code === "unknown_mission" || error.code === "no_mission") return 404;
    if (error.code === "bad_id" || error.code === "note_required" || error.code === "bad_budget") return 400;
    return 500;
  }
  return 500;
}
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
function registerMissionsRoutes(ctx) {
  const root = missionRoot(process.cwd());
  const unregisterList = ctx.webServer.register({
    kind: "exact",
    path: MISSIONS_ROUTE,
    handler: (req, res) => {
      if (req.method !== "GET") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        send(res, 200, listMissions(root));
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error));
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) });
        }
      }
    }
  });
  ctx.effect(() => unregisterList, "web-missions: /api/web-missions/missions route");
  const stopSuffix = new RegExp(`^(${MISSION_ID_PATTERN.source.slice(1, -1)})\\/stop$`);
  const unregisterStatus = ctx.webServer.register({
    kind: "prefix",
    path: MISSIONS_ID_PREFIX,
    handler: (req, res) => {
      void (async () => {
        const host = req.headers.host ?? "127.0.0.1";
        const url = new URL2(req.url ?? MISSIONS_ID_PREFIX, `http://${host}`);
        if (url.pathname === MISSIONS_ID_PREFIX) {
          if (req.method !== "GET") {
            send(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          send(res, 404, { ok: false, error: "not found" });
          return;
        }
        const remainder = url.pathname.slice(MISSIONS_ID_PREFIX.length + 1);
        if (req.method === "POST") {
          const match = remainder.match(stopSuffix);
          if (!match) {
            sendError(res, 404, "unknown_mission", `no such mission: ${remainder}`);
            return;
          }
          const stopId = match[1];
          let reason;
          try {
            const body = await readJsonBody(req);
            if (body !== null && typeof body === "object" && "reason" in body) {
              const r = body.reason;
              if (typeof r === "string" && r.trim() !== "") reason = r.trim();
            }
          } catch {
          }
          try {
            const { manifest, already_stopped } = stopMission(root, stopId, reason);
            send(res, 200, {
              ok: true,
              mission_id: manifest.mission_id,
              status: manifest.status,
              stop_reason: manifest.stop_reason ?? null,
              already_stopped,
              updated_at: manifest.updated_at
            });
          } catch (error) {
            if (error instanceof StoreError) {
              sendError(res, httpStatusFor(error), error.code, errorMessage(error));
            } else {
              send(res, 500, { ok: false, error: errorMessage(error) });
            }
          }
          return;
        }
        if (req.method !== "GET") {
          send(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        if (!MISSION_ID_PATTERN.test(remainder)) {
          sendError(res, 404, "unknown_mission", `no such mission: ${remainder}`);
          return;
        }
        try {
          send(res, 200, missionStatus(root, remainder));
        } catch (error) {
          if (error instanceof StoreError) {
            sendError(res, httpStatusFor(error), error.code, errorMessage(error));
          } else {
            send(res, 500, { ok: false, error: errorMessage(error) });
          }
        }
      })();
    }
  });
  ctx.effect(() => unregisterStatus, "web-missions: /api/web-missions/missions/:id route");
  const unregisterRecentsClear = ctx.webServer.register({
    kind: "exact",
    path: RECENTS_CLEAR_ROUTE,
    handler: (req, res) => {
      if (req.method !== "POST") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        send(res, 200, { ok: true, ...clearRecents(root) });
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error));
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) });
        }
      }
    }
  });
  ctx.effect(() => unregisterRecentsClear, "web-missions: /api/web-missions/recents/clear route");
  const unregisterClearAll = ctx.webServer.register({
    kind: "exact",
    path: CLEAR_ALL_ROUTE,
    handler: (req, res) => {
      void (async () => {
        if (req.method !== "POST") {
          send(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "invalid_body", "body must be JSON");
          return;
        }
        if (body === null || typeof body !== "object" || body.confirm !== true) {
          sendError(res, 400, "confirm_required", 'send { "confirm": true } to clear missions + sessions');
          return;
        }
        try {
          send(res, 200, { ok: true, ...clearAll(root) });
        } catch (error) {
          if (error instanceof StoreError) {
            sendError(res, httpStatusFor(error), error.code, errorMessage(error));
          } else {
            send(res, 500, { ok: false, error: errorMessage(error) });
          }
        }
      })();
    }
  });
  ctx.effect(() => unregisterClearAll, "web-missions: /api/web-missions/clear-all route");
  const unregisterSessions = ctx.webServer.register({
    kind: "exact",
    path: SESSIONS_ROUTE,
    handler: (req, res) => {
      if (req.method !== "GET") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        send(res, 200, { ok: true, sessions: sessionViews(root) });
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error));
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) });
        }
      }
    }
  });
  ctx.effect(() => unregisterSessions, "web-missions: /api/web-missions/sessions route");
}

// src/host/skill.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { dirname, join as join5 } from "node:path";
import { fileURLToPath } from "node:url";
var SKILL_NAME = "web-mission-workflow";
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
function parseSkillFile(raw) {
  const lines = raw.split("\n");
  if (lines[0] !== "---") throw new Error("skill file missing YAML frontmatter");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("skill frontmatter not terminated");
  const meta = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v.startsWith("'") && v.endsWith("'") || v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    meta[m[1]] = v;
  }
  if (!meta.name) throw new Error("skill frontmatter requires name");
  if (!meta.description) throw new Error("skill frontmatter requires description");
  return {
    name: meta.name,
    description: meta.description,
    ...meta.whenToUse ? { whenToUse: meta.whenToUse } : {},
    body: lines.slice(end + 1).join("\n").replace(/^\n+/, "")
  };
}
function registerMissionSkill(ctx) {
  const skills = ctx.skills;
  if (!skills || typeof skills.register !== "function") {
    ctx.logger?.(PLUGIN).warn("skills face unavailable \u2014 skipping %s skill registration", SKILL_NAME);
    return;
  }
  let parsed;
  let skillDir;
  try {
    const packageRoot = join5(dirname(fileURLToPath(import.meta.url)), "..");
    skillDir = join5(packageRoot, "skills", SKILL_NAME);
    parsed = parseSkillFile(readFileSync4(join5(skillDir, "SKILL.md"), "utf8"));
    if (parsed.name !== SKILL_NAME) throw new Error(`skill file name "${parsed.name}" != ${SKILL_NAME}`);
  } catch (error) {
    ctx.logger?.(PLUGIN).warn("skill file unreadable \u2014 skipping %s skill registration: %s", SKILL_NAME, errorMessage2(error));
    return;
  }
  const unregister = skills.register({
    name: parsed.name,
    description: parsed.description,
    ...parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {},
    source: "bundled",
    content: parsed.body,
    resourceBase: { kind: "directory", path: skillDir },
    invocation: { modelInvocable: true, userInvocable: true }
  });
  ctx.effect(() => {
    unregister();
  }, `web-missions: skill ${SKILL_NAME}`);
}

// src/host/fetcher.ts
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync as existsSync3,
  mkdtempSync,
  readFileSync as readFileSync5,
  rmSync as rmSync3,
  statSync as statSync2,
  writeFileSync as writeFileSync3
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname as dirname2, join as join6 } from "node:path";
var CMP_MARKERS = [
  "cookie",
  "consent",
  "datenschutz",
  "akzeptieren",
  "accept all",
  "alle akzeptieren"
];
var DEFAULT_FETCH_TIMEOUT_MS = 3e4;
var DEFAULT_THIN_THRESHOLD_CHARS = 300;
var CMP_SCAN_CHARS = 500;
function clickScript(label) {
  const t = JSON.stringify(label.trim()).toLowerCase();
  return `(function(){var t=${t};var els=document.querySelectorAll('a,button,input[type=submit],input[type=button],label');for(var i=0;i<els.length;i++){var e=els[i];var txt=(e.textContent||'').trim();if(txt.toLowerCase()===t){e.click();return 'clicked';}}return 'notfound';})()`;
}
var FetchError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "FetchError";
  }
};
function truncateToBytes(content, maxBytes) {
  const buf = Buffer.from(content, "utf8");
  if (buf.length <= maxBytes) return { content, bytes: buf.length, truncated: false };
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 192) === 128) cut--;
  return { content: buf.subarray(0, cut).toString("utf8"), bytes: cut, truncated: true };
}
var WATCH_SHUTDOWN_GRACE_MS = 1500;
var RESULT_POLL_MS = 75;
function resolveBrowser39Bin(explicit) {
  const envBin = explicit ?? process.env.BROWSER39_BIN;
  if (envBin && envBin.trim() !== "") return { cmd: envBin.trim(), args: [] };
  try {
    const require2 = createRequire(import.meta.url);
    const pkgJson = require2.resolve("@aquintanar/browser39/package.json");
    const binJs = join6(dirname2(pkgJson), "bin.js");
    if (existsSync3(binJs)) return { cmd: process.execPath, args: [binJs] };
  } catch {
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join6(dir, "browser39");
    try {
      if (statSync2(candidate).mode & 73) return { cmd: candidate, args: [] };
    } catch {
    }
  }
  return null;
}
function assessQuality(opts) {
  const { status, title, content, thinThresholdChars } = opts;
  if (status >= 400) {
    return { quality: "blocked", qualitySignals: [`http-${status}`] };
  }
  if (content.trim() === "") {
    return { quality: "blocked", qualitySignals: ["empty-content"] };
  }
  const signals = [];
  if (content.length < thinThresholdChars) {
    signals.push(`text<${thinThresholdChars}chars`);
  }
  const scan = `${title} ${content.slice(0, CMP_SCAN_CHARS)}`.toLowerCase();
  for (const marker of CMP_MARKERS) {
    if (scan.includes(marker)) signals.push(`cmp-marker:${marker}`);
  }
  if (signals.length > 0) return { quality: "thin", qualitySignals: signals };
  return { quality: "full", qualitySignals: [] };
}
function tail(s, max = 200) {
  const t = s.trim();
  return t.length > max ? `\u2026${t.slice(-max)}` : t;
}
var Browser39Fetcher = class _Browser39Fetcher {
  constructor(config = {}) {
    this.config = config;
  }
  get timeoutMs() {
    return this.config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }
  get thinThresholdChars() {
    return this.config.thinThresholdChars ?? DEFAULT_THIN_THRESHOLD_CHARS;
  }
  get persistSessions() {
    return this.config.persistSessions ?? true;
  }
  get maxBytes() {
    return this.config.maxBytes ?? DEFAULT_MAX_BYTES;
  }
  /** v0 fetch options (2.0.0 contract; `show_selectors_first` defaults true
   *  in 2.0.0 → stub pages; we want the raw page). */
  static FETCH_OPTIONS = {
    include_links: true,
    strip_nav: true,
    show_selectors_first: false
  };
  fetchCommand(id, seq, url) {
    return { id, action: "fetch", v: 1, seq, url, options: _Browser39Fetcher.FETCH_OPTIONS };
  }
  async fetch(url, opts) {
    const lines = await this.runBatch([this.fetchCommand("f1", 1, url)], opts);
    const line = lines.get("f1");
    if (!line) throw new FetchError("fetch_failed", "browser39 returned no result line");
    if (line.ok === false) {
      throw new FetchError(
        "fetch_failed",
        `browser39 rejected fetch: ${line.error ?? "unknown error"} (code: ${line.code ?? "unknown"})`
      );
    }
    if (line.ok !== true) {
      throw new FetchError("fetch_failed", "malformed browser39 result line (no ok flag)");
    }
    return this.toFetchedPage(url, line);
  }
  /**
   * C10 (M5 5.5): one consent attempt in the SAME host session — ONE
   * browser39 invocation (a batch), so cookies land and stick within the
   * call and flush to the on-disk session on SIGTERM:
   *
   *   c1  fetch(url)                 restore the page (a fresh process has
   *                                  no DOM; the click script needs one)
   *   c2  dom_query(clickScript)     best-effort element `.click()` — a
   *                                  no-op on 2.0.0 page handlers, kept for
   *                                  transports that honor it
   *   c3  fetch(linkUrl)  [if any]   the WORKING path: navigating a link whose
   *                                  text matches the label is a real
   *                                  navigation — Set-Cookie lands
   *   f1  fetch(url)                 the measuring refetch (the line we wait for)
   *
   * null = the batch failed (spawn/timeout/abort) — the caller counts the
   * attempt and continues.
   */
  async consentAttempt(url, label, linkUrl, opts) {
    const commands = [
      this.fetchCommand("c1", 1, url),
      { id: "c2", action: "dom_query", v: 1, seq: 2, script: clickScript(label) }
    ];
    if (linkUrl !== null) commands.push(this.fetchCommand("c3", 3, linkUrl));
    commands.push(this.fetchCommand("f1", commands.length + 1, url));
    let lines;
    try {
      lines = await this.runBatch(commands, opts);
    } catch {
      return null;
    }
    const refetch = lines.get("f1");
    if (!refetch || refetch.ok !== true) return { clicked: linkUrl !== null, page: null };
    const clickLine = lines.get("c2");
    const elementClicked = clickLine?.ok === true && String(clickLine.result ?? "") === "clicked";
    return {
      clicked: elementClicked || linkUrl !== null,
      page: this.toFetchedPage(url, refetch)
    };
  }
  /**
   * One managed `watch` process per batch (D-M5.9): write the command
   * line(s) BEFORE spawn (watch processes pre-existing lines at startup —
   * no startup race), spawn `browser39 watch <in> --output <out>`, poll the
   * output file until the LAST command's result line appears, then SIGTERM
   * the group (flush the session save) → SIGKILL after a grace → resolve
   * with all result lines (id → line). The deadline covers the whole call.
   */
  async runBatch(commands, opts) {
    const bin = resolveBrowser39Bin(this.config.browser39Bin);
    if (!bin) {
      throw new FetchError(
        "spawn_failed",
        "browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH)"
      );
    }
    const sessionConfig = this.persistSessions && opts?.sessionKey ? ensureSessionDir(opts.sessionKey, this.config.sessionsRoot ?? sessionsRoot()) : null;
    const workdir = mkdtempSync(join6(tmpdir(), "web-missions-b39-"));
    const inPath = join6(workdir, "commands.jsonl");
    const outPath = join6(workdir, "results.jsonl");
    try {
      writeFileSync3(inPath, commands.map((c) => JSON.stringify(c)).join("\n") + "\n");
      writeFileSync3(outPath, "");
      return await this.spawnWatch(
        bin,
        inPath,
        outPath,
        sessionConfig,
        commands[commands.length - 1].id,
        commands.length > 1,
        opts?.signal
      );
    } finally {
      rmSync3(workdir, { recursive: true, force: true });
    }
  }
  spawnWatch(bin, inPath, outPath, sessionConfig, waitId, isBatch, signal) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        const args = [...bin.args, "watch", inPath];
        if (sessionConfig) args.push("--config", sessionConfig);
        else args.push("--no-persist");
        args.push("--output", outPath);
        child = spawn(bin.cmd, args, {
          cwd: dirname2(inPath),
          stdio: ["ignore", "ignore", "pipe"],
          // New process group so timeout/abort kills the whole tree (bin.js
          // execFileSyncs the platform binary as its child).
          detached: true
        });
      } catch (e) {
        reject(
          new FetchError("spawn_failed", `browser39 spawn failed: ${e.message}`)
        );
        return;
      }
      let stderrBuf = "";
      let settled = false;
      let pollTimer = null;
      let deadlineTimer = null;
      let shutdownStarted = false;
      const finish = (err, lines) => {
        if (settled) return;
        settled = true;
        if (pollTimer !== null) clearInterval(pollTimer);
        if (deadlineTimer !== null) clearTimeout(deadlineTimer);
        signal?.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve(lines);
      };
      const beginShutdown = () => {
        if (shutdownStarted) return;
        shutdownStarted = true;
        this.killGroup(child, "SIGTERM");
        setTimeout(() => this.killGroup(child, "SIGKILL"), WATCH_SHUTDOWN_GRACE_MS).unref();
      };
      const readResults = () => {
        let raw;
        try {
          raw = readFileSync5(outPath, "utf8");
        } catch {
          return void 0;
        }
        const map = /* @__PURE__ */ new Map();
        for (const phys of raw.split("\n")) {
          if (phys.trim() === "") continue;
          try {
            const l = JSON.parse(phys);
            if (typeof l.id === "string") map.set(l.id, l);
          } catch {
          }
        }
        return map.has(waitId) ? map : void 0;
      };
      const onAbort = () => {
        beginShutdown();
        finish(new FetchError("fetch_failed", "fetch aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      deadlineTimer = setTimeout(() => {
        beginShutdown();
        finish(
          new FetchError(
            "fetch_failed",
            `browser39 ${isBatch ? "consent batch" : "fetch"} timed out after ${this.timeoutMs} ms`
          )
        );
      }, this.timeoutMs);
      pollTimer = setInterval(() => {
        const lines = readResults();
        if (lines) {
          beginShutdown();
          finish(null, lines);
        }
      }, RESULT_POLL_MS);
      child.stderr?.on("data", (d) => {
        stderrBuf = (stderrBuf + d.toString()).slice(-2e3);
      });
      child.on("error", (e) => {
        finish(
          new FetchError(
            "spawn_failed",
            e.code === "ENOENT" ? `browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH): ${tail(e.message)}` : `browser39 spawn failed: ${tail(e.message)}`
          )
        );
      });
      child.on("close", (code) => {
        const lines = readResults();
        if (lines) {
          finish(null, lines);
          return;
        }
        finish(
          new FetchError(
            "fetch_failed",
            `browser39 exited (code ${code}) without a result line: ${tail(stderrBuf)}`
          )
        );
      });
    });
  }
  killGroup(child, signalName) {
    try {
      if (child.pid !== void 0) {
        process.kill(-child.pid, signalName);
        return;
      }
    } catch {
    }
    try {
      child.kill(signalName);
    } catch {
    }
  }
  toFetchedPage(requestedUrl, line) {
    const finalUrl = line.url ?? requestedUrl;
    const status = typeof line.status === "number" ? line.status : 0;
    const cap = truncateToBytes(line.markdown ?? "", this.maxBytes);
    const content = cap.content;
    const links = [];
    for (const l of line.links ?? []) {
      if (typeof l.href !== "string" || l.href === "") continue;
      try {
        const absolute = new URL(l.href, finalUrl).toString();
        if (!/^(?:https?):$/.test(new URL(absolute).protocol)) continue;
        links.push({ url: absolute, text: l.text ?? "" });
      } catch {
      }
    }
    const byteLength = cap.truncated ? cap.bytes : typeof line.stats?.content_bytes === "number" ? line.stats.content_bytes : cap.bytes;
    const { quality, qualitySignals } = assessQuality({
      status,
      title: line.title ?? "",
      content,
      thinThresholdChars: this.thinThresholdChars
    });
    const qualitySignalsFinal = cap.truncated ? [...qualitySignals, "truncated"] : qualitySignals;
    return {
      url: requestedUrl,
      finalUrl,
      status,
      contentType: line.meta?.content_type ?? "",
      title: line.title ?? "",
      content,
      links,
      byteLength,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      quality,
      qualitySignals: qualitySignalsFinal,
      consentAttempted: false,
      consentImproved: false
    };
  }
};

// src/host/artifacts.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync6, readdirSync as readdirSync3, rmSync as rmSync4 } from "node:fs";
import { join as join7 } from "node:path";
var DEFAULT_CHUNK_CHARS = 2e3;
var PREVIEW_HEAD_CHARS = 300;
function splitContent(content, chunkChars) {
  if (chunkChars <= 0) throw new Error(`chunkChars must be positive: ${chunkChars}`);
  if (content.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    const limit = start + chunkChars;
    if (limit >= content.length) {
      chunks.push(content.slice(start));
      break;
    }
    const lo = Math.max(start + Math.floor(chunkChars * 0.8), start + 1);
    const hi = Math.min(start + Math.ceil(chunkChars * 1.2), content.length);
    let cut = -1;
    for (let i = limit; i >= lo; i--) {
      if (content.charCodeAt(i) === 10) {
        cut = i;
        break;
      }
    }
    if (cut === -1) {
      for (let i = Math.min(limit + 1, hi); i < hi; i++) {
        if (content.charCodeAt(i) === 10) {
          cut = i;
          break;
        }
      }
    }
    const endCut = cut === -1 ? limit : cut + 1;
    chunks.push(content.slice(start, endCut));
    start = endCut;
  }
  return chunks;
}
function dedupeLinks(links) {
  const seen = /* @__PURE__ */ new Map();
  for (const link of links) {
    let key;
    try {
      key = normalizeUrl(link.url);
    } catch {
      continue;
    }
    if (!seen.has(key)) seen.set(key, { url: link.url, text: link.text });
  }
  return [...seen.values()];
}
function storeArtifact(root, missionId, page, opts = {}) {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const artifactId = opts.artifactId ?? newArtifactId();
  const dir = join7(root, missionId, "pages", artifactId);
  if (opts.replace) {
    if (existsSync4(dir)) {
      for (const e of readdirSync3(dir, { withFileTypes: true })) {
        if (e.isDirectory()) rmSync4(join7(dir, e.name), { recursive: true, force: true });
        else rmSync4(join7(dir, e.name), { force: true });
      }
    }
    mkdirSync3(dir, { recursive: true });
  } else {
    mkdirSync3(dir, { recursive: true });
  }
  const storedAt = (/* @__PURE__ */ new Date()).toISOString();
  const pageRecord = {
    ...page,
    artifact_id: artifactId,
    mission_id: missionId,
    normalized_url: normalizeUrl(page.finalUrl),
    // D-M2.2: ledger key = normalized final URL
    stored_at: storedAt,
    // M5 5.3: depth fence — persist the fetch depth for M4 find matches.
    ...opts.depth !== void 0 ? { depth: opts.depth } : {}
  };
  atomicWriteJson(join7(dir, "page.json"), pageRecord);
  const links = dedupeLinks(page.links);
  if (links.length > 0) atomicWriteJson(join7(dir, "links.json"), links);
  let chunkCount = 0;
  if (page.quality !== "blocked" && page.content.trim().length > 0) {
    const chunks = splitContent(page.content, chunkChars);
    mkdirSync3(join7(dir, "chunks"), { recursive: true });
    for (const [i, chunk] of chunks.entries()) {
      atomicWriteText(join7(dir, "chunks", `${String(i).padStart(3, "0")}.md`), chunk);
    }
    chunkCount = chunks.length;
  }
  return {
    artifactId,
    chunkCount,
    previewHead: page.content.slice(0, PREVIEW_HEAD_CHARS),
    links
  };
}
function readArtifact(root, missionId, artifactId) {
  const dir = join7(root, missionId, "pages", artifactId);
  const pagePath = join7(dir, "page.json");
  if (!existsSync4(pagePath)) {
    throw new StoreError("corrupt", `page.json missing for artifact ${artifactId}`);
  }
  let page;
  try {
    page = JSON.parse(readFileSync6(pagePath, "utf8"));
  } catch (error) {
    throw new StoreError("corrupt", `cannot read ${pagePath}: ${error.message}`);
  }
  let links = [];
  const linksPath = join7(dir, "links.json");
  if (existsSync4(linksPath)) {
    try {
      const parsed = JSON.parse(readFileSync6(linksPath, "utf8"));
      if (Array.isArray(parsed)) links = parsed;
    } catch {
      links = [];
    }
  }
  let chunkCount = 0;
  const chunksDir = join7(dir, "chunks");
  if (existsSync4(chunksDir)) {
    chunkCount = readdirSync3(chunksDir, { withFileTypes: true }).filter((e) => e.isFile()).length;
  }
  return { page, links, chunkCount };
}

// src/host/allowlist.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { dirname as dirname3, join as join8 } from "node:path";
var ALLOWLIST_FILENAME = "allowlist.txt";
function allowlistPath(root) {
  return join8(dirname3(root), ALLOWLIST_FILENAME);
}
function parsePattern(line) {
  if (line.startsWith("*.")) {
    const suffix = line.slice(2).toLowerCase();
    if (!suffix) throw new StoreError("allowlist_invalid", `invalid pattern: ${line}`);
    return { kind: "suffix", suffix };
  }
  if (line.includes("://")) {
    let u;
    try {
      u = new URL(line);
    } catch {
      throw new StoreError("allowlist_invalid", `invalid pattern (not a URL): ${line}`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new StoreError("allowlist_invalid", `invalid pattern (only http/https allowed): ${line}`);
    }
    return { kind: "originPath", origin: u.origin, path: u.pathname };
  }
  const host = line.toLowerCase();
  if (!host || host.includes("/") || host.includes("*")) {
    throw new StoreError("allowlist_invalid", `invalid pattern: ${line}`);
  }
  return { kind: "host", host };
}
function parseAllowlist(text) {
  const patterns = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    try {
      patterns.push(parsePattern(line));
    } catch (error) {
      if (error instanceof StoreError) {
        throw new StoreError("allowlist_invalid", `line ${i + 1}: ${error.message}`);
      }
      throw error;
    }
  });
  return patterns;
}
function loadAllowlist(root) {
  let raw;
  try {
    raw = readFileSync7(allowlistPath(root), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new StoreError(
      "allowlist_unreadable",
      `cannot read ${ALLOWLIST_FILENAME}: ${error.message}`
    );
  }
  return parseAllowlist(raw);
}
function isAllowed(url, patterns) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  for (const p of patterns) {
    if (p.kind === "host" && host === p.host) return true;
    if (p.kind === "suffix" && (host === p.suffix || host.endsWith(`.${p.suffix}`))) return true;
    if (p.kind === "originPath" && u.origin === p.origin && u.pathname.startsWith(p.path)) return true;
  }
  return false;
}
function checkAllowlist(url, patterns) {
  if (!isAllowed(url, patterns)) {
    throw new StoreError("allowlist_denied", `${url} not in .dsh/allowlist.txt`);
  }
}

// src/host/consent.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { dirname as dirname4, join as join9 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var ConsentProfilesError = class extends Error {
  code = "consent_profiles_invalid";
  constructor(detail) {
    super(detail);
    this.name = "ConsentProfilesError";
  }
};
var BARE_KEY = /^[A-Za-z0-9_-]+$/;
function fail(source, line, detail) {
  throw new ConsentProfilesError(`${source}: line ${line}: ${detail}`);
}
function stripComment(line) {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inDouble) {
      if (c === "\\") i++;
      else if (c === '"') inDouble = false;
    } else if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (c === '"') {
      inDouble = true;
    } else if (c === "'") {
      inSingle = true;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}
function parseString(raw, source, line) {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const body = s.slice(1, -1);
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = body[++i];
      if (e === "n") out += "\n";
      else if (e === "t") out += "	";
      else if (e === "r") out += "\r";
      else if (e === '"' || e === "\\") out += e;
      else if (e === "u") {
        const hex = body.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(source, line, `bad \\u escape in string`);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else fail(source, line, `bad escape \\${e} in string`);
    }
    return out;
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  fail(source, line, `expected a quoted string, got: ${s.slice(0, 40)}`);
}
function parseValue(raw, source, line) {
  const s = raw.trim();
  if (s === "") fail(source, line, "missing value");
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) fail(source, line, "unterminated array");
    let inner = s.slice(1, -1).trim();
    if (inner.endsWith(",")) inner = inner.slice(0, -1).trim();
    if (inner === "") return [];
    const parts = splitTopLevel(inner, source, line);
    return parts.map((p) => parseString(p, source, line));
  }
  return parseString(s, source, line);
}
function splitTopLevel(s, source, line) {
  const out = [];
  let cur = "";
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inDouble) {
      cur += c;
      if (c === "\\") cur += s[++i];
      else if (c === '"') inDouble = false;
    } else if (inSingle) {
      cur += c;
      if (c === "'") inSingle = false;
    } else if (c === '"') {
      inDouble = true;
      cur += c;
    } else if (c === "'") {
      inSingle = true;
      cur += c;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (inDouble || inSingle) fail(source, line, "unterminated string in array");
  out.push(cur);
  return out;
}
function parseConsentProfiles(text, source) {
  const root = {};
  let current = null;
  const tables = {};
  const logical = [];
  let buf = "";
  let bufLine = 0;
  let depth = 0;
  for (const [idx, phys] of text.split("\n").entries()) {
    const stripped = stripComment(phys).trim();
    if (buf === "" && stripped === "") continue;
    if (buf === "") bufLine = idx + 1;
    buf += (buf === "" ? "" : " ") + stripped;
    depth = bracketDepth(buf);
    if (depth <= 0) {
      logical.push({ text: buf, line: bufLine });
      buf = "";
    }
  }
  if (buf !== "") fail(source, bufLine, `unterminated array: ${buf.slice(0, 40)}`);
  for (const { text: l, line } of logical) {
    if (l.startsWith("[[")) {
      if (!l.endsWith("]]")) fail(source, line, "malformed [[table]] header");
      const name2 = l.slice(2, -2).trim();
      if (!BARE_KEY.test(name2)) fail(source, line, `bad table name: ${name2}`);
      const arr = tables[name2] ??= [];
      const table = {};
      arr.push(table);
      current = table;
      continue;
    }
    if (l.startsWith("[")) {
      if (!l.endsWith("]")) fail(source, line, "malformed [table] header");
      const name2 = l.slice(1, -1).trim();
      if (!BARE_KEY.test(name2)) fail(source, line, `bad table name: ${name2}`);
      const table = {};
      root[name2] = table;
      current = table;
      continue;
    }
    const eq = findTopLevelEq(l);
    if (eq < 0) fail(source, line, `expected key = value: ${l.slice(0, 40)}`);
    const key = l.slice(0, eq).trim();
    if (key === "") fail(source, line, "missing key");
    if (!BARE_KEY.test(key)) fail(source, line, `bad key: ${key}`);
    const value = parseValue(l.slice(eq + 1), source, line);
    if (current) current[key] = value;
    else root[key] = value;
  }
  for (const name2 of Object.keys(tables)) root[name2] = tables[name2];
  const out = { generic: [], hosts: [] };
  for (const [key, value] of Object.entries(root)) {
    if (key === "generic") {
      if (typeof value === "string") out.generic = [value];
      else if (Array.isArray(value) && value.every((v) => typeof v === "string"))
        out.generic = value;
      else fail(source, 0, "`generic` must be a string array");
    } else if (key === "hosts") {
      if (!Array.isArray(value)) fail(source, 0, "`hosts` must be an array of tables");
      for (const entry of value) {
        if (typeof entry !== "object" || entry === null)
          fail(source, 0, "each [[hosts]] table must be a table");
        const t = entry;
        for (const hk of Object.keys(t)) {
          if (hk !== "host" && hk !== "acceptLabels")
            fail(source, 0, `unknown key in [[hosts]]: ${hk}`);
        }
        const host = t.host;
        if (typeof host !== "string" || host.trim() === "")
          fail(source, 0, "[[hosts]] requires a non-empty `host` string");
        let labels = [];
        if (t.acceptLabels !== void 0) {
          if (!Array.isArray(t.acceptLabels) || !t.acceptLabels.every((v) => typeof v === "string"))
            fail(source, 0, "`acceptLabels` must be a string array");
          labels = t.acceptLabels;
        }
        out.hosts.push({ host: host.trim(), acceptLabels: labels });
      }
    } else {
      fail(source, 0, `unknown top-level key: ${key} (expected: generic, hosts)`);
    }
  }
  return out;
}
function bracketDepth(s) {
  let d = 0;
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inDouble) {
      if (c === "\\") i++;
      else if (c === '"') inDouble = false;
    } else if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === "[") d++;
    else if (c === "]") d--;
  }
  return d;
}
function findTopLevelEq(s) {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inDouble) {
      if (c === "\\") i++;
      else if (c === '"') inDouble = false;
    } else if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === "=") return i;
  }
  return -1;
}
var DEFAULT_PROFILES = {
  generic: [
    "Accept all",
    "Alle akzeptieren",
    "Zustimmen",
    "Akzeptieren",
    "Allow all",
    "I agree",
    "Yes, I agree",
    "Agree",
    "Einverstanden"
  ],
  hosts: [
    { host: "kicker.de", acceptLabels: ["Alle akzeptieren", "Accept all", "Zustimmen", "Akzeptieren"] },
    { host: "gamestar.de", acceptLabels: ["Alle akzeptieren", "Accept all", "Zustimmen", "I agree"] },
    { host: "bbc.com", acceptLabels: ["Yes, I agree", "Allow all", "Accept"] },
    { host: "spiegel.de", acceptLabels: ["Alle akzeptieren", "Akzeptieren", "Zustimmen"] },
    { host: "taz.de", acceptLabels: ["Alle akzeptieren", "Akzeptieren", "Zustimmen"] }
  ]
};
function shippedAssetPath() {
  return join9(dirname4(fileURLToPath2(import.meta.url)), "..", "assets", "consent_profiles.toml");
}
function loadConsentProfiles(missionRoot2) {
  const override = join9(missionRoot2, "consent_profiles.toml");
  try {
    return parseConsentProfiles(readFileSync8(override, "utf8"), override);
  } catch (e) {
    if (e instanceof ConsentProfilesError) throw e;
    if (e.code !== "ENOENT") {
      throw new ConsentProfilesError(`cannot read ${override}: ${e.message}`);
    }
  }
  try {
    return parseConsentProfiles(readFileSync8(shippedAssetPath(), "utf8"), "assets/consent_profiles.toml");
  } catch (e) {
    if (e instanceof ConsentProfilesError) {
      return DEFAULT_PROFILES;
    }
    return DEFAULT_PROFILES;
  }
}
function labelsForHost(profiles, host) {
  const key = host.trim().toLowerCase();
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const profile = profiles.hosts.find((p) => p.host.toLowerCase() === key);
  for (const label of profile?.acceptLabels ?? []) pushLabel(out, seen, label);
  for (const label of profiles.generic) pushLabel(out, seen, label);
  return out;
}
function pushLabel(out, seen, label) {
  const k = label.trim().toLowerCase();
  if (k === "" || seen.has(k)) return;
  seen.add(k);
  out.push(label);
}
var LabelClickTactic = class {
  id = "label-click";
  async run(page, deps) {
    let best = null;
    let total = 0;
    let failed = 0;
    for (const label of deps.labels.slice(0, deps.maxAttempts)) {
      total++;
      const link = matchLink(deps.links, label);
      let attempt = null;
      try {
        attempt = await deps.attempt(label, link ? link.url : null);
      } catch {
        attempt = null;
      }
      if (attempt === null) {
        failed++;
        continue;
      }
      if (!attempt.clicked) failed++;
      if (attempt.page === null) continue;
      if (best === null || attempt.page.content.length > best.content.length) {
        best = attempt.page;
      }
      if (attempt.page.content.length >= deps.thinThreshold) break;
    }
    return { page: best, clicksTotal: total, clicksFailed: failed };
  }
};
var TACTICS = [new LabelClickTactic()];
function matchLink(links, label) {
  const t = label.trim().toLowerCase();
  if (t === "") return null;
  return links.find((l) => l.text.trim().toLowerCase() === t) ?? null;
}
function isConsentWall(page) {
  if (page.quality !== "thin") return false;
  return page.qualitySignals.some((s) => s.startsWith("cmp-marker:"));
}
async function runConsent(page, deps) {
  if (deps.maxAttempts <= 0 || deps.labels.length === 0) {
    return {
      page,
      outcome: { attempted: false, improved: false, allClicksFailed: false }
    };
  }
  let best = page;
  let total = 0;
  let failed = 0;
  for (const tactic of TACTICS) {
    const res = await tactic.run(best, deps);
    total += res.clicksTotal;
    failed += res.clicksFailed;
    if (res.page !== null && res.page.content.length > best.content.length) {
      best = res.page;
    }
  }
  const improved = best.content.length > page.content.length;
  const outcome = {
    attempted: true,
    improved,
    allClicksFailed: total > 0 && failed >= total
  };
  const out = best === page ? { ...page } : { ...best };
  out.consentAttempted = true;
  out.consentImproved = improved;
  return { page: out, outcome };
}
function consentNextStepHint(page, outcome) {
  const base = page.quality === "blocked" ? `fetch blocked (see quality_signals) \u2014 ${DO_NOT_CLAIM}; do not re-fetch this URL; pick another` : `page is thin (short or likely a consent wall) \u2014 ${DO_NOT_CLAIM}; try a sample link or re-fetch with force`;
  if (!outcome.attempted) return base;
  if (outcome.improved) {
    const after = page.quality === "full" ? "search it with mission_find or fetch one of the sample links" : `still thin \u2014 ${DO_NOT_CLAIM}; try a sample link or re-fetch with force`;
    return `consent: accept worked \u2014 page improved; ${after}`;
  }
  return `${base}. consent: accept was attempted but the wall persists \u2014 ${DO_NOT_CLAIM}. Operator escape: preload the accepted cookies into the host session (~/.dsh/browser39/sessions/<host>/config.toml, [[cookies]]) and re-fetch with force.`;
}

// src/host/fetch-service.ts
function hostSessionKey(url) {
  return new URL(url).hostname.toLowerCase();
}
function findLedgerRow(manifest, key) {
  return manifest.fetched.find(
    (r) => r.normalized_url === key || (r.requested_keys?.includes(key) ?? false)
  );
}
function ageDays(fetchedAt, nowMs) {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((nowMs - t) / 864e5 * 100) / 100);
}
function nextStepHint(quality) {
  switch (quality) {
    case "full":
      return "page stored \u2014 search it with mission_find or fetch one of the sample links";
    case "thin":
      return `page is thin (short or likely a consent wall) \u2014 ${DO_NOT_CLAIM}; try a sample link or re-fetch with force`;
    case "blocked":
      return `fetch blocked (see quality_signals) \u2014 ${DO_NOT_CLAIM}; do not re-fetch this URL; pick another`;
  }
}
function cachedNextStepHint(quality, age) {
  if (quality === "full") {
    return `cached: already stored (age ${age}d). Use mission_find, or pass force: true to re-fetch.`;
  }
  return `cached: stored as ${quality} (age ${age}d) \u2014 ${DO_NOT_CLAIM}. Re-fetch with force: true if you expect new content.`;
}
function honestyGate(hint, quality) {
  if (quality === "full" || hint.includes(DO_NOT_CLAIM)) return hint;
  return `${hint} \u2014 ${DO_NOT_CLAIM}`;
}
async function runFetch(root, fetcher, args, opts = {}) {
  const now = opts.now ?? Date.now;
  const config = readConfig(root);
  const hitsCost = opts.cacheHitCountsAsBudget ?? config.cacheHitCountsAsBudget;
  const url = args.url?.trim();
  if (!url) throw new StoreError("bad_args", "url is required");
  const missionId = resolveMissionId(root, args.mission_id);
  const requestedKey = normalizeUrl(url);
  let manifest = readManifest(root, missionId);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${missionId}`);
  const hit = findLedgerRow(manifest, requestedKey);
  const force = args.force === true;
  const hitFree = hit && !force;
  if (hitFree) {
    if (hitsCost && budgetExhausted(manifest.budget)) {
      throw new StoreError(
        "budget_exhausted",
        `${manifest.budget.max} fetch calls used; budget exhausted \u2014 start a new mission to continue (no override in v0)`
      );
    }
    if (hitsCost) {
      manifest = chargeBudget(root, missionId);
    }
    return buildHitReceipt(root, missionId, url, manifest, hit, now());
  }
  const allowlist = config.allowlist === "on" ? loadAllowlist(root) : null;
  if (allowlist) {
    checkAllowlist(url, allowlist);
  }
  const fence = checkDepthFence(root, manifest, url, config);
  if (budgetExhausted(manifest.budget)) {
    throw new StoreError(
      "budget_exhausted",
      `${manifest.budget.max} fetch calls used; budget exhausted \u2014 start a new mission to continue (no override in v0)`
    );
  }
  manifest = chargeBudget(root, missionId);
  let page = await fetcher.fetch(url, { sessionKey: hostSessionKey(url) });
  let consentOutcome = null;
  if (isConsentWall(page) && config.consentMaxAttempts > 0 && typeof fetcher.consentAttempt === "function") {
    const host = hostSessionKey(url);
    const profiles = loadConsentProfiles(root);
    const res = await runConsent(page, {
      host,
      url,
      labels: labelsForHost(profiles, host),
      // consent-link egress is allowlist-gated; the fence does not apply
      // (part of the fetch, not a crawl step).
      links: allowlist ? page.links.filter((l) => isAllowed(l.url, allowlist)) : page.links,
      thinThreshold: config.thinThresholdChars,
      maxAttempts: config.consentMaxAttempts,
      attempt: (label, linkUrl) => fetcher.consentAttempt(url, label, linkUrl, { sessionKey: host })
    });
    page = res.page;
    consentOutcome = res.outcome;
  }
  const finalKey = normalizeUrl(page.finalUrl);
  const target = manifest.fetched.find((r) => r.normalized_url === finalKey) ?? (force && hit ? hit : void 0);
  const stored = storeArtifact(root, missionId, page, {
    chunkChars: args.chunkChars,
    ...target ? { artifactId: target.artifact_id, replace: true } : {},
    // M5 5.3: persist the fetch depth onto page.json (M4 find matches read it).
    depth: fence.depth
  });
  const requestedKeys = [.../* @__PURE__ */ new Set([...target?.requested_keys ?? [], requestedKey])];
  const row = {
    normalized_url: finalKey,
    url: page.finalUrl,
    artifact_id: stored.artifactId,
    quality: page.quality,
    fetched_at: page.fetchedAt,
    // M6 6.1: the pane's thin-page hint needs attempted AND improved (the
    // receipt has both; the ledger row now carries both too).
    consent_attempted: page.consentAttempted,
    consent_improved: page.consentImproved,
    requested_keys: requestedKeys,
    // C6 audit: a ledger row is only ever written by a charged (non-cached)
    // attempt in v0 — the field makes that explicit.
    budget_charged: true,
    // M5 5.3 (depth fence): lineage at the moment of fetch — the min over
    // the ledger BEFORE this row was written (deterministic, D-M5.7).
    depth: fence.depth,
    parent_artifact_id: fence.parent_artifact_id
  };
  const updated = target ? updateFetchedRow(root, missionId, target.normalized_url, row) : appendFetchedRow(root, missionId, row);
  const others = manifest.fetched.filter((r) => r !== target);
  const sameHost = others.filter((r) => {
    try {
      return hostSessionKey(r.url) === hostSessionKey(url);
    } catch {
      return false;
    }
  }).length;
  const hintFindFirst = sameHost >= 1 ? `this host has ${sameHost} stored pages \u2014 consider mission_find before fetching a new path` : void 0;
  return {
    mission_id: missionId,
    artifact_id: stored.artifactId,
    url,
    final_url: page.finalUrl,
    cached: false,
    fetched_at: page.fetchedAt,
    age_days: 0,
    page_quality: page.quality,
    quality_signals: page.qualitySignals,
    consent_attempted: page.consentAttempted,
    consent_improved: page.consentImproved,
    chunk_count: stored.chunkCount,
    preview_head: stored.previewHead,
    // M5 5.3: live lineage from the depth fence (gate 4b, pre-spawn).
    depth: fence.depth,
    parent_artifact_id: fence.parent_artifact_id,
    budget: budgetView(manifest.budget),
    visited_count: updated.fetched.length,
    next_step_hint: honestyGate(
      consentOutcome?.attempted ? consentNextStepHint(page, consentOutcome) : nextStepHint(page.quality),
      page.quality
    ),
    sample_links: stored.links.slice(0, 5).map((l) => l.url),
    ...hintFindFirst ? { hint_find_first: hintFindFirst } : {}
  };
}
function buildHitReceipt(root, missionId, url, manifest, hit, nowMs) {
  const stored = readArtifact(root, missionId, hit.artifact_id);
  const age = ageDays(hit.fetched_at, nowMs);
  return {
    mission_id: missionId,
    artifact_id: hit.artifact_id,
    url,
    final_url: hit.url,
    cached: true,
    fetched_at: hit.fetched_at,
    age_days: age,
    page_quality: stored.page.quality,
    quality_signals: stored.page.qualitySignals ?? [],
    consent_attempted: stored.page.consentAttempted ?? false,
    consent_improved: stored.page.consentImproved ?? false,
    chunk_count: stored.chunkCount,
    preview_head: (stored.page.content ?? "").slice(0, PREVIEW_HEAD_CHARS),
    // M5 5.3: the stored lineage (hits are not re-gated, D-M5.4). M2-era
    // rows predate the fields → 0/null (schema stability).
    depth: hit.depth ?? 0,
    parent_artifact_id: hit.parent_artifact_id ?? null,
    budget: budgetView(manifest.budget),
    visited_count: manifest.fetched.length,
    next_step_hint: honestyGate(cachedNextStepHint(stored.page.quality, age), stored.page.quality),
    sample_links: stored.links.slice(0, 5).map((l) => l.url)
  };
}

// src/host/retrieval.ts
import { existsSync as existsSync5, readFileSync as readFileSync9, readdirSync as readdirSync4 } from "node:fs";
import { join as join10 } from "node:path";
var DEFAULT_SNIPPET_WINDOW = 120;
var DEFAULT_FIND_LIMIT = 5;
var MAX_FIND_LIMIT = 20;
var MIN_TOKEN_LENGTH = 3;
var MAX_LINK_MATCHES = 5;
var FindError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "FindError";
  }
};
function tokenize(text, minLen = MIN_TOKEN_LENGTH) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= minLen);
}
function uniqueTerms(terms) {
  return [...new Set(terms)];
}
function loadCorpus(root, missionId) {
  const chunks = [];
  const links = [];
  const pagesDir = join10(root, missionId, "pages");
  if (!existsSync5(pagesDir)) return { chunks, links };
  for (const entry of readdirSync4(pagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const artifactId = entry.name;
    const dir = join10(pagesDir, artifactId);
    const pagePath = join10(dir, "page.json");
    if (!existsSync5(pagePath)) continue;
    let page;
    try {
      page = JSON.parse(readFileSync9(pagePath, "utf8"));
    } catch {
      continue;
    }
    const url = typeof page.finalUrl === "string" ? page.finalUrl : typeof page.url === "string" ? page.url : "";
    const fetchedAt = typeof page.fetchedAt === "string" ? page.fetchedAt : "";
    const depth = typeof page.depth === "number" ? page.depth : 0;
    const linksPath = join10(dir, "links.json");
    if (existsSync5(linksPath)) {
      try {
        const parsed = JSON.parse(readFileSync9(linksPath, "utf8"));
        if (Array.isArray(parsed)) {
          for (const l of parsed) {
            if (l && typeof l === "object" && typeof l.url === "string" && typeof l.text === "string") {
              links.push({ url: l.url, text: l.text, tokens: tokenize(l.text) });
            }
          }
        }
      } catch {
      }
    }
    const chunksDir = join10(dir, "chunks");
    if (existsSync5(chunksDir)) {
      const files = readdirSync4(chunksDir, { withFileTypes: true }).filter((e) => e.isFile() && /^\d{3}\.md$/.test(e.name)).map((e) => e.name).sort();
      for (const name2 of files) {
        const chunk = parseInt(name2.slice(0, 3), 10);
        try {
          const text = readFileSync9(join10(chunksDir, name2), "utf8");
          chunks.push({ artifactId, url, chunk, text, tokens: tokenize(text), fetchedAt, depth });
        } catch {
          continue;
        }
      }
    }
  }
  return { chunks, links };
}
function termWeights(terms, docs) {
  const weights = /* @__PURE__ */ new Map();
  const n = docs.length;
  if (n === 0) {
    for (const t of terms) weights.set(t, 0);
    return weights;
  }
  const df = /* @__PURE__ */ new Map();
  for (const doc of docs) {
    const present = new Set(doc.tokens);
    for (const t of terms) if (present.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  for (const t of terms) {
    const d = df.get(t) ?? 0;
    weights.set(t, d > 0 ? 1 + Math.log10(n / d) : 0);
  }
  return weights;
}
function countTokens(tokens) {
  const counts = /* @__PURE__ */ new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}
function scoreDoc(terms, weights, tokens) {
  const counts = countTokens(tokens);
  let raw = 0;
  for (const t of terms) {
    const tf = counts.get(t) ?? 0;
    if (tf > 0) raw += tf * (weights.get(t) ?? 0);
  }
  return raw;
}
var round2 = (n) => Math.round(n * 100) / 100;
function resolveLimit(limit) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_FIND_LIMIT;
  return Math.min(MAX_FIND_LIMIT, Math.max(1, Math.floor(limit)));
}
function makeSnippet(text, terms, weights, window) {
  const lower = text.toLowerCase();
  let bestPos = -1;
  let bestW = -Infinity;
  for (const t of terms) {
    const w = weights.get(t) ?? 0;
    if (w <= 0) continue;
    const pos = lower.indexOf(t);
    if (pos === -1) continue;
    if (w > bestW || w === bestW && pos < bestPos) {
      bestPos = pos;
      bestW = w;
    }
  }
  if (bestPos === -1) return "";
  const len = text.length;
  const l0 = Math.max(0, bestPos - window);
  const r0 = Math.min(len, bestPos + window);
  const left = text.lastIndexOf("\n", l0 - 1) + 1;
  let right = text.indexOf("\n", r0);
  if (right === -1) right = len;
  const lead = text.slice(0, left).trim() !== "";
  const trail = text.slice(right).trim() !== "";
  const collapsed = text.slice(left, right).replace(/\s+/g, " ").trim();
  return (lead ? "\u2026" : "") + collapsed + (trail ? "\u2026" : "");
}
var LexicalEngine = class {
  snippetWindow;
  minTokenLength;
  constructor(cfg = {}) {
    const w = cfg.snippetWindow ?? DEFAULT_SNIPPET_WINDOW;
    if (!Number.isInteger(w) || w <= 0) throw new FindError("bad_config", `snippetWindow must be a positive integer: ${w}`);
    const m = cfg.minTokenLength ?? MIN_TOKEN_LENGTH;
    if (!Number.isInteger(m) || m <= 0) throw new FindError("bad_config", `minTokenLength must be a positive integer: ${m}`);
    this.snippetWindow = w;
    this.minTokenLength = m;
  }
  search(scope, query, opts = {}) {
    const terms = uniqueTerms(tokenize(query, this.minTokenLength));
    if (terms.length === 0) {
      throw new FindError("empty_query", `no searchable terms in query: ${JSON.stringify(query)}`);
    }
    const corpus = loadCorpus(scope.root, scope.missionId);
    const chunkWeights = termWeights(terms, corpus.chunks);
    const scored = [];
    for (const doc of corpus.chunks) {
      const raw = scoreDoc(terms, chunkWeights, doc.tokens);
      if (raw > 0) scored.push({ doc, raw });
    }
    scored.sort(
      (a, b) => b.raw - a.raw || (a.doc.fetchedAt === b.doc.fetchedAt ? 0 : a.doc.fetchedAt < b.doc.fetchedAt ? 1 : -1) || (a.doc.artifactId === b.doc.artifactId ? 0 : a.doc.artifactId < b.doc.artifactId ? -1 : 1) || a.doc.chunk - b.doc.chunk
    );
    const limit = resolveLimit(opts.limit);
    const matches = scored.slice(0, limit).map(({ doc, raw }) => ({
      artifact_id: doc.artifactId,
      url: doc.url,
      chunk: doc.chunk,
      score: round2(raw),
      depth: doc.depth,
      snippet: makeSnippet(doc.text, terms, chunkWeights, this.snippetWindow)
    }));
    const linkWeights = termWeights(terms, corpus.links);
    const linkScored = [];
    for (const l of corpus.links) {
      const raw = scoreDoc(terms, linkWeights, l.tokens);
      if (raw > 0) linkScored.push({ url: l.url, text: l.text, raw });
    }
    linkScored.sort(
      (a, b) => b.raw - a.raw || (a.url === b.url ? 0 : a.url < b.url ? -1 : 1) || (a.text === b.text ? 0 : a.text < b.text ? -1 : 1)
    );
    const link_matches = linkScored.slice(0, MAX_LINK_MATCHES).map((l) => ({
      url: l.url,
      text: l.text,
      score: round2(l.raw)
    }));
    return {
      matches,
      best_match_url: matches.length > 0 ? matches[0].url : null,
      link_matches
    };
  }
};

// src/host/find-service.ts
var NO_MATCH_HINT = "no matches: stored pages may not cover this \u2014 consider mission_fetch";
function runFind(root, engine, args) {
  const missionId = resolveMissionId(root, args.mission_id);
  const query = String(args.query ?? "");
  const result = engine.search(
    { root, missionId },
    query,
    { limit: args.limit, urlOnly: args.urlOnly }
  );
  if (args.urlOnly === true) {
    return {
      best_match_url: result.best_match_url,
      link_matches: result.link_matches
    };
  }
  return {
    mission_id: missionId,
    query,
    matches: result.matches,
    best_match_url: result.best_match_url,
    link_matches: result.link_matches,
    ...result.matches.length === 0 ? { hint: NO_MATCH_HINT } : {}
  };
}

// src/host/tools.ts
function resolveCwd(args, exec) {
  const fromArg = args.cwd?.trim();
  if (fromArg) return fromArg;
  const fromAgent = exec.agent?.session?.header?.cwd?.trim();
  if (fromAgent) return fromAgent;
  throw new Error("cwd required (pass cwd or run from an agent session with a workspace cwd)");
}
function toolErrorResult(error) {
  if (error instanceof StoreError) {
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
  if (error instanceof FetchError) {
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
  if (error instanceof FindError) {
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
  if (error instanceof ConsentProfilesError) {
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}
function renderJson(_args, value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}
var CWD_PARAM = { type: "string", description: "Absolute project cwd (defaults to session cwd)." };
function registerMissionTools(ctx) {
  const tools = ctx.tools;
  const disposers = [];
  disposers.push(tools.register({
    name: "mission_start",
    description: "Start a new web research mission. Creates <cwd>/.dsh/web-missions/<id>/ (manifest.json + mission.md) and a recents row; the mission becomes the default active mission for the other mission_* tools. Optional seeds: root URLs the mission may wander from \u2014 they are depth 0 and their hosts are exempt from the maxDiscoveredHosts crawl cap.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        note: { type: "string", description: "Short mission note/title (required)." },
        template_id: { type: "string", description: "Optional research template id." },
        budget: { type: "integer", description: "Max fetch calls (default: config knob defaultFetchBudget, 10). Each non-cached fetch attempt costs 1 call." },
        seeds: {
          type: "array",
          items: { type: "string" },
          description: "Optional seed URLs (normalized + deduped by the host). Seeds are depth 0 and their hosts are exempt from the maxDiscoveredHosts crawl cap (the deliberate roots of the mission)."
        },
        cwd: CWD_PARAM
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          mission_id: { type: "string" },
          note: { type: "string" },
          status: { type: "string" },
          budget: { type: "object" },
          created_at: { type: "string" }
        }
      },
      render: renderJson
    },
    async execute(args, exec) {
      try {
        const root = missionRoot(resolveCwd(args, exec));
        const manifest = startMission(root, {
          note: args.note,
          template_id: args.template_id,
          budget: args.budget,
          seeds: args.seeds
        });
        return manifest;
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  }));
  disposers.push(tools.register({
    name: "mission_list",
    description: "List web missions for this project. Returns active missions first (newest first) and all recents (newest first, cap 50) with page and visited counts.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: CWD_PARAM
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          active: { type: "array" },
          recents: { type: "array" }
        }
      },
      render: renderJson
    },
    async execute(args, exec) {
      try {
        const root = missionRoot(resolveCwd(args, exec));
        return listMissions(root);
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  }));
  disposers.push(tools.register({
    name: "mission_status",
    description: "Return the full manifest of the default (most recently started active) mission, or the given mission_id, including visited: the ledger of fetched pages. This is the canonical visited list \u2014 do not track visited URLs from memory.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mission_id: { type: "string", description: "Mission id (default: most recently started active mission)." },
        cwd: CWD_PARAM
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          mission_id: { type: "string" },
          note: { type: "string" },
          status: { type: "string" },
          stop_reason: { type: "string" },
          budget: { type: "object" },
          created_at: { type: "string" },
          updated_at: { type: "string" },
          visited: { type: "array" }
        }
      },
      render: renderJson
    },
    async execute(args, exec) {
      try {
        const root = missionRoot(resolveCwd(args, exec));
        return missionStatus(root, args.mission_id);
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  }));
  disposers.push(tools.register({
    name: "mission_fetch",
    description: "Fetch a URL with the local browser39 and store it in the mission (page.json + text chunks + links, plus a visited-ledger row). A URL already stored (same normalized final URL, or one that previously redirected onto it) returns an IMMEDIATE cache-hit receipt: cached: true, same artifact_id, age_days, zero browser spawn. Pass force: true to re-fetch (overwrites in place, same artifact_id). Fresh receipts carry page_quality (full | thin | blocked), chunk_count, preview_head, sample_links (\u22645), and a deterministic next_step_hint; same-host misses add hint_find_first. Blocked pages (4xx/5xx, empty) are stored too, so dead URLs are known, not guessed. Every receipt carries budget { max, spent, remaining, unit: fetch_calls }: each non-cached fetch attempt costs 1 call (cache hits are free), and an exhausted mission fails with budget_exhausted (start a new mission). Egress is gated by <cwd>/.dsh/allowlist.txt (deny-all default): a URL not in the allowlist fails with allowlist_denied (no fetch, no budget charge). The depth fence caps the crawl: a fetch deeper than maxDepth hops from the nearest seed fails with depth_exceeded, and a fetch onto a new (maxDiscoveredHosts+1)th non-seed host fails with host_breadth_exceeded \u2014 no fetch, no budget charge (mission_start seeds are depth 0 and host-exempt; already-stored URLs are never re-gated). Receipts carry depth + parent_artifact_id.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch (required)." },
        mission_id: { type: "string", description: "Mission id (default: most recently started active mission)." },
        force: { type: "boolean", description: "Re-fetch even if already stored (overwrites in place, same artifact_id)." },
        cwd: CWD_PARAM
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          mission_id: { type: "string" },
          artifact_id: { type: "string" },
          url: { type: "string" },
          final_url: { type: "string" },
          cached: { type: "boolean" },
          fetched_at: { type: "string" },
          age_days: { type: "number" },
          page_quality: { type: "string" },
          quality_signals: { type: "array" },
          consent_attempted: { type: "boolean" },
          consent_improved: { type: "boolean" },
          chunk_count: { type: "integer" },
          preview_head: { type: "string" },
          depth: { type: "integer" },
          parent_artifact_id: { type: ["string", "null"] },
          budget: { type: "object" },
          visited_count: { type: "integer" },
          next_step_hint: { type: "string" },
          sample_links: { type: "array" },
          hint_find_first: { type: "string" }
        }
      },
      render: renderJson
    },
    async execute(args, exec) {
      try {
        const root = missionRoot(resolveCwd(args, exec));
        const config = readConfig(root);
        return await runFetch(root, new Browser39Fetcher({
          fetchTimeoutMs: config.fetchTimeoutMs,
          thinThresholdChars: config.thinThresholdChars,
          // M5 5.4 (C7): host-scoped persistent sessions (default on).
          persistSessions: config.persistSessions,
          // M5 5.6: stored-content cap (overflow → quality_signals: ["truncated"]).
          maxBytes: config.maxBytes
        }), {
          url: args.url,
          mission_id: args.mission_id,
          force: args.force,
          chunkChars: args.chunkChars ?? config.chunkChars
        });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  }));
  disposers.push(tools.register({
    name: "mission_stop",
    description: "Stop the default (most recently started active) mission, or the given mission_id. Records the stop in the manifest, appends a footer line to mission.md, and updates the recents row. Re-stopping is a no-op with already_stopped: true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mission_id: { type: "string", description: "Mission id (default: most recently started active mission)." },
        reason: { type: "string", description: "Why the mission is stopping (optional)." },
        cwd: CWD_PARAM
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          mission_id: { type: "string" },
          status: { type: "string" },
          stop_reason: { type: "string" },
          updated_at: { type: "string" },
          already_stopped: { type: "boolean" }
        }
      },
      render: renderJson
    },
    async execute(args, exec) {
      try {
        const root = missionRoot(resolveCwd(args, exec));
        const id = resolveMissionId(root, args.mission_id);
        const { manifest, already_stopped } = stopMission(root, id, args.reason);
        return {
          mission_id: manifest.mission_id,
          status: manifest.status,
          stop_reason: manifest.stop_reason,
          updated_at: manifest.updated_at,
          already_stopped
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  }));
  disposers.push(tools.register({
    name: "mission_find",
    description: `Lexically search a mission's STORED pages (chunks + link text) and return scored matches with snippets, best_match_url, and matching links. This is the point of the M3 cache: query what is already stored before fetching a new same-host path. find never fetches \u2014 it only reads disk. Pass url_only: true for the cheap "which page talks about X" shape.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Natural-language search text (required). Tokens < 3 chars are dropped." },
        mission_id: { type: "string", description: "Mission id (default: most recently started active mission)." },
        limit: { type: "integer", description: "Max chunk matches (default 5, max 20)." },
        url_only: { type: "boolean", description: "Return only { best_match_url, link_matches} (cheap mode)." },
        cwd: CWD_PARAM
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          mission_id: { type: "string" },
          query: { type: "string" },
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                artifact_id: { type: "string" },
                url: { type: "string" },
                chunk: { type: "integer" },
                score: { type: "number" },
                depth: { type: "integer" },
                snippet: { type: "string" }
              }
            }
          },
          best_match_url: { type: ["string", "null"] },
          link_matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                text: { type: "string" },
                score: { type: "number" }
              }
            }
          },
          hint: { type: "string" }
        }
      },
      render: renderJson
    },
    async execute(args, exec) {
      try {
        const root = missionRoot(resolveCwd(args, exec));
        return runFind(root, new LexicalEngine(), {
          query: args.query,
          mission_id: args.mission_id,
          limit: args.limit,
          urlOnly: args.url_only
        });
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  }));
  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

// src/host/index.ts
var name = PLUGIN;
var inject = ["tools"];
function errorMessage3(error) {
  return error instanceof Error ? error.message : String(error);
}
function send2(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function registerHealthRoute(ctx) {
  const unregister = ctx.webServer.register({
    kind: "exact",
    path: HEALTH_ROUTE,
    handler: (req, res) => {
      if (req.method !== "GET") {
        send2(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        send2(res, 200, {
          ok: true,
          name: PLUGIN,
          version: VERSION,
          time: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (error) {
        try {
          send2(res, 500, { ok: false, error: errorMessage3(error) });
        } catch {
        }
      }
    }
  });
  ctx.effect(() => unregister, "web-missions: /api/web-missions/health route");
}
function apply(ctx) {
  try {
    const disposeTools = registerMissionTools(ctx);
    ctx.effect(() => {
      disposeTools();
    }, "web-missions: tools");
  } catch (error) {
    ctx.logger?.(PLUGIN).warn("tool registration failed (continuing without it): %s", errorMessage3(error));
  }
  try {
    registerMissionSkill(ctx);
  } catch (error) {
    ctx.logger?.(PLUGIN).warn("skill registration failed (continuing without it): %s", errorMessage3(error));
  }
  ctx.inject(["webServer"], (webCtx) => {
    try {
      registerHealthRoute(webCtx);
      registerMissionsRoutes(webCtx);
    } catch (error) {
      webCtx.logger?.(PLUGIN).error("route registration failed: %s", errorMessage3(error));
    }
  });
}
export {
  HEALTH_ROUTE,
  PLUGIN,
  VERSION,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
