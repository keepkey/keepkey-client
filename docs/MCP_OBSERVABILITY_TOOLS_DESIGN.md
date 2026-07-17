# Design: Five page-observability tools for the KeepKey browser-driving MCP toolset

## 1. Intro

These five tools (`bex_network`, `bex_storage`, `bex_vitals`, `bex_memory`, `bex_gpu`) ride the exact substrate that `bex_console` already proves in production: a MAIN-world collector installed by `injected.ts` (an esbuild IIFE injected as a `<script src=chrome.runtime.getURL('injected.js')>` by the document_start content script), a same-window `keepkey-content` (ISOLATED→MAIN) / `keepkey-injected` (MAIN→ISOLATED) `postMessage` request/reply pair, an ISOLATED-world `agentDom.ts` `handle()` op reached over `chrome.tabs.sendMessage({type:'BEX_AGENT_DOM', op, ...})`, and a `{name, description, inputSchema}` entry in `BROWSER_TOOLS` + a `case` in `executeBrowserTool` that calls `dom(tabId, op, payload)`. They need **no new permission** (manifest stays `storage`/`tabs`/`commands` + `<all_urls>`, plus `sidePanel` on Chrome), **no `chrome.debugger`**, **no `chrome.scripting`**, and **no CDP** — deliberately, because `chrome.debugger.attach()` raises Chrome's "extension is debugging this browser" infobar on a wallet extension, and the team refuses that. Once the vault dumb-pipe lands (see `HANDOFF_vault_mcp_dumb_pipe.md`), the vault serves whatever `bex_list_tools` reports, so these auto-advertise with **no vault change**.

Two of the five (`bex_storage`, `bex_memory`) are pure on-demand point-reads; `bex_storage` doesn't even touch the MAIN world (web storage is origin-scoped and shared with the ISOLATED content script). The other three keep a bounded page-side ring buffer that captures **from injection onward** and is pulled on demand.

## 2. Ranked tool table (most valuable first for a wallet dApp flow)

| # | Tool | What it answers | Buffered / on-demand | Effort | Headline limitation |
|---|------|-----------------|----------------------|--------|---------------------|
| 1 | **`bex_network`** | "Did the `/quote` / `/swap` / RPC call 500, get CORS-blocked, or abort — and what was slow/heavy?" | Buffered (fetch/XHR interceptor + Resource Timing) | **L** | Cross-origin (the common RPC/quote case) yields status+method+total-duration from the interceptor but **zeroed** DNS/TCP/TLS/TTFB/sizes from Resource Timing; **no** response bodies/headers ever; captures **from injection onward** only. |
| 2 | **`bex_storage`** | "What did this dApp persist? WalletConnect session, connector cache, selected chain, auth token?" | On-demand | **M** | **HttpOnly cookies are invisible** to `document.cookie` — and the auth/session cookies that matter most usually *are* HttpOnly. Top-frame origin only; IndexedDB is structure-only. |
| 3 | **`bex_vitals`** | "Is this page loading healthily — LCP/CLS/FCP/TTFB, and where's the blocking time?" | Buffered (PerformanceObserver aggregate) | **M** | **INP/FID stay `waiting` under agent automation** (synthetic `bex_click` is `isTrusted=false`); values are one synthetic session on the user's device, and LCP/CLS/INP are interim until finalized. |
| 4 | **`bex_memory`** | "Is this dApp leaking/bloating the heap? Is the page memory-light before vs after a flow?" | On-demand | **S** | `performance.memory` is Chrome-only, coarse/quantized, renderer-JS-heap-only; the precise per-context API (`measureUserAgentSpecificMemory`) needs `crossOriginIsolated`, which ~no dApp sets. Detached-node leaks are unobservable. |
| 5 | **`bex_gpu`** | "Is this dApp janky, and what script/iframe is blocking the main thread?" | Buffered (LoAF/longtask) + short rAF sample + static identity | **M** | **GPU utilization %, VRAM, temperature, clocks are impossible** from any page API. rAF FPS measures frame-*delivery* cadence (a main-thread-congestion proxy), not GPU load; identity strings are frequently masked. |

## 3. Per-tool designs

---

### 3.1 `bex_network` — page network + performance observability

**What it answers.** "Did the `/quote` call 500 or get aborted?" *and* "what was slow and how big was it?" — without `chrome.debugger`.

**APIs used (all MAIN-world, no permission):**

- **`window.fetch` monkeypatch**, installed as the *first* statement of the injected IIFE (same technique `installConsoleCapture()` already uses, and how `window.ethereum` is installed). Captures method, URL, final status, `ok`, `Response.redirected`, duration (`performance.now()` delta), and the reject path (network `TypeError`, `AbortError`). This is the **only** reliable source of HTTP status + failure for fetch traffic.
- **`XMLHttpRequest.prototype.open` + `.send` wrap** (WebIDL operations are `writable`/`configurable`). On the `load` event read `xhr.status` (`load` fires for 4xx/5xx too); observe `error`/`abort`/`timeout` events.
- **`PerformanceObserver({type:'resource', buffered:true})`** + `performance.getEntriesByType('resource')` (`PerformanceResourceTiming`): per-subresource DNS/TCP/TLS/TTFB/download breakdown, `transferSize`/`encodedBodySize`/`decodedBodySize`, `initiatorType`, `nextHopProtocol`, **and `responseStatus`** (Resource Timing L2, **Chrome 109+, Chromium-only** — do *not* assume status is unreadable here). No request method exists on this entry. `buffered:true` replays entries recorded **before** our injection.
- **`performance.getEntriesByType('navigation')[0]`** (`PerformanceNavigationTiming`): the document's own load waterfall (`domInteractive`, `domContentLoadedEventEnd`, `loadEventEnd`), TTFB, transfer sizes. Because this is the top-level **same-origin** document, cross-origin zeroing does **not** apply — these fields are populated.
- **`performance.timeOrigin` + `entry.startTime`**: an **approximate** epoch-ms timestamp (coarsened to ~100 µs, ~5 µs only if `crossOriginIsolated`; drifts from wall-clock on long-lived pages because `startTime` rides a monotonic clock while `timeOrigin` is a single snapshot). Treat as good telemetry, not exact wall-clock. Needs a `navigationStart` fallback pre-Safari 15 (irrelevant for the Chrome target).
- **Optional `perf` block:** `PerformanceObserver` types `paint` (FCP), `largest-contentful-paint` (LCP), `layout-shift` (CLS), `longtask` (blocking); plus `performance.memory` (Chrome-only, coarse/quantized, **JS-heap only**). Best reachable jank/heaviness proxy; there is no GPU/CPU/process metric.
- **Optional `WebSocket`-constructor and `navigator.sendBeacon` wraps:** record connection URL / open / close / beacon dispatch — **not** per-frame payloads or beacon responses.
- **Transport:** a new `BEX_NET_QUERY`→`BEX_NET_RESULT` `postMessage` pair (a *new* listener branch modeled on `consoleCapture.ts`, not a reuse of the wallet `WALLET_REQUEST` handler, whose `isValidWalletMessage` allow-list silently drops unknown types) carried by the existing `dom(tabId,'network')` op. `handle()` is already `async` and the `onMessage` listener returns `true`, so the op can `await` the round trip before `sendResponse` — exactly like `bex_console`. This guarantees the async *transport*, not any additional capture power.

