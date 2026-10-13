#!/usr/bin/env node
// M8 8.1 — fixture liveness checker.
// Probes every URL in fixtures/partner-daten.json (or explicit --url args)
// with browser-like headers. German banking/insurer sites sit behind bot
// checks (comdirect 401, allianz 403) that a plain HTTP client trips —
// those hosts need a browser39 probe (the mission transport) for the
// authoritative answer. This script is the cheap first pass + drift check.
//
// Usage:
//   node scripts/check-fixture-liveness.mjs               # whole fixture set
//   node scripts/check-fixture-liveness.mjs <url> [url…]  # explicit urls
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'partner-daten.json')

const DEFAULT_URLS = JSON.parse(readFileSync(FIXTURE, 'utf8')).entities.flatMap((e) => e.urls)

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// Classification:
//   OK  — 200 + text/html: live.
//   BOT — 401/403: bot check against plain HTTP clients (comdirect CIF_Check,
//         allianz edge). NOT a failure here — verify those via browser39 (the
//         mission transport) for the authoritative answer.
//   BAD — anything else (404, 5xx, redirect to non-HTML, fetch error): a real
//         liveness problem → non-zero exit.
let bad = 0
let bot = 0
for (const url of urls) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      },
    })
    const body = await res.arrayBuffer()
    const ms = Date.now() - t0
    const ctype = (res.headers.get('content-type') || '').split(';')[0]
    const isBot = res.status === 401 || res.status === 403
    const ok = res.status === 200 && ctype.startsWith('text/html')
    if (!ok && !isBot) bad++
    if (isBot) bot++
    console.log(
      `${ok ? 'OK ' : isBot ? 'BOT' : 'BAD'} ${res.status} ${ms}ms ${(body.byteLength / 1024).toFixed(1)}KB ${ctype} ${res.url === url ? '' : '(→ ' + res.url + ')'} ${url}`,
    )
  } catch (e) {
    bad++
    console.log(`ERR ${Date.now() - t0}ms ${e.name}: ${e.message} ${url}`)
  }
}

console.log(`\n${urls.length - bad - bot}/${urls.length} live, ${bot} bot-checked (verify via browser39), ${bad} bad (plain HTTP)`)
process.exit(bad ? 1 : 0)
