// src/shared/types.ts
var PLUGIN = "dsh-local-web-missions";
var VERSION = "1.0.0";
var HEALTH_ROUTE = "/api/web-missions/health";
var MISSIONS_ROUTE = "/api/web-missions/missions";
var MISSIONS_ID_PREFIX = "/api/web-missions/missions";
var MISSION_ID_PATTERN = /^m-[0-9a-f]{8}$/;

// src/host/routes.ts
import { URL as URL2 } from "node:url";

// src/host/store.ts
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
var DEFAULT_FETCH_BUDGET = 10;
var RECENTS_CAP = 50;
var StoreError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "StoreError";
  }
};
function missionRoot(cwd) {
  return join(cwd, ".dsh", "web-missions");
}
function missionDir(root, id) {
  return join(root, id);
}
function manifestPath(root, id) {
  return join(missionDir(root, id), "manifest.json");
}
function missionMdPath(root, id) {
  return join(missionDir(root, id), "mission.md");
}
function indexPath(root) {
  return join(root, "index.json");
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
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}
function atomicWriteText(path, text) {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}
function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
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
  const pagesDir = join(missionDir(root, id), "pages");
  try {
    return readdirSync(pagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
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
  const existing = readFileSync(path, "utf8");
  const footer = `\u2014 stopped: ${reason?.trim() || "no reason given"} \u2014`;
  const withFooter = (existing.endsWith("\n") ? existing : `${existing}
`) + footer + "\n";
  atomicWriteText(path, withFooter);
}
function startMission(root, opts) {
  const note = opts.note?.trim();
  if (!note) throw new StoreError("note_required", "mission note is required");
  const budget = opts.budget ?? DEFAULT_FETCH_BUDGET;
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new StoreError("bad_budget", `budget must be a positive number: ${String(opts.budget)}`);
  }
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
    fetched: []
  };
  const dir = missionDir(root, id);
  mkdirSync(join(dir, "pages"), { recursive: true });
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
      visited: manifest?.fetched.length ?? 0
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
  return { ...manifest, visited: manifest.fetched };
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
  const unregisterStatus = ctx.webServer.register({
    kind: "prefix",
    path: MISSIONS_ID_PREFIX,
    handler: (req, res) => {
      if (req.method !== "GET") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL2(req.url ?? MISSIONS_ID_PREFIX, `http://${host}`);
      if (url.pathname === MISSIONS_ID_PREFIX) {
        send(res, 404, { ok: false, error: "not found" });
        return;
      }
      const remainder = url.pathname.slice(MISSIONS_ID_PREFIX.length + 1);
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
    }
  });
  ctx.effect(() => unregisterStatus, "web-missions: /api/web-missions/missions/:id route");
}