**inputSchema:**

```json
{
  "type": "object",
  "properties": {
    "tabId": { "type": "number", "description": "Target tab; omit for the active tab." },
    "pattern": { "type": "string", "description": "Case-insensitive regex matched against each entry's URL, method, and stringified status. e.g. \"/quote|/swap\" or \"5\\\\d\\\\d\"." },
    "since": { "type": "number", "description": "Epoch-ms floor; return only entries that STARTED at/after this time. Capture Date.now() right before a click to scope the report to one action." },
    "limit": { "type": "number", "description": "Max entries kept PER section, newest-last. Default 100." },
    "include": { "type": "array", "items": { "type": "string", "enum": ["navigation","requests","resources","summary","perf"] }, "description": "Sections to return. Default ['navigation','requests','summary']. Add 'resources' for the full timing waterfall, 'perf' for FCP/LCP/CLS/longtasks/JS-heap." },
    "failuresOnly": { "type": "boolean", "description": "Restrict `requests` to failures, aborts, and status >= 400." }
  },
  "additionalProperties": false
}
```

**Return shape (abridged):**

```json
{
  "url": "https://app.thorswap.finance/swap",
  "capturedFrom": 1752566400123,
  "capturedFromNote": "interceptor coverage floor (injection time); fetch/XHR before this are invisible to method/status",
  "navigation": { "type": "navigate", "startedAt": 1752566399980, "dns": 3, "tcp": 12, "tls": 41,
    "ttfbMs": 214, "responseMs": 38, "domContentLoadedMs": 640, "loadMs": 1180,
    "transferBytes": 18422, "encodedBytes": 61003, "decodedBytes": 190551, "protocol": "h2" },
  "requests": [
    { "kind": "fetch", "method": "POST", "url": ".../aggregator/tokens/quote", "status": 200, "ok": true, "error": null, "startedAt": 1752566402310, "durationMs": 348, "resSize": 4821 },
    { "kind": "fetch", "method": "POST", "url": ".../aggregator/tokens/quote", "status": 502, "ok": false, "error": null, "startedAt": 1752566404120, "durationMs": 1204, "resSize": 71 },
    { "kind": "xhr", "method": "GET", "url": "https://rpc.ankr.com/eth", "status": null, "ok": false, "error": "aborted", "startedAt": 1752566404500, "durationMs": 90, "resSize": null }
  ],
  "resources": [
    { "kind": "resource", "initiatorType": "fetch", "url": ".../aggregator/tokens/quote", "startedAt": 1752566402310, "durationMs": 348,
      "dns": 0, "tcp": 0, "tls": 0, "ttfbMs": 0, "downloadMs": 0,
      "transferBytes": 0, "encodedBytes": 0, "decodedBytes": 0, "protocol": "", "cached": false, "crossOriginOpaque": true }
  ],
  "perf": { "fcpMs": 612, "lcpMs": 1340, "cls": 0.02, "longTasks": 3, "totalBlockingMs": 210,
    "jsHeapUsedBytes": 48210000, "jsHeapLimitBytes": 2172649472,
    "jsHeapNote": "Chrome-only, coarse/quantized; JS heap only — not GPU/CPU/process memory" },
  "summary": { "requestsCaptured": 3, "resourcesCaptured": 47,
    "byStatus": { "2xx": 1, "3xx": 0, "4xx": 0, "5xx": 1, "failed": 1 },
    "failed": [ { "method": "POST", "url": ".../quote", "status": 502, "error": null },
                { "method": "GET", "url": "https://rpc.ankr.com/eth", "status": null, "error": "aborted" } ],
    "slowest": [ { "url": ".../quote (502)", "durationMs": 1204 } ],
    "totalTransferBytes": 18422, "bufferFull": false, "droppedEarly": false }
}
```

**What it cannot do:**

