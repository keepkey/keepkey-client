# HANDOFF → vault: pairing dedup, eviction, TTL & timeout (the "re-approve every time" bug)

**From:** keepkey-client (BEX) — branch `feat/connection-hardening`
**To:** keepkey-vault (v11, `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`)
**Status of the client side:** the BEX-side connection hardening is done in this PR
(single-flight init, retry-aware key validation, no reflexive key wipe). It removes
the *client's* contribution to re-pairing. **The remaining re-approval churn is
vault-side and cannot be fixed from the client.** This doc proves it and prescribes
the fixes.

> All file paths are absolute because this stack spans repos. The running vault at
> the time of writing is the dev build of
> `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`
> (PID confirmed listening on `:1646`).

---

## TL;DR — four defects, in priority order

| # | Defect | File | Effect on user |
|---|--------|------|----------------|
| 1 | **Pairing is never deduplicated.** Every `POST /auth/pair` mints a brand-new UUID + new DB row for the *same* app identity. | `src/bun/auth.ts` `approvePairing()` L81–92, `pair()` L101–108; `src/bun/db.ts` `storePairing()` L898–908 | The paired-apps list grows without bound; a re-pair is always a *new* key, never a reuse. **Live proof:** `GET /auth/paired-apps` currently returns **5 identical "KeepKey Browser Extension" entries.** |
| 2 | **Eviction is FIFO, not LRU, and `validate()` never refreshes recency.** | `src/bun/auth.ts` `MAX_KEYS=20` L30, `evictIfFull()` L160–168, `validate()` L121–141 | Once 20 pairings accumulate, each new pair evicts the **oldest by insertion order** — which can be the key the BEX is actively using → forced re-pair. |
| 3 | **API-key TTL is measured from creation (`addedOn`) with no refresh-on-use; keys without `addedOn` are treated as expired.** `KEY_TTL_MS = 30 days`. | `src/bun/auth.ts` L32, L131–139 | An actively-used pairing hard-expires 30 days after it was *created*, regardless of use → periodic forced re-pair for daily users. |
| 4 | **Pending-pair timeout mismatch.** Vault auto-rejects the pending request after **60 s**; the SDK's `POST /auth/pair` waits **600 s**. | vault `src/bun/auth.ts` L68–73; SDK `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/client.ts` `SIGNING_TIMEOUT_MS=600_000` L4, used at L135 | If the user takes >60 s to approve, the vault rejects while the client is still waiting → the approval the user *did* perform is discarded and they're prompted again. |

Persistence itself is **not** broken: `paired_apps` is on-disk SQLite
(`src/bun/db.ts` L113–120, `vault.db` under `Utils.paths.userData`), it is **not**
dropped on `SCHEMA_VERSION` bumps (only `balances` / `pioneer_cache` are, L43–49),
and `AuthStore.reloadPairings()` reloads it at construction (L40–60). So the keys
survive a vault restart — the problem is purely **accumulation + eviction + TTL +
timeout**, not loss.

---

## Defect 1 — idempotent pairing (highest impact)

### Proof
`src/bun/auth.ts`:
```ts
approvePairing(): string | null {
  if (!this.pendingPair) return null
  this.evictIfFull()
  const apiKey = crypto.randomUUID()          // ← always a fresh key
  const { info, resolve } = this.pendingPair
  const enriched = { ...info, addedOn: Date.now() }
  this.keys.set(apiKey, { apiKey, info: enriched })
  storePairing(apiKey, { ... })               // ← always a new row
  ...
}
```
There is **no lookup by app identity** (`name` / `url` / `imageUrl`) anywhere before
minting. `src/bun/db.ts` `storePairing()` does `INSERT OR REPLACE … paired_apps`
keyed on `api_key` (the random UUID), so the upsert never collapses duplicates.

```
$ curl -s localhost:1646/auth/paired-apps | jq '.apps | length, (group_by(.name) | map({(.[0].name): length}))'
5
[ { "KeepKey Browser Extension": 5 } ]
```

### Fix
Make pairing **idempotent on a stable app identity**. When an approval comes in for
an identity that already has a live (non-expired) key, **reuse** that key instead of
minting a new one:

