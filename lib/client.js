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
var MISSIONS_ROUTE = "/api/web-missions/missions";
var MISSIONS_ID_PREFIX = "/api/web-missions/missions";
var TAB_ID = "web-missions";
var TAB_KIND = "web-missions";
var TAB_TITLE = "Missions";

// src/client/MissionsBody.tsx
var import_react = require("react");

// src/client/paneModel.ts
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

// src/client/MissionsBody.tsx
var import_jsx_runtime = require("react/jsx-runtime");
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function MissionsBody() {
  const [list, setList] = (0, import_react.useState)(null);
  const [listError, setListError] = (0, import_react.useState)(null);
  const [detail, setDetail] = (0, import_react.useState)(null);
  const [detailError, setDetailError] = (0, import_react.useState)(null);
  const [view, setView] = (0, import_react.useState)({ kind: "board" });
  const [stopping, setStopping] = (0, import_react.useState)(false);
  const [lastSync, setLastSync] = (0, import_react.useState)(null);
  const sync = (0, import_react.useCallback)(async () => {
    try {
      const data = await fetchJson(MISSIONS_ROUTE);
      setList(data);
      setListError(null);
      setLastSync((/* @__PURE__ */ new Date()).toISOString());
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  (0, import_react.useEffect)(() => {
    void sync();
  }, [sync]);
  const detailToken = (0, import_react.useRef)(0);
  const openDetail = (0, import_react.useCallback)(
    async (missionId) => {
      const token = ++detailToken.current;
      setView({ kind: "detail", missionId });
      setDetail(null);
      setDetailError(null);
      try {
        const data = await fetchJson(`${MISSIONS_ID_PREFIX}${missionId}`);
        if (token === detailToken.current) setDetail(data);
      } catch (error) {
        if (token === detailToken.current) {
          setDetailError(error instanceof Error ? error.message : String(error));
        }
      }
    },
    []
  );
  const stopMission = (0, import_react.useCallback)(async () => {
    if (view.kind !== "detail" || stopping) return;
    setStopping(true);
    const missionId = view.missionId;
    try {
      const data = await fetchJson(`${MISSIONS_ID_PREFIX}${missionId}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      if (data.ok) {
        const token = ++detailToken.current;
        const refreshed = await fetchJson(`${MISSIONS_ID_PREFIX}${missionId}`);
        if (token === detailToken.current) setDetail(refreshed);
      }
    } catch {
    } finally {
      setStopping(false);
      await sync();
    }
  }, [view, stopping, sync]);
  const hint = view.kind === "detail" && detail ? sessionHint(detail.visited) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.heading, children: "Missions" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: listError ? styles.statusError : styles.status, children: listError ? `host: unreachable (${listError})` : lastSync ? `host: ok \xB7 updated ${new Date(lastSync).toLocaleTimeString()}` : "host: \u2026" }),
    view.kind === "board" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Board, { list, onOpen: (id) => void openDetail(id) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      Detail,
      {
        missionId: view.missionId,
        detail,
        error: detailError,
        hint,
        stopping,
        onBack: () => setView({ kind: "board" }),
        onStop: () => void stopMission()
      }
    )
  ] });
}
function Board({ list, onOpen }) {
  if (list === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.empty, children: "loading\u2026" });
  if (list.active.length === 0 && list.recents.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.empty, children: "no missions yet \u2014 start one from chat (mission_start)" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    list.active.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { title: `active (${list.active.length})`, children: list.active.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Row, { onClick: () => onOpen(row.mission_id), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowNote, { note: row.note, active: true }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(RowMeta, { children: [
        "started ",
        formatTime(row.started_at),
        " \xB7 ",
        row.visited,
        " visited",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BudgetChip, { mission: row })
      ] })
    ] }, row.mission_id)) }),
    list.recents.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { title: `recent (${list.recents.length})`, children: list.recents.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Row, { onClick: () => onOpen(row.mission_id), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowNote, { note: row.note, active: row.status === "active" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(RowMeta, { children: [
        row.status,
        " \xB7 updated ",
        formatTime(row.updated_at),
        " \xB7 ",
        row.pages,
        " pages"
      ] })
    ] }, row.mission_id)) })
  ] });
}
function RowNote({ note, active }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: active ? styles.rowNoteActive : styles.rowNote, children: note });
}
function RowMeta({ children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.rowMeta, children });
}
function BudgetChip({ mission }) {
  if (!mission.budget) return null;
  const exhausted = budgetExhausted(mission.budget);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: exhausted ? styles.budgetExhausted : styles.budgetOk, children: [
    " ",
    "\xB7 ",
    budgetLine(mission.budget)
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.sectionTitle, children: title }),
    children
  ] });
}
function Row({ children, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, onClick, role: "button", tabIndex: 0, children });
}
function Detail({
  missionId,
  detail,
  error,
  hint,
  stopping,
  onBack,
  onStop
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.backButton, onClick: onBack, children: "\u2190 board" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.detailHeader, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.detailNote, children: detail?.note ?? "\u2026" }),
      detail && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: detail.status === "active" ? styles.statusActive : styles.statusStopped, children: detail.status })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.detailMeta, children: [
      missionId,
      detail?.stop_reason ? ` \xB7 stopped: ${detail.stop_reason}` : ""
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.detailError, children: [
      "load failed: ",
      error
    ] }),
    detail === null && !error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.empty, children: "loading\u2026" }),
    detail && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: budgetExhausted(detail.budget) ? styles.budgetExhausted : styles.budgetLine, children: [
        "budget ",
        budgetLine(detail.budget)
      ] }),
      hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: hint }),
      detail.status === "active" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.stopButton, onClick: onStop, disabled: stopping, children: stopping ? "stopping\u2026" : "stop mission" }),
      detail.visited.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.empty, children: "no pages yet" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.visitedList, children: detail.visited.map((row) => {
        const badge = qualityBadge(row.quality);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.visitedRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.qualityBadge, color: badge.color, background: badge.background }, children: badge.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.visitedUrl, title: row.url, children: row.url }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.visitedMeta, children: [
            formatAge(row.fetched_at),
            " \xB7 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.artifactId, title: row.artifact_id, children: shortArtifact(row.artifact_id) }),
            row.consent_improved === true && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.consentMark, children: " \u2713 consent" })
          ] })
        ] }, row.artifact_id);
      }) })
    ] })
  ] });
}
var styles = {
  root: { padding: 12, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5 },
  heading: { margin: "0 0 6px", fontSize: 15, fontWeight: 600 },
  status: { margin: "0 0 10px", opacity: 0.75, fontSize: 12 },
  statusError: { margin: "0 0 10px", color: "#f87171", fontSize: 12 },
  empty: { margin: 0, opacity: 0.55, fontStyle: "italic" },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.55, margin: "0 0 4px" },
  row: {
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
    border: "1px solid rgba(128,128,128,0.15)",
    marginBottom: 4
  },
  rowNoteActive: { fontWeight: 600 },
  rowNote: { fontWeight: 400 },
  rowMeta: { display: "block", fontSize: 11.5, opacity: 0.7 },
  budgetOk: { color: "#3f6212" },
  budgetExhausted: { color: "#b91c1c", fontWeight: 600 },
  budgetLine: { margin: "0 0 8px" },
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
  detailHeader: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" },
  detailNote: { fontWeight: 600 },
  statusActive: {
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: 8,
    color: "#14532d",
    background: "#dcfce7"
  },
  statusStopped: {
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: 8,
    color: "#525252",
    background: "#e5e5e5"
  },
  detailMeta: { margin: "2px 0 8px", fontSize: 11.5, opacity: 0.65, fontFamily: "ui-monospace, monospace" },
  detailError: { color: "#f87171", fontSize: 12 },
  hint: {
    margin: "0 0 8px",
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 12,
    color: "#92400e",
    background: "#fef3c7"
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
  visitedList: { marginTop: 6 },
  visitedRow: {
    display: "flex",
    gap: 6,
    alignItems: "baseline",
    padding: "4px 0",
    borderBottom: "1px solid rgba(128,128,128,0.12)"
  },
  qualityBadge: { fontSize: 10.5, padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap" },
  visitedUrl: { flex: 1, wordBreak: "break-all", fontSize: 12 },
  visitedMeta: { fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" },
  artifactId: { fontFamily: "ui-monospace, monospace" },
  consentMark: { color: "#14532d" }
};

// src/client/MissionsIcon.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function MissionsIcon({ size = 16, className, style }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 2V14", stroke: "currentColor", strokeLinecap: "round" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "path",
          {
            d: "M4 2.8C5.8 2 7.6 2 9 2.9C10.4 3.8 12.2 3.8 12.8 3.2V8.8C12.2 9.4 10.4 9.4 9 8.5C7.6 7.6 5.8 7.6 4 8.4Z",
            stroke: "currentColor",
            strokeLinejoin: "round"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M2.5 14H9", stroke: "currentColor", strokeLinecap: "round" })
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