- **Capture pre-injection traffic.** `injected.js` is loaded as an **async** external `<script>` — it executes shortly *after* document_start (script `onload` + `INJECTION_TIMEOUT`/retry), not synchronously at it. Any fetch/XHR fired by head/inline/early-module page scripts before the wrapper installs is invisible to method/status. Installing the wrapper as the IIFE's first statement shrinks but cannot zero this gap without the debugger.
- **See beyond the top frame or the `fetch`/XHR APIs.** No `all_frames`, so iframe (same- or cross-origin) requests are never seen; Web/Service Workers have their own unpatched `fetch`. The interceptor hooks `fetch()` and XHR **only** — `<img>`/`<link>`/`<script>`/CSS loads, `sendBeacon`, `WebSocket`, `EventSource` are invisible to it (Resource Timing partly offsets this for subresource *types*, not status). A page can also bypass the patch entirely by pulling a pristine `fetch` off a fresh `iframe.contentWindow` — best-effort observability of cooperative same-realm code, **not** a security-grade intercept.
- **Give HTTP status on the failure path.** Network-level failures (DNS, connection refused, CORS block) all collapse to an **indistinguishable, runtime-dependent `'Failed to fetch'` TypeError** with **no status and no `Response`**; only `AbortError` is separable. Conversely, 4xx/5xx `fetch()` calls **resolve** — status lives on the response path, not the reject path. The interceptor reliably captures the *fact* of a failure, never the *reason*.
- **Give cross-origin timing or sizes.** For a cross-origin resource without a `Timing-Allow-Origin` header (the common RPC/quote/CDN case), Resource Timing zeroes `domainLookup*`, `connect*`, `secureConnectionStart`, `requestStart`, `responseStart`, `redirect*`, all three byte sizes, `nextHopProtocol`, and `responseStatus` — leaving only URL, `startTime`, `fetchStart`, `responseEnd`, `duration`, `initiatorType` (shown as `crossOriginOpaque:true`). The two mechanisms are **complementary, not redundant**: the interceptor has status+method+total-duration but no phase breakdown; Resource Timing has the breakdown (same-origin/TAO only) but no method and unreliable failure coverage.
- **Read request/response bodies or arbitrary headers.** Deliberate for a wallet (bodies carry addresses/amounts). Response size is best-effort from `Content-Length` and is `null` for chunked/streamed responses; we never clone-and-drain the body.
- **Log WebSocket/EventSource payloads** (need CDP), or a beacon's server response.
- **Recover pre-buffer-cap entries.** Resource-timing buffer defaults to ~250; we mirror entries out (with `clearResourceTimings()`) so later loads aren't silently dropped, and bound the request ring like `providerLog` (~500 entries, ~2000 chars/entry, URLs clipped, serialization never throws; eviction sets `summary.bufferFull=true`). Buffer resets on full-document navigation, **persists** across SPA `pushState` (use `since` to scope).
- **Trust sub-millisecond numbers** — timing precision is Spectre-clamped (~100 µs, coarser under cross-origin isolation).
- **Report GPU%/CPU%/process memory** — impossible from a page; the only memory proxy is `performance.memory` (coarse, JS-heap only). (`navigator.deviceMemory` gives device-RAM *capacity*, and `measureUserAgentSpecificMemory` needs `crossOriginIsolated` — see `bex_memory`.)
- **Run at all on very strict `script-src` CSP pages** where the main-world script can't inject — the content-side query times out (~2s) and the tool returns a clean `collector_unavailable`.

---

### 3.2 `bex_storage` — read-only dump of persisted dApp state

**What it answers.** Everything a dApp persisted for the current **top-frame origin**: `localStorage`, `sessionStorage`, JS-visible cookies, IndexedDB DB/store *structure*, Cache Storage names/counts. Built to debug WalletConnect sessions, connector caches, and chain selection.

**Architecture note.** This op lives **entirely in the ISOLATED content script** (`agentDom.ts`) — web storage is **origin-scoped, not world-scoped**, so `window.localStorage`/`sessionStorage`/`document.cookie`/`indexedDB`/`caches` in the content script are the page's own stores. **No `injected.ts` change and no `keepkey-injected`/`keepkey-content` bridge is needed.** Reading in the ISOLATED world also defeats page-side accessor tampering (the isolated world has its own untampered `Storage.prototype` binding) — though only against *accessor* spoofing, not against a hostile page corrupting the actual per-origin data via native `setItem`/`removeItem`.

**APIs used:**

- **`localStorage` / `sessionStorage`** — synchronous `key()`/`getItem()`/`length`; string pairs; immune to main-world accessor monkeypatching.
- **`document.cookie`** — the `name=value; …` string of **non-HttpOnly** cookies; **no** attributes (domain/path/expiry/Secure/SameSite/HttpOnly).
- **`indexedDB.databases()`** → `{name, version}[]` (**Chromium-only**; absent in Firefox). Enumerate **first**, then `indexedDB.open(name)` (no version → no `upgradeneeded`, no write) on **already-existing** names, read `db.objectStoreNames`, `db.close()`. Opening a *non-existent* name would **create and persist** a phantom v1 DB — a real side effect — so we never open unenumerated names.
- **`caches.keys()` + `cache.keys().length`** — cache names + entry counts, **secure-context only** (present on `http://localhost` too), wrapped in try/catch (`window.caches` access can throw `SecurityError` on opaque/sandboxed origins); never response bodies.

**inputSchema:**

```json
{
  "type": "object",
  "properties": {
    "area": { "type": "string", "enum": ["all","local","session","cookies","indexeddb","cache"], "description": "Which store to read. Default: all." },
    "pattern": { "type": "string", "description": "Case-insensitive regex; keep only entries whose KEY / cookie NAME / database NAME / cache NAME matches. Does not match values." },
    "values": { "type": "boolean", "description": "Include values. Default true. Set false to return keys + byte sizes + sensitive flags only, keeping secrets out of context." },
    "limit": { "type": "number", "description": "Max entries per store. Default 200, hard-capped at 500." },
    "tabId": { "type": "number", "description": "Target tab. Omit to use the active tab." }
  },
  "additionalProperties": false
}
```

**Return shape (abridged):**

```json
{
  "url": "https://app.uniswap.org/swap", "origin": "https://app.uniswap.org", "secureContext": true,
  "local": { "supported": true, "count": 42, "returned": 42, "truncated": false, "bytes": 18734,
    "entries": [ { "key": "wc@2:client:0.3//session", "size": 4021, "sensitive": true, "value": "[clipped 4021 chars] {\"topic\":\"a1b2..." },
                  { "key": "theme", "size": 4, "sensitive": false, "value": "dark" } ] },
  "session": { "supported": true, "count": 1, "returned": 1, "bytes": 88, "entries": [ ] },
  "cookies": { "supported": true, "count": 3,
    "note": "document.cookie exposes only non-HttpOnly cookies; attributes and HttpOnly session cookies are invisible to page JS",
    "entries": [ { "name": "__cf_bm", "size": 43, "sensitive": false, "value": "..." } ] },
  "indexeddb": { "supported": true, "databases": [
    { "name": "keyval-store", "version": 1, "objectStores": ["keyval"] },
    { "name": "WALLET_CONNECT_V2_INDEXED_DB", "version": 1, "objectStores": ["keyvaluestorage"] } ] },
  "cache": { "supported": true, "caches": [ { "name": "workbox-precache-v2", "entries": 231 } ] },
  "warnings": ["indexeddb: database 'foo' could not be opened within 500ms (in-progress upgrade); listed without object stores"]
}
```

