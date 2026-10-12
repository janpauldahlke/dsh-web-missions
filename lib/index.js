// src/shared/types.ts
var PLUGIN = "dsh-local-web-missions";
var VERSION = "1.0.0";
var HEALTH_ROUTE = "/api/web-missions/health";
var MISSIONS_ROUTE = "/api/web-missions/missions";
var MISSIONS_ID_PREFIX = "/api/web-missions/missions/";
var MISSION_ID_PATTERN = /^m-[0-9a-f]{8}$/;

// src/host/routes.ts
import { URL } from "node:url";

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
      const url = new URL(req.url ?? MISSIONS_ID_PREFIX, `http://${host}`);
      if (!url.pathname.startsWith(MISSIONS_ID_PREFIX)) {
        send(res, 404, { ok: false, error: "not found" });
        return;
      }
      const remainder = url.pathname.slice(MISSIONS_ID_PREFIX.length);
      if (!MISSION_ID_PATTERN.test(remainder) || remainder.includes("/")) {
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
