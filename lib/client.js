window.__ModuleLoader__.load({ id: "dsh-local-web-missions", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/shared/types.ts
var HEALTH_ROUTE = "/api/web-missions/health";
var MISSIONS_ROUTE = "/api/web-missions/missions";
var MISSIONS_ID_PREFIX = "/api/web-missions/missions";
var TAB_ID = "web-missions";
var TAB_KIND = "web-missions";
var TAB_TITLE = "Missions";
var RECENTS_CLEAR_ROUTE = "/api/web-missions/recents/clear";
var CLEAR_ALL_ROUTE = "/api/web-missions/clear-all";
function missionApiPath(missionId, suffix = "") {
  const base = `${MISSIONS_ID_PREFIX}/${missionId}`;
  return suffix ? `${base}/${suffix}` : base;
}

// src/client/MissionsBody.tsx
var import_react2 = require("react");

// src/client/CollapsibleCard.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function readOverride(key) {
  try {
    const v = localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
    return null;
  } catch {
    return null;
  }
}
var toneColor = (t) => {
  if (t === "ok") return "color-mix(in srgb, #22c55e 70%, currentColor)";
  if (t === "warn") return "color-mix(in srgb, #fbbf24 75%, currentColor)";
  if (t === "crit") return "color-mix(in srgb, #f87171 80%, currentColor)";
  return void 0;
};
function CollapsibleCard({
  storageKey,
  label,
  tone = "na",
  defaultExpanded = false,
  headerTitle,
  accent,
  meta,
  preview = [],
  bodyMaxHeight = 200,
  children
}) {
  const [override, setOverride] = (0, import_react.useState)(() => readOverride(storageKey));
  const expanded = override ?? defaultExpanded;
  const setExpanded = (next) => {
    setOverride(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
    }
  };
  const [hover, setHover] = (0, import_react.useState)(false);
  const border = tone === "crit" ? "1px solid color-mix(in srgb, #f87171 55%, transparent)" : tone === "warn" ? "1px solid color-mix(in srgb, #fbbf24 45%, transparent)" : tone === "ok" ? "1px solid color-mix(in srgb, #22c55e 40%, transparent)" : "1px solid color-mix(in srgb, currentColor 18%, transparent)";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...shell, border, marginBottom: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-expanded": expanded,
        title: headerTitle,
        onClick: () => setExpanded(!expanded),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          ...header,
          background: hover ? "color-mix(in srgb, currentColor 6%, transparent)" : "transparent"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              "aria-hidden": true,
              style: {
                ...chevron,
                transform: expanded ? "rotate(90deg)" : "none"
              },
              children: "\u25B8"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: labelChip, children: label }),
          accent !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              title: accent.title,
              style: {
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: accent.color ?? toneColor(tone) ?? "inherit"
              },
              children: accent.text
            }
          ),
          meta !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              title: meta.title,
              style: {
                fontSize: 11,
                whiteSpace: "nowrap",
                color: "color-mix(in srgb, currentColor 55%, transparent)"
              },
              children: meta.text
            }
          ),
          preview.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: previewCluster, children: preview.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              title: s.title,
              style: {
                whiteSpace: "nowrap",
                ...toneColor(s.tone ?? "na") ? { color: toneColor(s.tone ?? "na") } : {}
              },
              children: s.text
            },
            i
          )) })
        ]
      }
    ),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        style: {
          ...body,
          maxHeight: bodyMaxHeight,
          overflowY: "auto",
          overflowX: "hidden"
        },
        children
      }
    )
  ] });
}
var shell = {
  borderRadius: 8,
  overflow: "hidden"
};
var header = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  padding: "8px 10px",
  cursor: "pointer",
  userSelect: "none",
  transition: "background 120ms"
};
var chevron = {
  display: "inline-block",
  fontSize: 10,
  lineHeight: 1,
  transition: "transform 150ms",
  color: "color-mix(in srgb, currentColor 50%, transparent)"
};
var labelChip = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  padding: "1px 6px",
  borderRadius: 4,
  background: "color-mix(in srgb, currentColor 12%, transparent)",
  whiteSpace: "nowrap"
};
var previewCluster = {
  marginLeft: "auto",
  display: "inline-flex",
  alignItems: "baseline",
  gap: 8,
  flexWrap: "wrap",
  fontVariantNumeric: "tabular-nums",
  fontSize: 11,
  color: "color-mix(in srgb, currentColor 75%, transparent)"
};
var body = {
  padding: "8px 10px 10px",
  borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)"
};

