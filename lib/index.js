// src/shared/types.ts
var PLUGIN = "dsh-local-web-missions";
var VERSION = "1.0.0";
var HEALTH_ROUTE = "/api/web-missions/health";

// src/host/index.ts
var name = PLUGIN;
var inject = ["webServer"];
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function apply(ctx) {
  let unregister;
  try {
    unregister = ctx.webServer.register({
      kind: "exact",
      path: HEALTH_ROUTE,
      handler: (req, res) => {
        if (req.method !== "GET") {
          send(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        try {
          send(res, 200, {
            ok: true,
            name: PLUGIN,
            version: VERSION,
            time: (/* @__PURE__ */ new Date()).toISOString()
          });
        } catch (error) {
          try {
            send(res, 500, { ok: false, error: errorMessage(error) });
          } catch {
          }
        }
      }
    });
  } catch (error) {
    ctx.logger?.("dsh-local-web-missions").error("route registration failed: %s", errorMessage(error));
    return;
  }
  ctx.effect(() => unregister, "web-missions: /api/web-missions/health route");
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
