/**
 * dsh-local-web-missions build — dual-face via shared dsh-build-tools.
 *
 * Defaults: src/host/index.ts → lib/index.js (ESM/node)
 *           src/client/index.tsx → lib/client.js (__ModuleLoader__ CJS)
 */
import { buildDshPlugin } from 'dsh-build-tools'

await buildDshPlugin()