// src/client/paneModel.ts
function formatBytes(bytes) {
  if (bytes === void 0 || bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
function qualityLevel(quality) {
  if (quality === "full" || quality === "thin" || quality === "blocked") return quality;
  return "unknown";
}
function qualityBadge(quality) {
  switch (qualityLevel(quality)) {
    case "full":
      return { level: "full", label: "full", color: "#3f6212", background: "#ecfccb" };
    case "thin":
      return { level: "thin", label: "thin", color: "#92400e", background: "#fef3c7" };
    case "blocked":
      return { level: "blocked", label: "blocked", color: "#991b1b", background: "#fee2e2" };
    default:
      return { level: "unknown", label: quality ?? "unknown", color: "#525252", background: "#e5e5e5" };
  }
}
function ageInDays(iso, now = /* @__PURE__ */ new Date()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const days = (now.getTime() - t) / 864e5;
  return Math.max(0, Math.floor(days));
}
function formatAge(iso, now = /* @__PURE__ */ new Date()) {
  const d = ageInDays(iso, now);
  if (d === 0) return "today";
  if (d === 1) return "1d";
  return `${d}d`;
}
function formatTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "\u2014";
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function shortArtifact(artifactId) {
  if (artifactId.length <= 8) return artifactId;
  return artifactId.slice(0, 8) + "\u2026";
}
function sessionHint(rows) {
  for (const row of rows) {
    if (qualityLevel(row.quality) !== "thin") continue;
    if (row.consent_attempted !== true) continue;
    if (row.consent_improved === true) continue;
    const host = hostOf(row.url);
    if (!host) continue;
    return `session thin on ${host} \u2014 export cookies or preload into ~/.dsh/browser39/sessions/${host}/`;
  }
  return null;
}
function budgetLine(budget) {
  return `${budget.remaining}/${budget.max} ${budget.unit}`;
}
function budgetExhausted(budget) {
  return budget.remaining <= 0;
}

// src/client/pollModel.ts
var POLL_INTERVAL_MS = 15e3;
function createPoller(deps) {
  const tick = () => {
    if (deps.isHidden()) return;
    deps.sync();
  };
  const onVisible = () => {
    if (!deps.isHidden()) deps.sync();
  };
  const id = deps.setInterval(tick, deps.intervalMs);
  deps.onVisibilityChange(onVisible);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      deps.clearInterval(id);
      deps.offVisibilityChange(onVisible);
    }
  };
}

