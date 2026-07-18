# HANDOFF → vault: `/addresses/hive` 500 `json is not defined` (firmware-gate crash)

**From:** keepkey-client (Hive dashboard debugging, 2026-07-17)
**Vault tree:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`
**File:** `src/bun/rest-api.ts` (one function)

## Symptom

Hive never appears in the client side-panel dashboard. Root cause traced to:

```
POST http://localhost:1646/addresses/hive  →  HTTP 500  {"error":"json is not defined"}
```

The client treats this as "no Hive account" and silently omits the row
(`chrome-extension/src/background/chains/hiveHandler.ts` → `getHivePublicKey()`
throws → `getHiveAccountInfo()` returns `{ok:false}` → `buildHiveUiRows()` → null).

## Root cause — a lexical-scope bug

`requireChainSupport()` is defined in the **outer** scope, *before* `Bun.serve`:

- `src/bun/rest-api.ts:1126` — `function requireChainSupport(chainId): Response | null { … return json({…}, 501) }`
- `src/bun/rest-api.ts:1141` — `const server = Bun.serve({`
- `src/bun/rest-api.ts:1150` — `async fetch(req, server) {`
- `src/bun/rest-api.ts:1184` — `const json = (…) => {…}`  ← **per-request helper, defined INSIDE `fetch`**

`requireChainSupport` closes over the scope where it was *defined* (outer), so the
per-request `json` (defined inside `fetch`) is **not in scope**. Its firmware-fail
branch `return json({ error: '… requires firmware ≥ …' }, 501)` throws
`ReferenceError: json is not defined`, which the outer catch turns into
`500 {"error":"json is not defined"}`.

## Why it surfaces as "Hive is broken" specifically

`requireChainSupport` only reaches the `json(…, 501)` line when the device firmware
is **below the chain's `minFirmware`**. It's called for several chains:

- `rest-api.ts:2062` solana, `:2083` tron, `:2104` ton — device firmware already
  meets their minimums → `return null` → never touches `json` → no crash (bug latent).
- `rest-api.ts:2128` / `:2152` hive — Hive needs **7.15.0**; this device is below it
  → hits the fail branch → **crash**.

So the crash doubly hides the truth: the device *does* need a firmware update for Hive,
but instead of the honest `501`, the client gets a `500` it can't interpret.

## Fix (pick one)

1. **Move `requireChainSupport` inside `fetch`** (below the `json` definition at :1184)
   so `json` is in lexical scope. Smallest change.
2. **Don't use the closure `json`** — have `requireChainSupport` `throw new HttpError(501, msg)`
   and let the existing HttpError handler (`rest-api.ts:~1308`) serialize it. Cleaner; keeps
   the helper where it is.

Either restores the intended behavior: a device below `minFirmware` gets a clean
`501 { error: "HIVE requires firmware ≥ 7.15.0 (device has X)" }` for **all** gated
chains (solana/tron/ton/hive), not a `json is not defined` 500.

## Note on the actual unblock

The bug fix alone won't make Hive appear — it just turns the crash into the honest 501.
**The device firmware must be ≥ 7.15.0** for Hive to work at all. After updating firmware,
`/addresses/hive` returns the pubkey; then a Hive account must exist for that key
(Pioneer `/api/v1/hive/account/{pubkey}` — `noAccount` means create one via Vault Hive onboarding).

## Verify

- Below-7.15 device: `POST /addresses/hive` → **501** (not 500), body names the required version.
- 7.15+ device with a Hive account: `POST /addresses/hive` → `{ address }`, and Hive shows in the client.

## Aside: running build lag

The live build (`_build/dev-macos-arm64/…/app/bun/index.js`, Jul 17) also 404s
`/system/info/get-features`, which the current source registers (`rest-api.ts:3006`) —
so the deployed bundle trails the source tree. Worth a clean rebuild alongside the fix.