With `values:false`, each entry drops `value` and keeps `key`/`name`, `size`, `sensitive`. Absent stores appear as `{supported:false, reason}`. Errors reuse the `dom()` envelope (`{ok:false, code, message}`, e.g. `no_content_script`).

**What it cannot do:**

- **See HttpOnly cookies** — invisible to `document.cookie`, and the session/auth cookies that matter most for connection debugging usually *are* HttpOnly. Reaching them needs `chrome.cookies` (not granted) or `chrome.debugger` (refused).
- **Report cookie attributes** — `document.cookie` yields only `name=value`; domain/path/expires/Secure/SameSite/HttpOnly are not exposed to page JS.
- **Read IndexedDB records** — structure only (DB names, versions, store names). Arbitrary stores can be enormous; a future `bex_storage_idb_read(db,store,key)` is out of scope.
- **Enumerate IndexedDB on Firefox** — `indexedDB.databases()` is Chromium-only → `supported:false` there.
- **See Cache Storage on plain `http://`** — `window.caches` is undefined off a secure context → `supported:false`; even present it gives names + counts, never bodies.
- **Reach cross-origin iframe / partitioned storage** — content script runs `all_frames:false` (top frame only). The barrier for a cross-origin child is the **Same-Origin Policy** (`contentWindow.localStorage` throws), not `all_frames` alone; same-origin iframes/opened windows *are* readable, so the scope is precisely the **top-frame origin**.
- **Diff over time** — point-in-time snapshot, no subscription. No browser timestamps, so `since` is impossible and ordering is native insertion order (not chronological).
- **Return full values** — clipped to ~2000 chars (original length reported). IndexedDB values that legally contain `BigInt`, circular refs, or `Blob`/`File` collapse **wholesale** to `[unserializable]` (only always-string local/session values are lossless).
- **Guarantee read-only structurally** — the handler is *audited* to call only read paths (Storage iteration/`getItem`, `document.cookie` read, readonly IDB transactions); a token scan alone would not prove it (a MAIN-world write could bypass via `localStorage.x = v`, `cookieStore.set()`, OPFS). Read-only here = audited call graph, not "writing is impossible."
- **Trust the `sensitive` flag** — a heuristic (matches `token`/`secret`/`seed`/`jwt`/`wc@` key shapes and JWT/long-hex/base64 values) with false positives *and* negatives. With `values:true` the response **does** carry any secret the dApp stored; `values:false` is the safe inspection mode. The tool never persists or re-transmits reads (no `providerLog`, no `chrome.storage`).

---

### 3.3 `bex_vitals` — page-load performance & Core Web Vitals

**What it answers.** LCP, CLS, INP/FID, FCP, TTFB + navigation timing, each with a value, a good/needs-improvement/poor rating, and a `final`/`interim`/`waiting`/`unsupported` status. One synthetic session on the user's real device — **not** aggregated CrUX field data.

**APIs used (MAIN-world PerformanceObserver aggregate, read on demand):**

- `PerformanceObserver` types (each **observed once per type with a single `type` + `buffered:true`** — the flag is silently ignored with the `entryTypes` array form): `largest-contentful-paint`, `layout-shift` (sum session-window, exclude `hadRecentInput`), `paint` (FCP), `first-input` (FID = `processingStart − startTime`), `event` (INP), `longtask` (TBT-style approximation).
- **INP computation:** `event` observer with an **explicit low `durationThreshold` (min 16 ms)** + `buffered:true`; group `PerformanceEventTiming` by `interactionId` (exclude `interactionId===0`); each interaction's duration = **MAX** over its entries; report the **Nth-worst** where `N = 1 + floor(performance.interactionCount/50)` (use `performance.interactionCount`, **not** observed-entry count, or INP is overestimated), capped at the 10th-worst. Retain ~10 interactions → stays well under the 500-entry/2000-char bounds.
- **`performance.getEntriesByType('navigation')[0]`** read on demand: `responseStart` (TTFB), `domInteractive`, `domContentLoadedEventEnd`, `loadEventEnd`, `responseEnd`, transfer sizes, `nextHopProtocol`, `type`, `redirectCount`. Same-origin document → not cross-origin-zeroed.
- **Finalization detection:** `{once,capture}` `click`+`keydown` (web-vitals uses these, not `pointerdown`) + `visibilitychange`→hidden (+ `pagehide` for bfcache) to finalize LCP and freeze CLS. Best-effort heuristic.
- `PerformanceObserver.supportedEntryTypes` for feature-detection → unsupported metrics report `status:'unsupported'`.
- Transport: a **new** dedicated `VITALS_QUERY`/`VITALS_RESULT` listener pair (cannot reuse the wallet `WALLET_REQUEST` handler; its allow-list drops unknown types), like `bex_console`.

**inputSchema** (deliberately no `{pattern, since, limit}` — an aggregate snapshot, not a filterable log):

```json
{
  "type": "object",
  "properties": {
    "tabId": { "type": "number", "description": "Target tab; defaults to the active tab in the last-focused window" }
  },
  "additionalProperties": false
}
```

**Return shape (abridged):**

