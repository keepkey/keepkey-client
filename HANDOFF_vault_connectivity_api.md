# HANDOFF → vault: REST contract changes for "always-on" connectivity

**From:** keepkey-client (BEX) — branch `feat/connection-hardening`
**To:** keepkey-vault (v11, `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`)
**Companion to:** `HANDOFF_vault_pairing_persistence.md` (the internal storage/eviction
fixes). This doc specifies the **exact REST contract** the BEX wants so the
extension can stay connected without re-prompting.

> Absolute paths throughout (multi-repo stack). Endpoints are on the local vault
> REST server, base `http://localhost:1646`. Handlers live in
> `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts`
> and `…/src/bun/auth.ts`.

---

## What the BEX now does (so you know what the contract has to support)

As of this PR the BEX no longer blindly calls the SDK's auto-pair. On every init it:

1. `GET /api/health` (no auth), up to 3 retries → if it never 200s, the BEX stays
   **view-only from cache** and retries on its 5 s poll. **No pairing.**
2. If it has a saved key: `GET /auth/pair` with `Authorization: Bearer <key>`, up to
   3 retries.
   - `200 { paired: true }` → **valid**, reuse the key, never prompt.
   - `401` / `403` / `200 { paired: false }` → **invalid**, drop the key and pair once.
   - network error / 5xx on all retries → **inconclusive** → treat as unreachable
     (view-only + retry), **never** prompt.
3. Only when it has no key, or the key was explicitly rejected, does it `POST
   /auth/pair`. All init is single-flighted, so the BEX issues **at most one**
   `POST /auth/pair` at a time.

So the BEX already depends on two contract guarantees you must keep stable:
**(A)** `GET /auth/pair` is a cheap, side-effect-free validity check, and **(B)** a
`401`/`403`/`{paired:false}` means "this key is dead," not "transient." Both hold in
the current handler (`rest-api.ts` L1429–1444) — please don't regress them.

---

## Request 1 — Idempotent `POST /auth/pair` (return existing key, no prompt)

**Today:** every approved `POST /auth/pair` mints a new UUID + new paired-app row
(`auth.ts` `approvePairing` L81–92). Re-pairing the same app always prompts and always
creates a duplicate.

**Wanted:** if the request's identity already has a **live** pairing, return that
key immediately with **no device prompt**.

**Request body (extended):**
```jsonc
{
  "name":     "KeepKey Browser Extension",
  "url":      "",
  "imageUrl": "https://pioneers.dev/coins/keepkey.png",
  "clientId": "bex-3f9c…"   // NEW, optional — stable per-install id (see Request 3)
}
```

**Response — identity already paired (no prompt):**
```jsonc
HTTP 200
{ "apiKey": "<existing-key>", "reused": true }
```

**Response — new identity (prompt as today):**
```jsonc
HTTP 200
{ "apiKey": "<new-key>", "reused": false }   // after device approval
```

Identity match precedence: `clientId` if present, else `(name, url, imageUrl)`.
"Live" = present in the key store and not expired. This single change removes the
bulk of the re-approval pain.

---

## Request 2 — Coalesce concurrent pair requests (kill the 429 dead-end)

**Today:** a second in-flight `POST /auth/pair` throws `429 "A pairing request is
already pending"` (`auth.ts` `requestPair` L63–64). The SDK surfaces this as a fatal
`SdkError` — historically the BEX's most common pairing failure.

The BEX's single-flight makes self-collision rare, but a stale pending request from a
previous service-worker generation (MV3 recycles the worker aggressively) can still
collide. Desired behavior, in order of preference:

- **Preferred — coalesce same identity:** if a pending request exists for the **same
  identity**, attach the new caller to the **same** pending promise and resolve both
  with the same key on approval. No 429.
- **Acceptable — make 429 pollable:** keep the 429 but make it explicitly retryable:
  ```jsonc
  HTTP 409            // not 429 — 429 reads as rate-limit
  Retry-After: 2
  { "error": "pairing_pending", "pending": true }
  ```
  The BEX will then poll `GET /auth/pair` until `{paired:true}` (the other request's
  approval lands) instead of erroring out.

Either removes the "press refresh to escape a wedged pairing" loop.

---

## Request 3 — Accept a stable `clientId` for identity

`name`/`url`/`imageUrl` are weak identity (any app can claim them, and the BEX sends
`url: ""`). A stable per-install `clientId` lets the vault dedup reliably and lets you
build a trustworthy paired-apps list.

- The BEX will generate a UUID once, persist it in `chrome.storage.local`, and send it
  as `clientId` on every `POST /auth/pair`.
- Vault keys idempotency (Request 1) and the `paired_apps` row on `clientId` when
  present. Suggest adding a nullable `client_id TEXT` column to `paired_apps`
  (`src/bun/db.ts` L113–120) — backward compatible; legacy rows just have `NULL`.

> The BEX side of this is a ~5-line change we'll ship once the vault accepts the field;
> it's listed here so the contract is agreed first. Until then, dedup on
> `(name, url, imageUrl)`.

---

## Request 4 (optional) — explicit unpair + duplicate cleanup

For a clean "disconnect and re-pair" and to drain the existing duplicates:

- `DELETE /auth/pair` with `Authorization: Bearer <key>` → revokes the caller's own
  key (`auth.revoke`, already exists internally at `auth.ts` L110–114; just needs a
  route). Lets the BEX's "Reset" flow revoke server-side instead of orphaning the key.
- A one-time dedup on vault load (collapse same-identity rows, keep newest) so the 5
  current "KeepKey Browser Extension" rows become 1. (Covered in the persistence
  handoff; mirrored here because it's observable via `GET /auth/paired-apps`.)

---

## Contract summary (what the BEX will call)

| Endpoint | Auth | BEX use | Required guarantee |
|---|---|---|---|
| `GET /api/health` | none | liveness, retried | 200 when up; cheap |
| `GET /auth/pair` | Bearer | **validate saved key** before any pairing | `200 {paired:true}` valid · `401/403/{paired:false}` dead · side-effect-free |
| `POST /auth/pair` | none (+ identity body) | pair **only** when no/dead key | **idempotent** (Req 1) · **coalesced** (Req 2) · `{apiKey, reused}` |
| `DELETE /auth/pair` *(new, optional)* | Bearer | clean reset | revoke caller's key |

Land **Request 1** and **Request 2** and the user-visible re-approval / "press
refresh" churn is gone end-to-end (BEX hardening from this PR + these two contract
changes). Requests 3–4 are durability/cleanup follow-ups.