```ts
approvePairing(): string | null {
  if (!this.pendingPair) return null
  const { info, resolve } = this.pendingPair
  // Reuse an existing live pairing for the same identity (idempotent pairing).
  const existing = this.findLiveByIdentity(info)
  if (existing) {
    existing.info.addedOn = Date.now()          // refresh recency (see defect 3)
    storePairing(existing.apiKey, existing.info)
    this.pendingPair = null
    resolve(existing.apiKey)
    return existing.apiKey
  }
  // …otherwise mint as today…
}
```
Identity should be a stable tuple. `name` alone is weak (any app can claim
"KeepKey Browser Extension"). **Preferred:** have the client send a stable
`clientId` (see the companion API handoff `HANDOFF_vault_connectivity_api.md`) and
key identity on that. **Minimum:** `(name, url, imageUrl)`.

> Security note: idempotent reuse means "an app that was already approved doesn't
> re-prompt." That is the desired behavior and matches how every other wallet
> connector works. It does **not** weaken the initial approval gate — a *new*
> identity still requires device approval.

Also add a **dedup/migration sweep** on load so the existing 5+ duplicate rows
collapse to one per identity (keep the most-recent `addedOn`).

---

## Defect 2 — LRU eviction (not FIFO)

### Proof
`src/bun/auth.ts`:
```ts
private evictIfFull() {
  if (this.keys.size < MAX_KEYS) return
  // Map iterates in insertion order — first key is oldest
  const oldest = this.keys.keys().next().value   // ← FIFO, ignores last-use
  if (oldest) { this.keys.delete(oldest); removePairing(oldest) }
}
```
`validate()` (L121–141) returns the entry **without touching recency**, so "oldest
inserted" never reflects "least recently used."

### Fix
Track `lastUsedOn`, bump it in `validate()` on every successful auth, and evict the
entry with the smallest `lastUsedOn`. With defect 1 fixed the map won't fill from
duplicates, but LRU is still correct insurance against evicting a hot key.

---

## Defect 3 — TTL should refresh on use

### Proof
`src/bun/auth.ts` `validate()`:
```ts
const addedOn = found.info.addedOn
if (!addedOn || Date.now() - addedOn > KEY_TTL_MS) {   // 30 days from CREATION
  this.keys.delete(apiKey); removePairing(apiKey); return null
}
```
No write-back of a "last seen" timestamp → a key used every day still dies 30 days
after it was first created.

### Fix
On successful `validate()`, set `lastUsedOn = Date.now()` and measure the TTL window
against `lastUsedOn` (sliding expiry), persisting the bump. A key in active daily use
then effectively never expires; an abandoned key still ages out in 30 days. (Throttle
the persist to e.g. once/hour/key to avoid a DB write per request.)

---

## Defect 4 — align the pending-pair timeout

### Proof
vault `src/bun/auth.ts` `requestPair()`:
```ts
if (this.pendingPair) throw new HttpError(429, 'A pairing request is already pending')
return new Promise((resolve, reject) => {
  this.pendingPair = { info, resolve, reject }
  setTimeout(() => {                       // ← 60 s
    if (this.pendingPair?.info === info) { this.pendingPair = null; reject(new Error('Pairing request timed out')) }
  }, 60000)
})
```
SDK `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/client.ts`:
`SIGNING_TIMEOUT_MS = 600_000` (L4), and `pair()` issues the POST with
`signal: this.signal(this.signingTimeoutMs)` (L135). The published SDK the BEX ships
(`…/keepkey-client/node_modules/keepkey-vault-sdk/lib/client.js`) is identical: 600 s.

### Fix
Raise the vault's pending-pair auto-reject to **match the SDK's 600 s** (or make it
configurable and ≥ the SDK timeout). A user who walks over to the device and approves
at 90 s should succeed, not be silently rejected and re-prompted.

---

## Suggested order of work
1. **Defect 1** (idempotent pairing + collapse existing duplicates) — eliminates the
   bulk of "approve a new key every time."
2. **Defect 4** (timeout alignment) — quick, removes the slow-approval failure.
3. **Defects 2 + 3** (LRU + sliding TTL) — durability for long-lived installs.

## How to verify the fix
- Pair the BEX once, approve. `GET /auth/paired-apps` → exactly **one** entry.
- Restart the vault. BEX reconnects with **no** prompt (key still valid).
- Re-trigger pairing from the BEX (e.g. reload the extension) → **no new entry**,
  **no prompt** (idempotent reuse), same key returned.
- Approve a fresh pairing after 90 s → succeeds (timeout aligned).

See the companion **`HANDOFF_vault_connectivity_api.md`** for the exact REST contract
changes (idempotent pair response, concurrent-pair coalescing, the `clientId` field).