```json
{
  "url": "https://app.uniswap.org/swap", "capturedFromInjection": true,
  "observedForMs": 8421, "navigationType": "navigate", "visibilityState": "visible", "everHidden": false,
  "interactionCount": 3, "droppedEntries": 0,
  "metrics": {
    "LCP":  { "value": 2143, "unit": "ms",    "rating": "good",              "status": "final",   "element": "img.hero" },
    "CLS":  { "value": 0.04, "unit": "score", "rating": "good",              "status": "interim", "largestShiftTarget": "div.promo-banner" },
    "INP":  { "value": 232,  "unit": "ms",    "rating": "needs-improvement", "status": "interim", "worst": { "eventType": "pointerdown", "target": "button.swap" } },
    "FID":  { "value": 12,   "unit": "ms",    "rating": "good",              "status": "final",   "eventType": "pointerdown" },
    "FCP":  { "value": 1320, "unit": "ms",    "rating": "good",              "status": "final" },
    "TTFB": { "value": 210,  "unit": "ms",    "rating": "good",              "status": "final" }
  },
  "navigationTiming": { "ttfbMs": 210, "domInteractiveMs": 1400, "domContentLoadedMs": 1650, "loadEventMs": 3120,
    "responseEndMs": 480, "transferSizeBytes": 48211, "encodedBodySizeBytes": 46000, "decodedBodySizeBytes": 210000,
    "nextHopProtocol": "h2", "redirectCount": 0 },
  "longTasks": { "count": 4, "totalBlockingMs": 180, "note": "approx TBT, main-thread only, since injection" },
  "notes": [ "INP/FID require a REAL user interaction; synthetic bex_click (isTrusted=false) does not populate them." ]
}
```

Status values: `final` (FCP/TTFB/FID once fired, LCP after finalization), `interim` (CLS while visible, LCP before first input, INP after each interaction), `waiting` (INP/FID before any real interaction, FCP before first paint), `unsupported`. Ratings use web.dev thresholds (LCP 2500/4000, CLS 0.1/0.25, INP 200/500, FID 100/300, FCP 1800/3000, TTFB 800/1800 ms). Background renders as compact multi-line text.

**What it cannot do:**

- **Populate INP/FID under agent automation.** Event Timing records only **trusted** input; `agentDom.ts`'s `bex_click` dispatches `isTrusted=false` synthetic events → no `interactionId`/`first-input` entries → INP/FID stay `waiting`. They populate only when a **real human** interacts.
- **Give field/aggregate data.** One synthetic session on this device and load; numbers vary run to run.
- **Recover pre-injection or evicted metrics.** `injected.js` loads **async** (a few ms after document_start, not a `world:'MAIN'` content script), so it usually lands before LCP and often before FCP but is **not guaranteed before FCP** (inline-rendered pages, or the 100/200/400 ms retry path, can paint first). `buffered:true` replays only entries still in the small per-type buffer (resource ~250, paint 2, longtask ~200, event ~150); overflow is silent — `droppedEntries>0` reports a *count* only, never identity/values. Event Timing also drops sub-`durationThreshold` entries.
- **Guarantee a settled value.** LCP/CLS/INP are `interim` at query time unless finalized; CLS is never truly final while visible. The LCP-finalization heuristic misses wheel/trackpad-scroll (which stops LCP without firing click/keydown), and if interaction happened before the observer registered you can only read the last buffered entry.
- **Reset on SPA/bfcache navigation.** Buffers are per-**document** (not per-tab). Only a hard cross-document navigation mints a fresh timeline and re-injects. `pushState`/`replaceState`/hash changes and bfcache restores reuse the same document — the version guard even blocks re-init on bfcache — so vitals stay anchored to the initial hard navigation (matching the standard web-vitals limitation).
- **Aggregate cross-frame vitals.** Reports the top document only; cross-origin iframes have separate timelines and separate Event Timing; long-task attribution across them is opaque (`containerName` only).
- **Read caching artifacts precisely.** `domInteractive`/`domContentLoadedEventEnd`/`loadEventEnd` read `0` until their event fires; `transferSize` is `0` on cache hits/304s; a cross-origin redirect in the chain zeroes redirect sub-timings and can blank `nextHopProtocol`.
- **Report GPU%/CPU%/true TTI/OS memory pressure** — no sandboxed-page API. The closest signals are long-task blocking time (rough TBT, main-thread only) and, MAIN-world only, `performance.memory` (out of scope here). *(Note: a coarse CPU-pressure signal does exist — see appendix.)*
- **Run on pre-extension tabs** — returns `no_content_script` like the other tools.

---

### 3.4 `bex_memory` — on-demand memory-pressure snapshot

**What it answers.** The page's JS heap, device RAM/CPU class, cheap DOM-weight proxies, and (only when `crossOriginIsolated`) a per-context byte breakdown — to catch "this dApp is leaking/bloating" or confirm a page is light before/after a wallet flow.

**APIs used:**

- **`performance.memory`** (Chrome-only `MemoryInfo`): `usedJSHeapSize`/`totalJSHeapSize`/`jsHeapSizeLimit`, renderer-process-wide V8 heap, **coarse/quantized** unless `crossOriginIsolated`.
- **`performance.measureUserAgentSpecificMemory()`** → `{bytes, breakdown:[{bytes, types[], attribution[{url,scope}]}]}`; per-context attribution. **Requires `crossOriginIsolated===true`** (COOP+COEP), async, Chromium-only, resolves after a browser-scheduled measurement with a **variable delay** (seconds) — hence the opt-in flag + timeout.
- **`self.crossOriginIsolated`** — read directly (no need to compare two pages) to know which `performance.memory` regime you're in. An injected script **cannot** make its host page isolated.
- **`navigator.deviceMemory`** — device RAM in GiB clamped to `{0.25,0.5,1,2,4,8}` (capability, not usage; may be undefined).
- **`navigator.hardwareConcurrency`** — logical cores (may be privacy-clamped).
- **DOM-weight proxies:** `getElementsByTagName('*').length`, `window.frames.length` + `querySelectorAll('iframe').length`, `document.styleSheets.length`, `getEntriesByType('resource').length`.

**inputSchema:**

```json
{
  "type": "object",
  "properties": {
    "tabId": { "type": "number", "description": "Target tab. Omit for the active tab." },
    "detailed": { "type": "boolean", "description": "Also run performance.measureUserAgentSpecificMemory() for a per-context byte breakdown. Only works when the page is crossOriginIsolated (most dApps are NOT); otherwise detailedStatus='unavailable_requires_coi'. Adds latency. Default false." },
    "detailedTimeoutMs": { "type": "number", "description": "Max ms to wait for the detailed measurement before detailedStatus='timed_out'. Default 12000, capped 30000. Ignored unless detailed=true." }
  },
  "additionalProperties": false
}
```

**Return shape (abridged):**

