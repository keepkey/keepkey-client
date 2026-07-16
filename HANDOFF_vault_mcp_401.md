# HANDOFF → vault: `/mcp` cannot return its 401 (throws uncaught instead)

**From:** keepkey-client MCP agent bridge work, 2026-07-15 (PR #109 review → #110).
**For:** whoever owns `keepkey-vault`. This is a vault-side change; the client
side needs nothing.

**Repo:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11`
**File:** `projects/keepkey-vault/src/bun/rest-api.ts`
(the vault repo is `github.com/keepkey/keepkey-vault`; `src/bun` lives under
`projects/keepkey-vault/` in the v11 checkout — a known foot-gun)

> A branch with this change already exists: **`fix/mcp-401-uncaught`**, pushed,
> open as **keepkey-vault PR #361**. Merge it, cherry-pick it, or re-implement
> from the diff below and close it — whatever suits. **Note: that branch is
> currently checked out in the local v11 working tree**, so a rebuild from that
> tree right now includes this fix. `git checkout develop` there to get back to
> a clean baseline (the running vault was rebuilt at least once mid-session, so
> its current binary already contains the fix).

---

## The bug

`auth.requireAuth()` signals failure by **throwing** `HttpError` (`auth.ts:314-320`).

The `/mcp` routing block sits at `rest-api.ts:~1267-1310` — **before** the
`try` at `:1420` whose catch translates `HttpError` into its status
(`:4110-4114`). `Bun.serve` has no top-level `error` handler either (verified:
the options object carries only `port`, `maxRequestBodySize`, `fetch`, and now
`websocket`).

So a missing or invalid bearer key on `POST /mcp` escapes `fetch()` uncaught.
The agent gets a dropped socket (`fetch failed` / `UND_ERR_SOCKET`) instead of
the intended 401 — an inscrutable failure for the exact case that is most
likely to happen: a misconfigured `claude mcp add`.

**Scope — only `/mcp` is affected:**

| Call site | Line | Status |
|---|---|---|
| `/mcp` POST | `:1305` | **broken** — outside the try |
| `/bex-bridge` | `:1278` | fine — uses `auth.validate()` (returns `null`), returns its 401 cleanly |
| everything else | `:1480`, `:1489`, … | fine — inside the try |

## The fix

Catch locally in the `/mcp` POST branch. Auth behavior is unchanged; only the
failure *response* is. Deliberately does **not** route through the `json()`
helper, to preserve `/mcp`'s no-CORS-grant posture.

```ts
if (method === 'POST') {
  // requireAuth signals failure by THROWING HttpError, and this whole
  // /mcp block runs before the try/catch further down that turns an
  // HttpError into its status — Bun.serve has no top-level `error`
  // handler either, so an uncaught throw escapes fetch() and the agent
  // gets a dropped socket ("fetch failed") instead of 401. Catch here.
  try {
    auth.requireAuth(req)
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Unauthorized' }),
      { status: typeof err?.status === 'number' ? err.status : 401,
        headers: { 'Content-Type': 'application/json' } })
  }
  return handleMcpRequest(req, {})
}
```

## Verification already done (on that branch's build)

```
POST /mcp      bad bearer  → 401 {"error":"Invalid or expired API key — re-pair via POST /auth/pair"}   (no CORS headers)
POST /eth/sign bad bearer  → 401 same body, WITH Access-Control-Allow-Origin: *                          (the :1420 catch)
POST /mcp      + Origin    → 403 {"error":"/mcp is not reachable from a browser"}
GET  /docs                 → 200
```

The differing CORS headers are the discriminator proving the 401 comes from
this fix's path rather than the general catch.

`bun test src/bun/mcp.test.ts` → 16 pass. Type errors unchanged at 638 (the
pre-existing `develop` baseline; the fix adds none).

## Caveat worth knowing

I never observed the **pre-fix** symptom on a healthy vault. The dropped-socket
reading that first raised this was taken while the vault was flapping
(the process holding `:1646` kept dying mid-request; `/docs` returned 200 once,
then 000), so it is **not** valid evidence. The bug is established by source
reading — throw site outside the catch, no `error` handler — not by a live
before/after. If you want the runtime proof, test a bad bearer against a
`develop` build with no other changes.

## Gap this points at

`rest-api.ts`'s routing has **no test harness** — `src/bun/mcp.test.ts` unit-tests
`handleMcpRequest` directly, which is exactly why an auth bug in the *routing*
slipped through. Standing one up for a single branch of a ~145-branch if/else
chain is out of proportion, but the routing layer being untested is worth a
ticket of its own.
