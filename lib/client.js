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
var PLUGIN = "dsh-local-web-missions";
var VERSION = "1.0.0";
var HEALTH_ROUTE = "/api/web-missions/health";
var TAB_ID = "web-missions";
var TAB_KIND = "web-missions";
var TAB_TITLE = "Missions";

// src/client/MissionsBody.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function MissionsBody() {
  const [ping, setPing] = (0, import_react.useState)({ status: "pending" });
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    fetch(HEALTH_ROUTE, { method: "GET" }).then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))).then((data) => {
      if (cancelled || !data.ok) return;
      setPing({ status: "ok", name: data.name ?? PLUGIN, version: data.version ?? VERSION });
    }).catch(() => {
      if (!cancelled) setPing({ status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: styles.heading, children: "Missions" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: ping.status === "error" ? styles.pingError : styles.ping, children: [
      ping.status === "pending" && "host: \u2026",
      ping.status === "ok" && `host: ok \xB7 ${ping.name} v${ping.version}`,
      ping.status === "error" && "host: unreachable"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.empty, children: "no missions yet" })
  ] });
}
var styles = {
  root: { padding: 12, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5 },
  heading: { margin: "0 0 8px", fontSize: 15, fontWeight: 600 },
  ping: { margin: "0 0 12px", opacity: 0.9 },
  pingError: { margin: "0 0 12px", color: "#f87171" },
  empty: { margin: 0, opacity: 0.55, fontStyle: "italic" }
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