```json
{
  "url": "https://app.uniswap.org/#/swap",
  "heapSource": "main", "crossOriginIsolated": false,
  "jsHeap": { "usedJSHeapSize": 52428800, "totalJSHeapSize": 71303168, "jsHeapSizeLimit": 2172649472,
    "precise": false, "note": "coarse/quantized, ~renderer-process-wide; high-resolution only when crossOriginIsolated" },
  "device": { "deviceMemoryGb": 8, "hardwareConcurrency": 10 },
  "dom": { "elements": 3421, "iframes": 3, "frames": 3, "stylesheets": 12, "resourceEntries": 187 },
  "detailed": null,
  "detailedStatus": "unavailable_requires_coi",
  "capturedAt": 1721145600000,
  "limitations": [ "performance.memory is coarse/quantized on this non-cross-origin-isolated page",
                   "detached-node count and GPU usage are not observable from a page" ]
}
```

`heapSource` ∈ `main` | `isolated_fallback` (MAIN round-trip timed out — `dom`/`device` still populate, `jsHeap` is the ISOLATED-world read or null, `detailed` null) | `unavailable`. `detailedStatus` ∈ `skipped` | `unavailable_requires_coi` | `unavailable_no_api` | `timed_out` | `ok` | `error`. Rendered as indented text.

**What it cannot do:**

- **Give precise per-page memory on a normal dApp.** `performance.memory` is Chrome-only, non-standard/deprecated, quantized, and ~renderer-process-wide (a same-process sibling frame/tab inflates it). Precise values need `crossOriginIsolated` (or the `--enable-precise-memory-info` flag) — neither controllable by an injected script — so `precise` is almost always `false`. `measureUserAgentSpecificMemory()`, the only true per-context API, returns `unavailable_requires_coi` on ~every dApp.
- **Detect detached-node leaks directly.** No API enumerates detached nodes; `WeakRef`/`FinalizationRegistry` can't list live objects. Total element count is a leak **smell**, not proof — and this stateless tool doesn't track the trend (call it before/after to diff).
- **Report GPU utilization or GPU/VRAM memory** — no web API. `WEBGL_debug_renderer_info` gives only an identity string (increasingly gated). *(A rough total-VRAM ceiling is inferable via allocation-until-failure probing, but this tool does not do that.)*
- **Treat `deviceMemory` as usage** — it's a fuzzed capability ceiling `{0.25…8}` GiB, possibly undefined.
- **Show history** — a point read; no injection-time blind spot, but no timeline either.
- **Run on `chrome://`/Web Store/PDF tabs** — `no_content_script`, like the others. On strict-CSP pages it degrades to `isolated_fallback` (ISOLATED DOM/heap signals) rather than failing.

---

### 3.5 `bex_gpu` — rendering-health readout (honest GPU proxy)

**What it answers.** "Is this dApp janky and why" — a live rAF-sampled FPS/dropped-frame measurement, a buffered jank log (Long Animation Frames + Long Tasks with script/container attribution), and one-time GPU **identity**. It deliberately does **not** report GPU utilization/VRAM/temperature/clocks — no web API exposes those.

**APIs used:**