// src/host/fetcher.ts
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync as readFileSync2,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join2 } from "node:path";
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
var FetchError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "FetchError";
  }
};
function resolveBrowser39Bin(explicit) {
  const envBin = explicit ?? process.env.BROWSER39_BIN;
  if (envBin && envBin.trim() !== "") return { cmd: envBin.trim(), args: [] };
  try {
    const require2 = createRequire(import.meta.url);
    const pkgJson = require2.resolve("@aquintanar/browser39/package.json");
    const binJs = join2(dirname(pkgJson), "bin.js");
    if (existsSync(binJs)) return { cmd: process.execPath, args: [binJs] };
  } catch {
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join2(dir, "browser39");
    try {
      if (statSync(candidate).mode & 73) return { cmd: candidate, args: [] };
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
var Browser39Fetcher = class {
  constructor(config = {}) {
    this.config = config;
  }
  get timeoutMs() {
    return this.config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }
  get thinThresholdChars() {
    return this.config.thinThresholdChars ?? DEFAULT_THIN_THRESHOLD_CHARS;
  }
  async fetch(url, opts) {
    const bin = resolveBrowser39Bin(this.config.browser39Bin);
    if (!bin) {
      throw new FetchError(
        "spawn_failed",
        "browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH)"
      );
    }
    const workdir = mkdtempSync(join2(tmpdir(), "web-missions-b39-"));
    const inPath = join2(workdir, "commands.jsonl");
    const outPath = join2(workdir, "results.jsonl");
    try {
      writeFileSync2(
        inPath,
        `${JSON.stringify({
          id: "f1",
          action: "fetch",
          v: 1,
          seq: 1,
          url,
          options: {
            include_links: true,
            strip_nav: true,
            // 2.0.0 defaults show_selectors_first=true (stub pages); we want the raw page.
            show_selectors_first: false
          }
        })}
`
      );
      try {
        unlinkSync(outPath);
      } catch {
      }
      const line = await this.spawnBatch(bin, inPath, outPath, opts?.signal);
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
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }
  spawnBatch(bin, inPath, outPath, signal) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(bin.cmd, [...bin.args, "batch", inPath, "--output", outPath], {
          cwd: dirname(inPath),
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
      const finish = (err, line) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(line);
      };
      const timer = setTimeout(() => {
        this.killChild(child);
        finish(
          new FetchError(
            "fetch_failed",
            `browser39 spawn timed out after ${this.timeoutMs} ms`
          )
        );
      }, this.timeoutMs);
      const onAbort = () => {
        this.killChild(child);
        finish(new FetchError("fetch_failed", "fetch aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stderr?.on("data", (d) => {
        stderrBuf = (stderrBuf + d.toString()).slice(-2e3);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        finish(
          new FetchError(
            "spawn_failed",
            e.code === "ENOENT" ? `browser39 not found (no BROWSER39_BIN, no node_modules binary, not on PATH): ${tail(e.message)}` : `browser39 spawn failed: ${tail(e.message)}`
          )
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        let lines = [];
        try {
          const raw = readFileSync2(outPath, "utf8");
          lines = raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
        } catch (e) {
          finish(
            new FetchError(
              "fetch_failed",
              `browser39 produced no parseable results (exit ${code}): ${tail(stderrBuf)}`
            )
          );
          return;
        }
        const line = lines.find((l) => l.id === "f1") ?? lines[0];
        if (!line) {
          finish(
            new FetchError(
              "fetch_failed",
              `browser39 produced no result line (exit ${code}): ${tail(stderrBuf)}`
            )
          );
          return;
        }
        finish(null, line);
      });
    });
  }
  killChild(child) {
    try {
      if (child.pid !== void 0) {
        process.kill(-child.pid, "SIGKILL");
        return;
      }
    } catch {
    }
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }
  toFetchedPage(requestedUrl, line) {
    const finalUrl = line.url ?? requestedUrl;
    const content = line.markdown ?? "";
    const status = typeof line.status === "number" ? line.status : 0;
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
    const byteLength = typeof line.stats?.content_bytes === "number" ? line.stats.content_bytes : Buffer.byteLength(content, "utf8");
    const { quality, qualitySignals } = assessQuality({
      status,
      title: line.title ?? "",
      content,
      thinThresholdChars: this.thinThresholdChars
    });
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
      qualitySignals,
      consentAttempted: false,
      consentImproved: false
    };
  }
};

// src/host/artifacts.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, readdirSync as readdirSync2, rmSync as rmSync2 } from "node:fs";
import { join as join3 } from "node:path";

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

// src/host/artifacts.ts
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
  const dir = join3(root, missionId, "pages", artifactId);
  if (opts.replace) {
    if (existsSync2(dir)) {
      for (const e of readdirSync2(dir, { withFileTypes: true })) {
        if (e.isDirectory()) rmSync2(join3(dir, e.name), { recursive: true, force: true });
        else rmSync2(join3(dir, e.name), { force: true });
      }
    }
    mkdirSync2(dir, { recursive: true });
  } else {
    mkdirSync2(dir, { recursive: true });
  }
  const storedAt = (/* @__PURE__ */ new Date()).toISOString();
  const pageRecord = {
    ...page,
    artifact_id: artifactId,
    mission_id: missionId,
    normalized_url: normalizeUrl(page.finalUrl),
    // D-M2.2: ledger key = normalized final URL
    stored_at: storedAt
  };
  atomicWriteJson(join3(dir, "page.json"), pageRecord);
  const links = dedupeLinks(page.links);
  if (links.length > 0) atomicWriteJson(join3(dir, "links.json"), links);
  let chunkCount = 0;
  if (page.quality !== "blocked" && page.content.trim().length > 0) {
    const chunks = splitContent(page.content, chunkChars);
    mkdirSync2(join3(dir, "chunks"), { recursive: true });
    for (const [i, chunk] of chunks.entries()) {
      atomicWriteText(join3(dir, "chunks", `${String(i).padStart(3, "0")}.md`), chunk);
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
  const dir = join3(root, missionId, "pages", artifactId);
  const pagePath = join3(dir, "page.json");
  if (!existsSync2(pagePath)) {
    throw new StoreError("corrupt", `page.json missing for artifact ${artifactId}`);
  }
  let page;
  try {
    page = JSON.parse(readFileSync3(pagePath, "utf8"));
  } catch (error) {
    throw new StoreError("corrupt", `cannot read ${pagePath}: ${error.message}`);
  }
  let links = [];
  const linksPath = join3(dir, "links.json");
  if (existsSync2(linksPath)) {
    try {
      const parsed = JSON.parse(readFileSync3(linksPath, "utf8"));
      if (Array.isArray(parsed)) links = parsed;
    } catch {
      links = [];
    }
  }
  let chunkCount = 0;
  const chunksDir = join3(dir, "chunks");
  if (existsSync2(chunksDir)) {
    chunkCount = readdirSync2(chunksDir, { withFileTypes: true }).filter((e) => e.isFile()).length;
  }
  return { page, links, chunkCount };
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
      return "page is thin (short or likely a consent wall) \u2014 try a sample link or re-fetch with force";
    case "blocked":
      return "fetch blocked (see quality_signals) \u2014 do not re-fetch this URL; pick another";
  }
}
function cachedNextStepHint(quality, age) {
  if (quality === "full") {
    return `cached: already stored (age ${age}d). Use mission_find, or pass force: true to re-fetch.`;
  }
  return `cached: stored as ${quality} (age ${age}d). Re-fetch with force: true if you expect new content.`;
}
async function runFetch(root, fetcher, args, opts = {}) {
  const now = opts.now ?? Date.now;
  const url = args.url?.trim();
  if (!url) throw new StoreError("bad_args", "url is required");
  const missionId = resolveMissionId(root, args.mission_id);
  const requestedKey = normalizeUrl(url);
  const manifest = readManifest(root, missionId);
  if (!manifest) throw new StoreError("unknown_mission", `no such mission: ${missionId}`);
  const hit = findLedgerRow(manifest, requestedKey);
  const force = args.force === true;
  if (hit && !force) {
    return buildHitReceipt(root, missionId, url, manifest, hit, now());
  }
  const page = await fetcher.fetch(url, { sessionKey: hostSessionKey(url) });
  const finalKey = normalizeUrl(page.finalUrl);
  const target = manifest.fetched.find((r) => r.normalized_url === finalKey) ?? (force && hit ? hit : void 0);
  const stored = storeArtifact(root, missionId, page, {
    chunkChars: args.chunkChars,
    ...target ? { artifactId: target.artifact_id, replace: true } : {}
  });
  const requestedKeys = [.../* @__PURE__ */ new Set([...target?.requested_keys ?? [], requestedKey])];
  const row = {
    normalized_url: finalKey,
    url: page.finalUrl,
    artifact_id: stored.artifactId,
    quality: page.quality,
    fetched_at: page.fetchedAt,
    consent_improved: page.consentImproved,
    requested_keys: requestedKeys
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
    depth: 0,
    parent_artifact_id: null,
    visited_count: updated.fetched.length,
    next_step_hint: nextStepHint(page.quality),
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
    depth: 0,
    parent_artifact_id: null,
    visited_count: manifest.fetched.length,
    next_step_hint: cachedNextStepHint(stored.page.quality, age),
    sample_links: stored.links.slice(0, 5).map((l) => l.url)
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
    description: "Start a new web research mission. Creates <cwd>/.dsh/web-missions/<id>/ (manifest.json + mission.md) and a recents row; the mission becomes the default active mission for the other mission_* tools.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        note: { type: "string", description: "Short mission note/title (required)." },
        template_id: { type: "string", description: "Optional research template id." },
        budget: { type: "integer", description: "Max fetch calls (default 10; live enforcement from M5)." },
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
          budget: args.budget
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
    description: "Fetch a URL with the local browser39 and store it in the mission (page.json + text chunks + links, plus a visited-ledger row). A URL already stored (same normalized final URL, or one that previously redirected onto it) returns an IMMEDIATE cache-hit receipt: cached: true, same artifact_id, age_days, zero browser spawn. Pass force: true to re-fetch (overwrites in place, same artifact_id). Fresh receipts carry page_quality (full | thin | blocked), chunk_count, preview_head, sample_links (\u22645), and a deterministic next_step_hint; same-host misses add hint_find_first. Blocked pages (4xx/5xx, empty) are stored too, so dead URLs are known, not guessed.",
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
        return await runFetch(root, new Browser39Fetcher(), {
          url: args.url,
          mission_id: args.mission_id,
          force: args.force
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
  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

// src/host/index.ts
var name = PLUGIN;
var inject = ["tools"];
function errorMessage2(error) {
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
          send2(res, 500, { ok: false, error: errorMessage2(error) });
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
    ctx.logger?.(PLUGIN).warn("tool registration failed (continuing without it): %s", errorMessage2(error));
  }
  ctx.inject(["webServer"], (webCtx) => {
    try {
      registerHealthRoute(webCtx);
      registerMissionsRoutes(webCtx);
    } catch (error) {
      webCtx.logger?.(PLUGIN).error("route registration failed: %s", errorMessage2(error));
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
