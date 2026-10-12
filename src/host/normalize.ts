import { StoreError } from './store'

const WEB_SCHEME = /^(?:https?):$/

/**
 * C2 — URL normalization (the cache key; law, not style).
 *
 * v0 algorithm (DESIGN.md §C2):
 *   1. WHATWG `URL`; unparsable → `normalize_failed` (never stored, never spawned).
 *   2. Lowercase scheme + host (WHATWG `URL` does this on parse).
 *   3. Drop default ports (:80 http, :443 https); keep non-default (WHATWG does this).
 *   4. Drop fragment entirely.
 *   5. Drop trailing slash on path (root path becomes empty).
 *   6. Query: stable-sort params by key then value; re-encode via encodeURIComponent
 *      (deterministic; form-decoded, so `a+b` and `a%20b` collapse to one key).
 *      No tracking-param dropping in v0 — `?utm_source=x` is a different key.
 *   7. Keep userinfo.
 *
 * D-M2.6 (M2 board): v0 accepts only http/https schemes — anything else is
 * `normalize_failed` (the ledger key space is web URLs; browser39 cannot fetch
 * anything else, so a non-web key could never be a cache hit).
 *
 * The returned string is the ledger key.
 */
export function normalizeUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new StoreError('normalize_failed', `unparsable url: ${raw}`)
  }
  if (!WEB_SCHEME.test(u.protocol)) {
    throw new StoreError(
      'normalize_failed',
      `unsupported scheme '${u.protocol}' (http/https only in v0): ${raw}`,
    )
  }

  // Root path '/' becomes empty; any other trailing slash is dropped.
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')

  // Stable sort by key, then value (insertion order is not law).
  const pairs = [...new URLSearchParams(u.search).entries()]
  pairs.sort((a, b) =>
    a[0] === b[0]
      ? a[1] < b[1]
        ? -1
        : a[1] > b[1]
          ? 1
          : 0
      : a[0] < b[0]
        ? -1
        : a[0] > b[0]
          ? 1
          : 0,
  )

  const userinfo = u.username
    ? `${u.username}${u.password ? `:${u.password}` : ''}@`
    : ''
  const query = pairs.length
    ? `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
    : ''

  return `${u.protocol}//${userinfo}${u.hostname}${u.port ? `:${u.port}` : ''}${path}${query}`
}