- **`requestAnimationFrame`** — consecutive `DOMHighResTimeStamp` deltas over a bounded window → avg/min FPS, median/p95/longest frame time, dropped-frame count, inferred refresh rate. TRUE frame-delivery cadence; a **proxy** for rendering health, not a GPU-load meter. Foreground-only (rAF is throttled to ~0 when hidden).
- **`PerformanceObserver({type:'long-animation-frames', buffered:true})`** (**Chromium 123+**) — per-frame jank >50 ms with `scripts[]` attribution (`sourceURL`, `functionName`, `duration`, `invoker`, `invokerType`, `forcedStyleAndLayoutDuration`), `blockingDuration`, `renderStart`, `styleAndLayoutStart`. Primary jank source.
- **`PerformanceObserver({type:'longtask', buffered:true})`** (**Chromium 58+**) — main-thread tasks >50 ms with `attribution[]` (`containerType`/`Name`/`Src`). Coarser fallback + iframe/container blame. Both feature-detected via `PerformanceObserver.supportedEntryTypes`; both **Chromium-only** (Firefox build gets zero data, degrades silently). `buffered:true` replays only entries still in the finite timeline buffer.
- **WebGL `WEBGL_debug_renderer_info`** — throwaway canvas, `getExtension(...)`, `getParameter(UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL)`. Best-effort GPU/driver identity; the renderer string reveals software fallback (SwiftShader/llvmpipe) → a `hardwareAccelerated` hint. **Low-confidence:** the extension may be null under hardening (Firefox `resistFingerprinting`, Tor, Brave, policy) *and* frequently returns **non-null masked/normalized** strings (ANGLE-wrapped, generic `Google Inc.`) or spoofed values.
- **`navigator.gpu.requestAdapter()` → `adapter.info`** (WebGPU, Chrome 113+, **secure context only**) — coarse `vendor`/`architecture` by default; `device`/`description` are **empty** unless WebGPU Developer Features is enabled (privacy masking). Sync `adapter.info` is **Chrome 128+** (older needs async `requestAdapterInfo()`). Guard `navigator.gpu` being undefined (accessing `.requestAdapter()` throws `TypeError`) separately from `requestAdapter()` resolving null.
- **`document.visibilityState`** gates FPS (report `visible:false`, not a bogus 0). **`performance.memory.usedJSHeapSize`** surfaced only as clearly-labeled renderer JS-heap context — explicitly **not** GPU/VRAM.
- Transport: a `BEX_PAGE_METRICS`/`op:'gpu'` round trip over the bridge (**new** listener branch modeled on `consoleCapture.ts:118-126`, not `injected.ts`'s wallet-response listener). *Note: the MAIN world confers no GPU-read advantage over the ISOLATED content script for identity; the round-trip is kept only for co-location with the rAF/LoAF collector.*

**inputSchema:**

```json
{
  "type": "object",
  "properties": {
    "tabId": { "type": "number", "description": "Target tab. Omit to use the active tab in the last-focused window." },
    "sampleMs": { "type": "number", "description": "Live rAF frame-timing window in ms. Default 1000, clamped [0,5000] (and must stay well under the vault's ~30s bridge timeout). 0 skips live sampling → only the buffered jank log + GPU identity. Requires a FOREGROUND tab; rAF is suspended when hidden." },
    "include": { "type": "array", "items": { "type": "string", "enum": ["fps","loaf","longtask","identity"] }, "description": "Sections. Default: all. GPU identity is static — pass e.g. [\"fps\",\"loaf\"] on repeat calls to keep context small." },
    "since": { "type": "number", "description": "Only return buffered loaf/longtask events with ts (ms epoch) >= this. Newest-last." },
    "limit": { "type": "number", "description": "Max buffered events per buffer, newest-last. Default 50." },
    "pattern": { "type": "string", "description": "Case-insensitive regex over loaf script sourceURL/functionName or longtask container name/src. Use to blame a library/iframe." }
  },
  "additionalProperties": false
}
```

**Return shape (abridged):**

```json
{
  "url": "https://app.uniswap.org/swap", "capturedFromInjection": true,
  "fps": { "visible": true, "sampleMs": 1000, "frames": 118, "avgFps": 118.0, "minFps": 41.7,
    "medianFrameMs": 8.33, "p95FrameMs": 14.2, "longestFrameMs": 24.0, "droppedFrames": 3, "inferredRefreshHz": 120,
    "note": "rAF cadence while our sample loop ran. Drops track main-thread congestion (see loaf/longtask), NOT GPU load." },
  "loaf": { "supported": true, "totalObserved": 7, "returned": 1, "events": [
    { "ts": 1737045000123, "durationMs": 184, "blockingDurationMs": 121, "renderStartMs": 60, "styleAndLayoutMs": 18,
      "scripts": [ { "sourceURL": "https://app.uniswap.org/assets/index-abc.js", "functionName": "onSwapClick",
        "durationMs": 140, "invoker": "BUTTON#swap.onclick", "invokerType": "event-listener", "forcedStyleAndLayoutMs": 4 } ] } ] },
  "longtask": { "supported": true, "totalObserved": 12, "returned": 1, "events": [
    { "ts": 1737045000090, "startTimeMs": 3021.5, "durationMs": 92,
      "attribution": [ { "containerType": "iframe", "containerName": "walletconnect", "containerSrc": "https://verify.walletconnect.com" } ] } ] },
  "identity": {
    "webgl": { "available": true, "context": "webgl2",
      "unmaskedVendor": "Google Inc. (Apple)",
      "unmaskedRenderer": "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
      "maskedVendor": "WebKit", "maskedRenderer": "WebKit WebGL", "hardwareAccelerated": true,
      "confidence": "may be masked/normalized/spoofed — treat as a hint" },
    "webgpu": { "available": true, "vendor": "apple", "architecture": "metal-3", "device": "", "description": "" }
  },
  "rendererJsHeapBytes": 48210000,
  "notAccessible": ["gpuUtilizationPct","vramTotalBytes","vramUsedBytes","gpuTempC","gpuClockMhz","gpuPowerW","perFrameGpuTimeMs"],
  "limitations": [ "GPU utilization/VRAM/temp/clocks are OS/driver-level, unreachable from any web API.",
                   "FPS requires a foreground tab.", "loaf/longtask captured from injection onward." ]
}
```

Rendered as indented text.

**What it cannot do:**

- **Report GPU utilization %, VRAM total/used, temperature, clock, or power** — impossible from a sandboxed page; these live at the OS/driver level. The `notAccessible` list states so rather than fabricating numbers. **This is the headline honest limitation.**
- **Measure GPU load via FPS.** rAF measures frame-*delivery* cadence. On a non-animating page, our sample loop is the only frame driver, so a healthy reading mostly proves "the compositor hits vsync while the main thread is free"; dropped frames correlate with **main-thread congestion** (see `loaf`/`longtask`), not GPU saturation. FPS also needs a foreground tab (hidden → `visible:false`), and Chrome caps rAF at the display refresh, so `avgFps` can't exceed `inferredRefreshHz` (no headroom measurement).
- **Recover pre-injection jank fully.** LoAF/longtask observers install a beat after document_start; `buffered:true` replays only entries still in the finite timeline buffer — earlier jank is unrecoverable without the debugger.
- **Give authoritative GPU identity.** `WEBGL_debug_renderer_info` may be null (privacy hardening) *or* a non-null masked/normalized/spoofed string; `navigator.gpu` is undefined on non-secure origins and its `device`/`description` are usually blank by design. Treat unavailable/null **and** masked strings as low-confidence.
- **Per-draw GPU timing** — `EXT_disjoint_timer_query_webgl2` is present in Chrome but reduced/quantized precision (Spectre mitigation) with the absolute `TIMESTAMP_EXT` path disabled (0 counter bits); unavailable in Safari, restricted in Firefox. Listed under `notAccessible`; the design does not depend on it.
- **Get LoAF on older/other engines** — LoAF is Chromium 123+; `supported:false` there (longtask remains as fallback); the Firefox build gets neither.
- **Reset on SPA/bfcache** — buffers are per-document (persist across `pushState`; use `since` to scope); reset only when a navigation recreates the document — **not** on bfcache restore (non-deterministic from the page). In-memory only; a hard reload wipes history.
- **Treat `rendererJsHeapBytes` as GPU memory** — it's the renderer JS heap (Chromium-only, quantized), weak "why is this page heavy" context, omitted where unavailable.

## 4. Implementation notes (shared)

**Common main-world observability module.** `bex_network`, `bex_vitals`, and `bex_gpu` all install their collectors inside `injected.ts`'s IIFE, as **sibling listener branches** modeled on `consoleCapture.ts:118-126` (MAIN listens for `keepkey-content` requests, replies `keepkey-injected`, `requestId`-correlated, `event.source===window` gated). They must **not** hang off the wallet `WALLET_REQUEST` handler — `isValidWalletMessage` silently drops any non-`WALLET_REQUEST`/`INJECTION_VERIFY` type. Each op adds: (a) a collector installed near the top of the IIFE (the fetch/XHR patch must be the *first* statement to minimize the pre-injection gap; observers register right after, all with `buffered:true`); (b) a `case` in `agentDom.ts` `handle()` that `await`s the round trip (`handle()` is `async`, the listener returns `true` to keep the channel open, `.catch(sendResponse)` guarantees it never dangles) with a ~2 s content-side timeout → clean `collector_unavailable`; (c) a `BROWSER_TOOLS` entry + `executeBrowserTool` case calling `dom(tabId, op, args)`, rendered as indented text (not raw JSON) to save tokens.

**Buffered vs on-demand split.**
- **Buffered** (`bex_network`, `bex_vitals`, `bex_gpu`): a page-side ring buffer accumulates from injection onward; the op reads + filters it. These carry the "captures from injection onward" blind spot and benefit from `since` scoping.
- **On-demand** (`bex_storage`, `bex_memory`): live point-reads with **no** injection-time blind spot (storage/heap are current state, not an event stream), but also **no history** — call before/after a flow to diff. `bex_storage` runs entirely in the ISOLATED content script (no MAIN world, no bridge); `bex_memory` reads MAIN-world `performance.memory` via the bridge with an `isolated_fallback` path.

**Memory bounding.** Every buffer mirrors `providerLog.ts`: ~500 entries max, ~2000 chars/entry (URLs, esp. `data:`/`blob:`, clipped), oldest evicted with a `bufferFull` flag surfaced in `summary`. `bex_network` additionally mirrors Resource Timing entries out of the browser's ~250-cap timeline (with `clearResourceTimings()`) so its cap doesn't silently drop later loads. `bex_vitals`/`bex_gpu` retain only the top ~10 interactions / ~50 jank events, keeping them tiny.

**Safe serialization.** Reuse `providerLog`'s `clip()` (try/catch `JSON.stringify` → `[unserializable]` on failure) so serialization **never throws** on circular refs / `BigInt`. Caveat for `bex_storage`: IndexedDB structured-clone values containing `BigInt`/circular/`Blob` collapse **wholesale** to `[unserializable]`; only always-string local/session values are lossless. Prefer a structure-preserving `WeakSet` + bigint replacer (like `consoleCapture.render()`) where per-field fidelity matters.

**Per-tab / navigation-reset behavior.** Buffers are **per-document/per-frame closure state** in the injected IIFE (not per-tab). They start empty whenever a navigation **recreates the document** (initial load, reload, cross-document nav): the old MAIN world is torn down (buffers GC'd) and the document_start content script re-injects into a fresh window whose missing `keepkeyInjectionState` means the version guard doesn't short-circuit. They **persist** across same-document SPA transitions (`pushState`/`replaceState`/hashchange) — the window survives and the content script doesn't re-fire — which is desirable for whole-session history but means "reset on navigation" almost never fires on SPA dApps; use `since` to scope to one action. **bfcache restores also preserve the buffers** (the document is frozen/resumed, not recreated, and the version guard blocks re-init) — so "reset on navigation" holds only for navigations that actually recreate the document, and bfcache eligibility is non-deterministic from the page's view. Top-frame only throughout (no `all_frames`): iframes and workers are never covered.

## 5. Appendix — Not accessible from a sandboxed page

An agent must **not** expect any of the following from these tools (no permission level short of `chrome.debugger`/native reaches them, and the team refuses the debugger):

- **GPU utilization %, VRAM total/used, GPU temperature, clock, power draw, per-draw GPU time** — no web API exposes them; they are OS/driver-level. `WEBGL_debug_renderer_info` / WebGPU `adapter.info` give only a (often masked) **identity** string, never load. (A rough total-VRAM *ceiling* is inferable via allocation-until-failure probing, but no tool here does that, and live usage stays unreachable.)
- **Real per-process CPU %** — not exposed. *One honest nuance:* Chrome's **Compute Pressure API** (`PressureObserver`, Chrome 125+, secure-context, MAIN-world reachable, feature-detectable via `'PressureObserver' in window`) gives a **coarse categorical** CPU-pressure state (`nominal`/`fair`/`serious`/`critical`), **not** a numeric percentage. So "no CPU API at all" is false, but a precise CPU % is not obtainable. (Not currently wired into these five; a candidate future addition to `bex_vitals`/`bex_gpu`.)
- **Cross-process / total-tab / native memory (RSS)** — `performance.memory` is Chrome-only, coarse/quantized, **renderer JS-heap only**; `measureUserAgentSpecificMemory()` needs `crossOriginIsolated` (absent on ~every dApp); `navigator.deviceMemory` is device-RAM *capacity* (fuzzed `{0.25…8}` GiB), not usage. Detached-DOM-node leaks are unobservable.
- **Network beyond `fetch`/XHR + Resource Timing** — no request/response **bodies or arbitrary headers** ever; **no HTTP status/method/timing for cross-origin** resources lacking `Timing-Allow-Origin` (the common RPC/quote case: interceptor gives status+method+total-duration, Resource Timing's phase breakdown and sizes read back **zero**); no coverage of `<img>`/`<link>`/`<script>`/CSS/`sendBeacon`/`WebSocket`/`EventSource` payloads; failure *reason* (DNS vs refused vs CORS) is indistinguishable.
- **Pre-injection events** — anything fired before the async `injected.js` executes (early page `fetch`/XHR, first paints/tasks, console output before the collector) is unrecoverable; `buffered:true` recovers only what's still in the finite per-type timeline buffer.
- **HttpOnly cookies & cookie attributes** — invisible to `document.cookie`; the session/auth cookies that matter most for connection debugging are typically HttpOnly.
- **Cross-origin / cross-frame anything** — iframe storage/network/vitals, cross-origin `contentWindow` (SOP `SecurityError`), and partitioned storage from third-party frames are out of scope (top-frame origin only).
- **Exact sub-millisecond timing** — Spectre-clamped to ~100 µs (finer only under cross-origin isolation), and `timeOrigin + startTime` drifts from wall-clock on long-lived pages.

Where a signal is genuinely unavailable, the tools return an explicit marker (`notAccessible`, `crossOriginOpaque:true`, `precise:false`, `supported:false`, `unavailable_requires_coi`, `collector_unavailable`, `no_content_script`) rather than a fabricated number.