// src/client/MissionsBody.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function useNoopSessions(selector) {
  return selector({ byId: {} });
}
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function withCwd(path, cwd) {
  if (!cwd) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}cwd=${encodeURIComponent(cwd)}`;
}
function shortStore(cwd) {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return cwd.startsWith("/") ? cwd : parts.join("/");
  return `\u2026/${parts.slice(-2).join("/")}`;
}
function MissionsBody(props = {}) {
  const { sessionId, useSessions = useNoopSessions } = props;
  const sessionCwd = useSessions((sessions) => {
    if (!sessionId) return null;
    const cwd = sessions.byId[sessionId]?.cwd;
    return typeof cwd === "string" && cwd.trim() ? cwd.trim() : null;
  });
  const [list, setList] = (0, import_react2.useState)(null);
  const [listError, setListError] = (0, import_react2.useState)(null);
  const [detail, setDetail] = (0, import_react2.useState)(null);
  const [detailError, setDetailError] = (0, import_react2.useState)(null);
  const [view, setView] = (0, import_react2.useState)({ kind: "board" });
  const [stopping, setStopping] = (0, import_react2.useState)(false);
  const [lastSync, setLastSync] = (0, import_react2.useState)(null);
  const [discovery, setDiscovery] = (0, import_react2.useState)(null);
  const sync = (0, import_react2.useCallback)(async () => {
    try {
      const data = await fetchJson(withCwd(MISSIONS_ROUTE, sessionCwd));
      setList(data);
      setListError(null);
      setLastSync((/* @__PURE__ */ new Date()).toISOString());
      if (data.discovery === "on" || data.discovery === "off") setDiscovery(data.discovery);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, [sessionCwd]);
  (0, import_react2.useEffect)(() => {
    void (async () => {
      try {
        const h = await fetchJson(HEALTH_ROUTE);
        if (h.discovery === "on" || h.discovery === "off") setDiscovery(h.discovery);
      } catch {
      }
    })();
  }, []);
  (0, import_react2.useEffect)(() => {
    void sync();
  }, [sync]);
  (0, import_react2.useEffect)(() => {
    const poller = createPoller({
      sync: () => {
        void sync();
      },
      intervalMs: POLL_INTERVAL_MS,
      isHidden: () => typeof document !== "undefined" ? document.hidden : false,
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      onVisibilityChange: (fn) => document.addEventListener("visibilitychange", fn),
      offVisibilityChange: (fn) => document.removeEventListener("visibilitychange", fn)
    });
    return () => poller.dispose();
  }, [sync]);
  const detailToken = (0, import_react2.useRef)(0);
  const openDetail = (0, import_react2.useCallback)(
    async (missionId) => {
      const token = ++detailToken.current;
      setView({ kind: "detail", missionId });
      setDetail(null);
      setDetailError(null);
      try {
        const data = await fetchJson(withCwd(missionApiPath(missionId), sessionCwd));
        if (token === detailToken.current) setDetail(data);
      } catch (error) {
        if (token === detailToken.current) {
          setDetailError(error instanceof Error ? error.message : String(error));
        }
      }
    },
    [sessionCwd]
  );
  const markDone = (0, import_react2.useCallback)(async (missionId, reason) => {
    if (stopping) return;
    setStopping(true);
    try {
      const data = await fetchJson(withCwd(missionApiPath(missionId, "stop"), sessionCwd), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: reason ?? "marked done from pane",
          from_pane: true
        })
      });
      if (data.ok && view.kind === "detail" && view.missionId === missionId) {
        const token = ++detailToken.current;
        const refreshed = await fetchJson(withCwd(missionApiPath(missionId), sessionCwd));
        if (token === detailToken.current) setDetail(refreshed);
      }
    } catch {
    } finally {
      setStopping(false);
      await sync();
    }
  }, [view, stopping, sync, sessionCwd]);
  const [clearNote, setClearNote] = (0, import_react2.useState)(null);
  const [clearArmed, setClearArmed] = (0, import_react2.useState)(false);
  const clearArmedTimer = (0, import_react2.useRef)(null);
  const disarmClear = (0, import_react2.useCallback)(() => {
    setClearArmed(false);
    if (clearArmedTimer.current !== null) {
      window.clearTimeout(clearArmedTimer.current);
      clearArmedTimer.current = null;
    }
  }, []);
  (0, import_react2.useEffect)(() => () => disarmClear(), [disarmClear]);
  const clearRecentsAction = (0, import_react2.useCallback)(async () => {
    if (typeof window !== "undefined" && !window.confirm("Clear the recent-missions list? (mission data on disk is kept)")) return;
    try {
      const data = await fetchJson(RECENTS_CLEAR_ROUTE, { method: "POST" });
      if (data.ok) {
        setClearNote(`recents cleared \u2014 ${data.cleared} row(s) removed, mission data kept`);
      } else {
        setClearNote("clear recents: no response from host");
      }
      await sync();
    } catch (error) {
      setClearNote("clear recents failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [sync]);
  const clearAllAction = (0, import_react2.useCallback)(async () => {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearArmedTimer.current !== null) window.clearTimeout(clearArmedTimer.current);
      clearArmedTimer.current = window.setTimeout(() => setClearArmed(false), 6e3);
      return;
    }
    disarmClear();
    try {
      const data = await fetchJson(CLEAR_ALL_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      if (data.ok) {
        setClearNote(`cleared all \u2014 ${data.missions} mission(s), ${data.index_rows} index row(s), ${data.session_hosts} session host(s)`);
        setView({ kind: "board" });
      } else {
        setClearNote("clear all: no response from host");
      }
      await sync();
    } catch (error) {
      setClearNote("clear all failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [clearArmed, disarmClear, sync]);
  const hint = view.kind === "detail" && detail ? sessionHint(detail.visited) : null;
  const syncLabel = lastSync ? new Date(lastSync).toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.paneChrome, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: styles.heading, children: "Missions" }),
      listError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: styles.statusError, children: [
        "unreachable \xB7 ",
        listError
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.chromeMeta, title: list?.root ?? list?.cwd ?? void 0, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles.chromeQuiet, children: [
          syncLabel ? `updated ${syncLabel}` : null,
          discovery ? `discovery ${discovery}` : null
        ].filter(Boolean).join(" \xB7 ") || "syncing\u2026" }),
        list?.cwd ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: styles.chromeStore, title: list.cwd, children: [
          shortStore(list.cwd),
          typeof list.store_bytes === "number" ? ` \xB7 ${formatBytes(list.store_bytes)}` : ""
        ] }) : null
      ] })
    ] }),
    view.kind === "board" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Board,
        {
          list,
          stopping,
          onOpen: (id) => void openDetail(id),
          onMarkDone: (id) => void markDone(id)
        }
      ),
      list !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Hygiene,
        {
          clearNote,
          clearArmed,
          onClearRecents: () => void clearRecentsAction(),
          onClearAll: () => void clearAllAction()
        }
      )
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Detail,
      {
        missionId: view.missionId,
        detail,
        error: detailError,
        hint,
        stopping,
        onBack: () => setView({ kind: "board" }),
        onMarkDone: () => void markDone(view.missionId)
      }
    )
  ] });
}
function Board({
  list,
  onOpen,
  onMarkDone,
  stopping = false
}) {
  if (list === null) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.empty, children: "loading\u2026" });
  if (list.active.length === 0 && list.recents.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.empty, children: "no missions yet \u2014 start one from chat (mission_start)" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
    list.active.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      CollapsibleCard,
      {
        storageKey: "wm-board-active",
        label: "active",
        defaultExpanded: list.active.length <= 3,
        headerTitle: "Active missions",
        preview: [{ text: `${list.active.length}`, title: "active count" }],
        bodyMaxHeight: 220,
        children: list.active.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(Row, { onClick: () => onOpen(row.mission_id), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.rowTop, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RowNote, { note: row.note, active: true }),
            onMarkDone && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                style: styles.markDoneChip,
                disabled: stopping,
                title: "Mark this mission done (stop)",
                onClick: (e) => {
                  e.stopPropagation();
                  onMarkDone(row.mission_id);
                },
                children: stopping ? "\u2026" : "done"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(RowMeta, { children: [
            "in progress \xB7 started ",
            formatTime(row.started_at),
            " \xB7 ",
            row.visited,
            " visited",
            typeof row.bytes === "number" ? ` \xB7 ${formatBytes(row.bytes)}` : "",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(BudgetChip, { mission: row }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(FenceChip, { mission: row })
          ] })
        ] }, row.mission_id))
      }
    ),
    list.recents.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      CollapsibleCard,
      {
        storageKey: "wm-board-recents",
        label: "recent",
        headerTitle: "Stopped / done missions",
        preview: [{ text: `${list.recents.length}`, title: "recent count" }],
        bodyMaxHeight: 220,
        children: list.recents.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(Row, { onClick: () => onOpen(row.mission_id), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.rowTop, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RowNote, { note: row.note, active: row.status === "active" }),
            row.status === "active" && onMarkDone && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                style: styles.markDoneChip,
                disabled: stopping,
                title: "Mark this mission done (stop)",
                onClick: (e) => {
                  e.stopPropagation();
                  onMarkDone(row.mission_id);
                },
                children: stopping ? "\u2026" : "done"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(RowMeta, { children: [
            row.status,
            " \xB7 updated ",
            formatTime(row.updated_at),
            " \xB7 ",
            row.pages,
            " pages",
            typeof row.bytes === "number" ? ` \xB7 ${formatBytes(row.bytes)}` : ""
          ] })
        ] }, row.mission_id))
      }
    )
  ] });
}
function RowNote({ note, active }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: active ? styles.rowNoteActive : styles.rowNote, children: note });
}
function RowMeta({ children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles.rowMeta, children });
}
function BudgetChip({ mission }) {
  if (!mission.budget) return null;
  const exhausted = budgetExhausted(mission.budget);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: exhausted ? styles.budgetExhausted : styles.budgetOk, children: [
    " ",
    "\xB7 ",
    budgetLine(mission.budget)
  ] });
}
function FenceChip({ mission }) {
  if (!mission.fence) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: styles.fenceChip, children: [
    " ",
    "\xB7 depth\u2264",
    mission.fence.maxDepth,
    " \xB7 hosts\u2264",
    mission.fence.maxDiscoveredHosts
  ] });
}
function Row({ children, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles.row, onClick, role: "button", tabIndex: 0, children });
}
function Hygiene({
  clearNote,
  clearArmed,
  onClearRecents,
  onClearAll
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.hygiene, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: styles.hygieneButton, onClick: onClearRecents, children: "clear recents" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        style: clearArmed ? styles.hygieneButtonArmed : styles.hygieneButtonDanger,
        onClick: onClearAll,
        children: clearArmed ? "click again to clear ALL (~/.dsh sessions too)" : "clear all"
      }
    ),
    clearNote && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.hygieneNote, children: clearNote })
  ] });
}
function Detail({
  missionId,
  detail,
  error,
  hint,
  stopping,
  onBack,
  onMarkDone
}) {
  const briefing = detail?.briefing?.trim() ?? "";
  const hasBriefing = briefing.length > 0;
  const conclusion = detail?.conclusion?.trim() ?? "";
  const cooled = detail?.host_cooldowns ? Object.entries(detail.host_cooldowns).filter(([, e]) => e.cooldown).map(([h]) => h) : [];
  const exhausted = detail ? detail.budget_exhausted || budgetExhausted(detail.budget) : false;
  const sk = (suffix) => `wm-detail-${missionId}-${suffix}`;
  const fullCount = detail?.visited.filter((v) => v.quality === "full").length ?? 0;
  const thinCount = detail?.visited.filter((v) => v.quality === "thin").length ?? 0;
  const blockedCount = detail?.visited.filter((v) => v.quality === "blocked").length ?? 0;
  const conclusionTone = conclusion ? "ok" : detail?.status === "stopped" ? "warn" : "na";
  const hintCount = (hint ? 1 : 0) + cooled.length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.detailRoot, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: styles.backButton, onClick: onBack, children: "\u2190 board" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.detailHeader, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles.detailNote, children: detail?.note ?? "\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: styles.detailHeaderActions, children: [
        detail && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "span",
          {
            style: detail.status === "active" ? styles.statusActive : styles.statusStopped,
            title: detail.status === "active" ? "Mission running" : "Mission stopped",
            children: detail.status
          }
        ),
        detail?.status === "active" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: styles.stopButtonHeader, onClick: onMarkDone, disabled: stopping, children: stopping ? "\u2026" : "mark done" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.detailId, title: missionId, children: missionId }),
    detail?.stop_reason ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.outcomeLine, title: detail.stop_reason, children: detail.stop_reason }) : null,
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: styles.detailError, children: [
      "load failed: ",
      error
    ] }),
    detail === null && !error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.empty, children: "loading\u2026" }),
    detail && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      detail.goal ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        CollapsibleCard,
        {
          storageKey: sk("goal"),
          label: "goal",
          headerTitle: "Pinned research goal",
          preview: [{
            text: detail.goal.length > 48 ? `${detail.goal.slice(0, 48)}\u2026` : detail.goal,
            title: detail.goal
          }],
          bodyMaxHeight: 120,
          children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.goalScroll, children: detail.goal })
        }
      ) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        CollapsibleCard,
        {
          storageKey: sk("conclusion"),
          label: "conclusion",
          tone: conclusionTone,
          headerTitle: conclusion ? "Green = delivered answer" : detail.status === "stopped" ? "Amber = stopped with no conclusion" : "No conclusion yet",
          accent: conclusion ? { text: "delivered", color: "color-mix(in srgb, #22c55e 70%, currentColor)" } : detail.status === "stopped" ? { text: "missing", color: "color-mix(in srgb, #fbbf24 75%, currentColor)" } : void 0,
          preview: [{
            text: conclusion ? conclusion.length > 40 ? `${conclusion.replace(/\s+/g, " ").slice(0, 40)}\u2026` : conclusion.replace(/\s+/g, " ") : "\u2014",
            title: conclusion || "no conclusion yet"
          }],
          bodyMaxHeight: 220,
          children: conclusion ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { style: styles.conclusion, children: conclusion }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.empty, children: detail.status === "active" ? "no conclusion yet \u2014 mission_stop({ conclusion }) or ## Conclusion in mission.md" : "no conclusion recorded" })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        CollapsibleCard,
        {
          storageKey: sk("briefing"),
          label: "briefing",
          headerTitle: "Full mission.md",
          meta: { text: "mission.md", title: detail.mission_md_path },
          preview: [{
            text: hasBriefing ? `${Math.min(briefing.length, 9999)} chars` : "empty",
            title: hasBriefing ? "mission.md body length" : "no briefing yet"
          }],
          bodyMaxHeight: 200,
          children: hasBriefing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { style: styles.briefing, children: briefing }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.empty, children: "no briefing yet \u2014 mission.md is empty" })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        CollapsibleCard,
        {
          storageKey: sk("pages"),
          label: "pages",
          headerTitle: "Chip colors = fetch quality (full / thin / blocked)",
          preview: [
            { text: `${detail.visited.length}`, title: "visited count" },
            ...fullCount ? [{ text: `${fullCount} full`, title: "quality: full", tone: "ok" }] : [],
            ...thinCount ? [{ text: `${thinCount} thin`, title: "quality: thin", tone: "warn" }] : [],
            ...blockedCount ? [{ text: `${blockedCount} blocked`, title: "quality: blocked", tone: "crit" }] : []
          ],
          bodyMaxHeight: 240,
          children: detail.visited.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: styles.empty, children: "no pages yet" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles.visitedListInner, children: detail.visited.map((row) => {
            const badge = qualityBadge(row.quality);
            return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.visitedRow, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...styles.qualityBadge, color: badge.color, background: badge.background }, children: badge.label }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles.visitedUrl, title: row.url, children: row.url }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.visitedMeta, children: [
                formatAge(row.fetched_at),
                " \xB7",
                " ",
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles.artifactId, title: row.artifact_id, children: shortArtifact(row.artifact_id) }),
                row.consent_improved === true && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: styles.consentMark, children: " \u2713 consent" })
              ] })
            ] }, row.artifact_id);
          }) })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        CollapsibleCard,
        {
          storageKey: sk("budget"),
          label: "budget",
          tone: exhausted ? "crit" : "na",
          headerTitle: exhausted ? "Red = fetch budget exhausted" : "Fetch budget + depth/host fence",
          accent: exhausted ? { text: "exhausted", color: "color-mix(in srgb, #f87171 80%, currentColor)" } : void 0,
          preview: [
            {
              text: budgetLine(detail.budget),
              title: "remaining / max fetch_calls",
              tone: exhausted ? "crit" : "na"
            },
            ...detail.fence ? [{
              text: `d\u2264${detail.fence.maxDepth} h\u2264${detail.fence.maxDiscoveredHosts}`,
              title: "depth fence \xB7 max discovered hosts"
            }] : []
          ],
          bodyMaxHeight: 100,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: exhausted ? styles.budgetBodyExhausted : styles.budgetCardBody, children: [
              budgetLine(detail.budget),
              detail.fence ? ` \xB7 fence depth\u2264${detail.fence.maxDepth} hosts\u2264${detail.fence.maxDiscoveredHosts}` : ""
            ] }),
            exhausted && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { ...styles.hint, marginTop: 6, marginBottom: 0 }, children: detail.wrap_up_hint ?? "budget exhausted \u2014 write a conclusion and stop; do not invent more fetches" })
          ]
        }
      ),
      (cooled.length > 0 || hint) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        CollapsibleCard,
        {
          storageKey: sk("hints"),
          label: "hints",
          tone: "warn",
          headerTitle: "Amber = needs attention (session walls / host cooldown)",
          accent: { text: "attention", color: "color-mix(in srgb, #fbbf24 75%, currentColor)" },
          preview: [{
            text: hintCount === 1 ? "1 note" : `${hintCount} notes`,
            title: [hint, ...cooled.map((h) => `cooldown:${h}`)].filter(Boolean).join("\n")
          }],
          bodyMaxHeight: 160,
          children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.hintsStack, children: [
            cooled.map((host) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: styles.hintBlock, children: [
              "host cooldown: ",
              host
            ] }, host)),
            hint ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: styles.hintBlock, children: hint }) : null
          ] })
        }
      )
    ] })
  ] });
}
var styles = {
  /* R5.U1 — pane scrolls inside the sidebar instead of growing forever */
  root: {
    padding: 12,
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1.5,
    height: "100%",
    minHeight: 0,
    boxSizing: "border-box",
    overflowY: "auto",
    overflowX: "hidden"
  },
  detailRoot: {
    minHeight: 0
  },
  paneChrome: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "1px solid color-mix(in srgb, currentColor 10%, transparent)"
  },
  heading: { margin: "0 0 4px", fontSize: 15, fontWeight: 600 },
  chromeMeta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px 8px",
    fontSize: 11,
    lineHeight: 1.35
  },
  chromeQuiet: {
    opacity: 0.48,
    fontVariantNumeric: "tabular-nums",
    fontSize: 11
  },
  chromeStore: {
    opacity: 0.4,
    fontFamily: "ui-monospace, monospace",
    fontSize: 10.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%"
  },
  status: { margin: "0 0 4px", opacity: 0.75, fontSize: 12 },
  statusError: { margin: "0 0 4px", color: "#f87171", fontSize: 12 },
  cwdLine: {
    margin: "0 0 10px",
    fontSize: 11,
    opacity: 0.55,
    fontFamily: "ui-monospace, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  fenceChip: { opacity: 0.85 },
  empty: { margin: 0, opacity: 0.55, fontStyle: "italic" },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.55, margin: "0 0 4px" },
  /* R5.U1 — shared scroll shells for any unit that can grow */
  boardScroll: {
    maxHeight: 220,
    overflowY: "auto",
    overflowX: "hidden"
  },
  cardScroll: {
    maxHeight: 180,
    overflowY: "auto",
    overflowX: "hidden"
  },
  hintsScroll: {
    maxHeight: 120,
    overflowY: "auto",
    overflowX: "hidden",
    marginBottom: 8
  },
  row: {
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
    border: "1px solid rgba(128,128,128,0.15)",
    marginBottom: 4
  },
  rowTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8
  },
  rowNoteActive: { fontWeight: 600, flex: 1, minWidth: 0 },
  rowNote: { fontWeight: 400, flex: 1, minWidth: 0 },
  rowMeta: { display: "block", fontSize: 11.5, opacity: 0.7 },
  markDoneChip: {
    flexShrink: 0,
    padding: "1px 8px",
    borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.35)",
    background: "color-mix(in srgb, currentColor 6%, transparent)",
    color: "inherit",
    cursor: "pointer",
    fontSize: 11,
    lineHeight: 1.4,
    opacity: 0.85
  },
  conclusion: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid color-mix(in srgb, #22c55e 28%, transparent)",
    background: "color-mix(in srgb, #22c55e 7%, transparent)",
    fontSize: 12.5,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontWeight: 400,
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
  },
  briefing: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.18)",
    background: "color-mix(in srgb, currentColor 4%, transparent)",
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  },
  budgetOk: { color: "#3f6212" },
  budgetExhausted: { color: "#b91c1c", fontWeight: 600 },
  budgetLine: { margin: "0 0 8px" },
  budgetCard: {
    margin: "0 0 10px",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.22)",
    background: "color-mix(in srgb, currentColor 5%, transparent)"
  },
  budgetCardExhausted: {
    margin: "0 0 10px",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(185,28,28,0.4)",
    background: "#fee2e2"
  },
  budgetCardTitle: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    opacity: 0.55,
    marginBottom: 2
  },
  budgetCardBody: {
    fontSize: 12.5,
    fontWeight: 500,
    maxHeight: 72,
    overflowY: "auto"
  },
  budgetBodyExhausted: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#b91c1c",
    maxHeight: 72,
    overflowY: "auto"
  },
  goalCard: {
    margin: "0 0 8px",
    padding: "6px 8px",
    borderRadius: 6,
    background: "color-mix(in srgb, currentColor 5%, transparent)",
    border: "1px solid rgba(128,128,128,0.15)"
  },
  goalScroll: {
    fontSize: 12,
    opacity: 0.9,
    maxHeight: 72,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  backButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    marginBottom: 6,
    fontSize: 13,
    color: "inherit",
    opacity: 0.7
  },
  detailHeader: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap"
  },
  detailHeaderActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0
  },
  detailNote: { fontWeight: 600, flex: 1, minWidth: 0 },
  /* Lifecycle only — not quality green (that is reserved for conclusion/pages). */
  statusActive: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: "1px 7px",
    borderRadius: 6,
    color: "color-mix(in srgb, currentColor 78%, transparent)",
    background: "color-mix(in srgb, currentColor 10%, transparent)",
    lineHeight: 1.4
  },
  statusStopped: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: "1px 7px",
    borderRadius: 6,
    color: "color-mix(in srgb, currentColor 55%, transparent)",
    background: "color-mix(in srgb, currentColor 8%, transparent)",
    lineHeight: 1.4
  },
  detailMeta: { margin: "2px 0 8px", fontSize: 11.5, opacity: 0.65, fontFamily: "ui-monospace, monospace" },
  detailId: {
    margin: "2px 0 2px",
    fontSize: 10.5,
    opacity: 0.42,
    fontFamily: "ui-monospace, monospace"
  },
  outcomeLine: {
    margin: "0 0 12px",
    fontSize: 12,
    lineHeight: 1.45,
    opacity: 0.68,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden"
  },
  detailError: { color: "#f87171", fontSize: 12 },
  hint: {
    margin: "0 0 6px",
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 12,
    color: "#92400e",
    background: "#fef3c7"
  },
  stopButtonHeader: {
    padding: "2px 8px",
    borderRadius: 6,
    border: "1px solid rgba(185,28,28,0.4)",
    background: "#fee2e2",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: 11,
    lineHeight: 1.4,
    flexShrink: 0
  },
  stopButton: {
    marginTop: 4,
    marginBottom: 10,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid rgba(185,28,28,0.4)",
    background: "#fee2e2",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: 12.5
  },
  hygiene: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid rgba(128,128,128,0.15)",
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center"
  },
  hygieneButton: {
    padding: "3px 10px",
    borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.3)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 12
  },
  hygieneButtonDanger: {
    padding: "3px 10px",
    borderRadius: 6,
    border: "1px solid rgba(185,28,28,0.35)",
    background: "transparent",
    color: "#991b1b",
    cursor: "pointer",
    fontSize: 12
  },
  hygieneButtonArmed: {
    padding: "3px 10px",
    borderRadius: 6,
    border: "1px solid #b91c1c",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12
  },
  hygieneNote: { margin: 0, width: "100%", fontSize: 11.5, opacity: 0.8 },
  visitedListInner: { margin: 0 },
  visitedRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "baseline",
    padding: "6px 0",
    borderBottom: "1px solid rgba(128,128,128,0.12)"
  },
  qualityBadge: { fontSize: 10.5, padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap" },
  visitedUrl: { flex: "1 1 100%", wordBreak: "break-all", fontSize: 12 },
  visitedMeta: {
    flex: "1 1 100%",
    fontSize: 11,
    opacity: 0.7,
    display: "block"
  },
  artifactId: { fontFamily: "ui-monospace, monospace" },
  consentMark: { color: "#14532d" },
  hintsStack: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },
  hintBlock: {
    display: "block",
    margin: 0,
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.45,
    color: "#92400e",
    background: "#fef3c7",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  }
};

// src/client/MissionsIcon.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function MissionsIcon({ size = 16, className, style }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      className,
      style,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M4 2V14", stroke: "currentColor", strokeLinecap: "round" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "path",
          {
            d: "M4 2.8C5.8 2 7.6 2 9 2.9C10.4 3.8 12.2 3.8 12.8 3.2V8.8C12.2 9.4 10.4 9.4 9 8.5C7.6 7.6 5.8 7.6 4 8.4Z",
            stroke: "currentColor",
            strokeLinejoin: "round"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M2.5 14H9", stroke: "currentColor", strokeLinecap: "round" })
      ]
    }
  );
}

// src/client/index.tsx
var name = "dsh-local-web-missions";
var inject = ["slots", "sidebarRightTabs"];
function apply(ctx) {
  const definition = {
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => TAB_TITLE,
    guide: [{
      id: "web-missions",
      order: 280,
      title: () => TAB_TITLE,
      description: () => "Persist-and-find web research: missions on disk, cache hits, lexical find over stored pages",
      icon: MissionsIcon
    }]
  };
  const disposeType = ctx.sidebarRightTabs.register(definition);
  const disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: TAB_ID },
    MissionsBody
  ));
  ctx.effect(() => () => {
    disposeBody();
    disposeType();
  }, "web-missions: rightbar tab type");
}
return module.exports; } });
//# sourceMappingURL=client.js.map
