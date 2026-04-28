# Handoff — vault-side EVM transaction tracker

**Status:** Vault changes required to unblock the BEX pending-tx visibility feature (ShieldBadge pip + dropdown + rebroadcast/cancel).
**Owner needed:** vault-v11 maintainer (work happens in `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11`).
**Captured:** 2026-04-29
**Companion BEX work:** branch `feat/pending-tx-visibility` in keepkey-client (waits on these vault APIs).

---

## Why vault, not BEX

The BEX is a thin client. The vault is the only piece that:
- Holds the signed bytes after the device signs (so it's the only place that can persist raw hex for re-broadcast)
- Already has SQLite (`bun:sqlite`, `vault.db` in user-data dir)
- Already has the polling-and-push pattern in `swap-tracker.ts`
- Survives BEX reload, browser profile changes, and multiple paired apps

Putting tx history in BEX storage would duplicate state that vault already owns and would fragment per-paired-app instead of per-device.

---

## What already exists (don't reinvent)

**Storage**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/db.ts:122-135` — `api_log` table stores **request_body and response_body verbatim**, including the full `serialized` hex and r/s/v of every successful `/eth/sign-transaction`. Source comment at `rest-api.ts:1053-1066` is explicit: "Both the signing inputs … AND the signing outputs … are preserved verbatim — without the raw signed hex, the log is useless for re-broadcast or any post-hoc replay/regression workflow." **Re-broadcast is already possible from this data; no new raw-hex column needed.**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/db.ts:186-217` — `swap_history` table is the structural precedent for per-tx mutable status (id, txid, status, timestamps, error). Same shape we want for plain ETH txs.

**Polling + push pattern**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/swap-tracker.ts:68-141` — `initSwapTracker(messageSender)` rehydrates active entries from SQLite on startup, keeps an in-memory `Map`, polls remote status periodically, pushes updates via the `messageSender` RPC channel. **Exact pattern to mirror for plain ETH-tx tracking.**

**RPC primitives (no new networking needed)**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/evm-rpc.ts:6` — `EVM_RPC_URLS` table per-chain, keyed by decimal chainId string.
- Same file: `broadcastEvmTx`, `waitForTxReceipt`, `getEvmNonce`, `getEvmGasPrice` — all the RPC verbs the tracker needs.

**Read endpoint**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts:2523` — `GET /api/v1/activity` already filters by `route`, `txid`, `chain`, `activityType`, `since`, `until`. **BEX can use this to read raw hex per txid without any new endpoint.**

**KNOWN BUG (orthogonal but blocking):** the running vault binary (1.2.16) returns `responseBody.serialized = "[trimmed]"` for `/eth/sign-transaction` activity entries. Current source does NOT trim — the running build is older. **Action: rebuild + reinstall vault** before the BEX can see raw hex via `/api/v1/activity`. No source code change needed.

---

## Proposed design — full scope

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  VAULT (vault-v11)                                               │
│                                                                  │
│  ┌─ db.ts ─────────────────────────────────────────────────────┐ │
│  │  EXISTING (unchanged):                                       │ │
│  │    api_log — full raw hex stored verbatim                    │ │
│  │    swap_history — per-tx mutable status (model)              │ │
│  │  NEW:                                                        │ │
│  │    eth_tx_status table — mutable polling state by txid       │ │
│  │      (status, attempts, broadcastAtMs, lastCheckMs,          │ │
│  │       terminalAtMs, errorReason, networkId)                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ eth-tx-tracker.ts (NEW, mirror of swap-tracker.ts) ────────┐ │
│  │  initEthTxTracker(messageSender)                             │ │
│  │  trackEthTx({ txid, networkId, raw, broadcastAtMs })         │ │
│  │  Per-tx poll loop (60s):                                     │ │
│  │    - eth_getTransactionReceipt → confirmed | failed          │ │
│  │    - else eth_getTransactionByHash → still pending|dropped   │ │
│  │  Drop heuristic: pending=latest && tx not findable for 2 min │ │
│  │  Push updates via messageSender('eth-tx-update', payload)    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ rest-api.ts (extend) ──────────────────────────────────────┐ │
│  │  After successful /eth/sign-transaction — call               │ │
│  │  trackEthTx() with txid (from r/s/v + tx fields) + raw hex   │ │
│  │                                                              │ │
│  │  NEW endpoints (all auth-required):                          │ │
│  │    GET  /api/v1/eth/pending                                  │ │
│  │    GET  /api/v1/eth/tx/:txid                                 │ │
│  │    POST /api/v1/eth/tx/:txid/rebroadcast                     │ │
│  │    POST /api/v1/eth/tx/:txid/speed-up                        │ │
│  │    POST /api/v1/eth/tx/:txid/cancel                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ keepkey-vault-sdk (extend) ────────────────────────────────┐ │
│  │  NEW SDK methods on the eth namespace:                       │ │
│  │    eth.getPendingTxs() → PendingEthTx[]                      │ │
│  │    eth.getTxStatus(txid) → EthTxStatus                       │ │
│  │    eth.rebroadcastTx(txid) → { txid }                        │ │
│  │    eth.speedUpTx(txid, opts?) → { newTxid }                  │ │
│  │    eth.cancelTx(txid, opts?) → { cancelTxid }                │ │
│  │  Bump SDK to v3.x.0 (additive minor)                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP
                              │
┌──────────────────────────────────────────────────────────────────┐
│  BEX (this repo) — companion work, separate PR                   │
│                                                                  │
│  - usePendingTxs() hook polls vault SDK every 60s                │
│  - ShieldBadge pip + click dropdown                              │
│  - Rebroadcast / Speed-up / Cancel buttons → SDK calls           │
│  - NO BEX-side persistence                                       │
└──────────────────────────────────────────────────────────────────┘
```

### Vocabulary (use consistently)

- **networkId** — CAIP-2 string `eip155:1`, `eip155:137`, etc. Used in REST APIs, SDK signatures, BEX state. Match existing vault convention.
- **chainId** — decimal number (1, 137). Internal-only, used for `EVM_RPC_URLS` lookups and tx-encoding. Don't surface in APIs.
- **txid** — 0x-prefixed 32-byte tx hash, lowercase. Primary key everywhere.
- **PendingEthTx status enum** — `'broadcast' | 'pending' | 'confirmed' | 'failed' | 'dropped'`
  - `broadcast` → just submitted, no chain confirmation yet
  - `pending` → seen in mempool but not mined
  - `confirmed` → mined with N+ confirmations (N=1 for v1)
  - `failed` → mined but receipt.status === 0 (revert)
  - `dropped` → not in mempool AND `pending == latest` for >2 min after broadcast

---

## Vault-side change list

All paths absolute; line refs against current `develop` of vault-v11.

### 1. Schema — new table `eth_tx_status`

**File:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/db.ts`
**Where:** alongside `swap_history` definition at `db.ts:186`.

```sql
CREATE TABLE IF NOT EXISTS eth_tx_status (
  txid             TEXT PRIMARY KEY,         -- 0x-prefixed lowercase
  network_id       TEXT NOT NULL,            -- 'eip155:1'
  chain_id         INTEGER NOT NULL,         -- 1 (denormalized for RPC lookup)
  from_address     TEXT NOT NULL,            -- lowercase
  to_address       TEXT NOT NULL,            -- lowercase
  value_wei        TEXT NOT NULL DEFAULT '0',
  nonce            INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'broadcast',
  attempts         INTEGER NOT NULL DEFAULT 0,
  confirmations    INTEGER NOT NULL DEFAULT 0,
  block_number     INTEGER,
  gas_used         TEXT,
  effective_gas_price TEXT,
  error_reason     TEXT,
  broadcast_at_ms  INTEGER NOT NULL,
  last_check_ms    INTEGER NOT NULL,
  terminal_at_ms   INTEGER,
  origin           TEXT,                     -- dApp URL if known
  app_name         TEXT,                     -- paired-app name from auth
  label            TEXT                      -- optional human label
);
CREATE INDEX IF NOT EXISTS idx_eth_tx_status_open ON eth_tx_status(status, broadcast_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_eth_tx_status_from ON eth_tx_status(from_address, broadcast_at_ms DESC);
```

Add bumps to `SCHEMA_VERSION` at `db.ts:13`.

**Why a separate table** — `api_log` is append-only audit. Mutating it for status would muddle that contract and break log-prune semantics (`MAX_API_LOG_ROWS = 5000`). The new table holds *only* mutable polling state; raw hex is fetched from `api_log` via JOIN-on-txid when needed.

**Helper exports in db.ts** (mirror swap_history shape):
- `insertEthTxStatus(record)`
- `updateEthTxStatus(txid, patch)`
- `getEthTxStatus(txid) → EthTxStatusRow | null`
- `getOpenEthTxStatuses() → EthTxStatusRow[]` (status not in confirmed/failed/dropped)
- `getEthTxStatusesByAddress(addr, limit)`
- `getEthRawTxByTxid(txid) → string | null` (joins eth_tx_status to api_log on txid)

### 2. New module — `eth-tx-tracker.ts`

**Path:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/eth-tx-tracker.ts` (new file, ~250 LoC).

Mirror `swap-tracker.ts` exactly:

```ts
const TAG = '[eth-tx-tracker]'

let sendMessage: ((msg: string, data: any) => void) | null = null
const tracked = new Map<string, EthTxState>()
let pollHandle: ReturnType<typeof setInterval> | null = null
const POLL_INTERVAL_MS = 60_000
const DROP_AFTER_MS = 2 * 60 * 1000   // 2 min of pending==latest → dropped
const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000 // 24h after terminal, evict from map

export function isEthTrackerInitialized(): boolean { return sendMessage !== null }

export async function initEthTxTracker(messageSender: (msg: string, data: any) => void) {
  sendMessage = messageSender
  // Rehydrate from SQLite (status not in {confirmed, failed, dropped})
  const open = getOpenEthTxStatuses()
  for (const r of open) {
    if (tracked.has(r.txid)) continue
    tracked.set(r.txid, rowToState(r))
  }
  if (tracked.size > 0) startPolling()
}

export function trackEthTx(args: {
  txid: string; networkId: string; chainId: number;
  from: string; to: string; valueWei: string; nonce: number;
  origin?: string; appName?: string;
}) { /* insert row + add to map + ensure poll loop running */ }

function startPolling() {
  if (pollHandle) return
  pollHandle = setInterval(() => { void pollOnce() }, POLL_INTERVAL_MS)
  void pollOnce() // fire immediately
}

async function pollOnce() {
  for (const state of [...tracked.values()]) {
    if (isTerminal(state.status)) {
      if (Date.now() - (state.terminalAtMs ?? 0) > TERMINAL_TTL_MS) tracked.delete(state.txid)
      continue
    }
    await checkOne(state)
  }
  if (tracked.size === 0 && pollHandle) { clearInterval(pollHandle); pollHandle = null }
}

async function checkOne(state: EthTxState) {
  const rpcUrl = EVM_RPC_URLS[String(state.chainId)]
  if (!rpcUrl) return // unknown chain; user supplied custom — TODO use customEvmNetworks lookup
  // Try receipt first (fast-path mined detection)
  const receipt = await ethRpc(rpcUrl, 'eth_getTransactionReceipt', [state.txid]).catch(() => null)
  if (receipt) {
    const status = receipt.status === '0x1' ? 'confirmed' : 'failed'
    transition(state, { status, blockNumber: parseInt(receipt.blockNumber, 16),
      gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
      errorReason: status === 'failed' ? 'execution reverted' : undefined })
    return
  }
  // No receipt — check mempool presence
  const tx = await ethRpc(rpcUrl, 'eth_getTransactionByHash', [state.txid]).catch(() => null)
  if (tx) {
    transition(state, { status: 'pending', attempts: state.attempts + 1 })
    return
  }
  // Neither — could be pre-broadcast, dropped, or RPC lag
  const sinceBroadcast = Date.now() - state.broadcastAtMs
  if (sinceBroadcast > DROP_AFTER_MS) {
    const pendingNonce = await getEvmNonce(rpcUrl, state.from).catch(() => null)
    if (pendingNonce !== null && pendingNonce > state.nonce) {
      // Account moved past this nonce (something else got mined) → dropped
      transition(state, { status: 'dropped', errorReason: 'evicted from mempool' })
      return
    }
  }
  transition(state, { attempts: state.attempts + 1 })
}

function transition(state: EthTxState, patch: Partial<EthTxState>) {
  const next = { ...state, ...patch, lastCheckMs: Date.now() }
  if (isTerminal(next.status) && !next.terminalAtMs) next.terminalAtMs = Date.now()
  tracked.set(state.txid, next)
  updateEthTxStatus(state.txid, next)
  if (sendMessage) sendMessage('eth-tx-update', stateToWire(next))
}

export function getOpenEthTxs(): EthTxState[] {
  return [...tracked.values()].filter(s => !isTerminal(s.status))
}
```

**Wire-up in vault entrypoint** — `src/bun/index.ts` (or wherever `initSwapTracker` is called):
```ts
await initEthTxTracker((msg, data) => rpc.send[msg](data))
```

### 3. REST endpoints (extend `rest-api.ts`)

**File:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts`
**Where:** add a section near the existing `/eth/*` block at `rest-api.ts:1704`.

#### 3a. Auto-track on signing

In the existing `if (path === '/eth/sign-transaction' && method === 'POST')` block (`rest-api.ts:1704`), after the successful `wallet.ethSignTx(msg)` call (around `rest-api.ts:1775`), compute the txid and call:

```ts
import { trackEthTx } from './eth-tx-tracker'
import { computeTxidFromSerialized } from './evm-rpc' // small helper to add: keccak256 of serialized

// after const result = await emuWrap(...)
try {
  const txid = computeTxidFromSerialized(result.serialized)
  trackEthTx({
    txid,
    networkId: `eip155:${chainId}`,
    chainId,
    from: body.from?.toLowerCase() ?? '',
    to: body.to.toLowerCase(),
    valueWei: body.value || '0x0',
    nonce: parseInt(String(body.nonce ?? '0x0').replace(/^0x/, ''), 16),
    origin: req.headers.get('referer') || undefined,
    appName: resolveAppInfo().appName,
  })
} catch (e) {
  console.warn('[REST] failed to register tx with tracker:', e)
}
```

The actual broadcast still happens in the BEX (we sign, BEX broadcasts via its own RPC). So the tracker is "registered at sign" but the txid is mined-or-not via vault's own RPC polling — works because the txid is deterministic from the signed bytes.

#### 3b. New endpoints

```
GET  /api/v1/eth/pending
  → 200 { txs: PendingEthTx[] }
  Returns getOpenEthTxs(). Auth required. Hidden during passphrase sessions
  (mirror /api/v1/activity privacy gate at rest-api.ts:2525).

GET  /api/v1/eth/tx/:txid
  → 200 PendingEthTx (terminal or open)
  → 404 if unknown
  Joins eth_tx_status + raw hex from api_log.

POST /api/v1/eth/tx/:txid/rebroadcast
  Body: {} (no params; uses cached raw hex)
  → 200 { txid, broadcastAtMs }
  → 404 if no raw hex available
  → 502 if RPC rejects
  Re-broadcasts the SAME bytes via EVM_RPC_URLS[chainId]. Idempotent on chain.
  Resets attempts counter and lastCheckMs. Does NOT change status.

POST /api/v1/eth/tx/:txid/speed-up
  Body: { maxFeePerGas?: string; maxPriorityFeePerGas?: string }
       (if absent, derive from currentBaseFee*2 + currentTip*1.5)
  → 200 { newTxid }
  → 409 if original is already terminal
  Builds a NEW signed tx with same {to, value, data, nonce} and bumped fees.
  Goes through /eth/sign-transaction internally → device confirmation REQUIRED.
  On success, marks original as 'dropped' (it'll be replaced by the new one).

POST /api/v1/eth/tx/:txid/cancel
  Body: {} (or optional priorityBumpPct)
  → 200 { cancelTxid }
  → 409 if original is already terminal
  Builds a 0-value self-tx at same nonce + currentMaxFee*1.3 (or +30%).
  Device confirmation REQUIRED. Marks original as 'dropped' on success.
```

Add to `SIGNING_ROUTES` set at `rest-api.ts:914` if you want signing-approval UI to fire for speed-up / cancel (recommended — they re-prompt the device, user should confirm).

#### 3c. Schemas

**File:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/schemas.ts`

```ts
export const EthTxStatusEnum = z.enum(['broadcast', 'pending', 'confirmed', 'failed', 'dropped'])

export const PendingEthTxResponse = z.object({
  txid: z.string(),
  networkId: z.string(),
  chainId: z.number().int(),
  from: z.string(),
  to: z.string(),
  valueWei: z.string(),
  nonce: z.number().int(),
  status: EthTxStatusEnum,
  attempts: z.number().int(),
  confirmations: z.number().int(),
  blockNumber: z.number().int().nullable(),
  errorReason: z.string().nullable(),
  broadcastAtMs: z.number().int(),
  lastCheckMs: z.number().int(),
  terminalAtMs: z.number().int().nullable(),
  origin: z.string().optional(),
  appName: z.string().optional(),
  label: z.string().optional(),
})

export const EthSpeedUpRequest = z.object({
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional(),
}).strip()

export const EthCancelRequest = z.object({
  priorityBumpPct: z.number().int().min(10).max(500).optional(),
}).strip()
```

Add response schemas for swagger generation.

### 4. SDK additions (`keepkey-vault-sdk`)

**File:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/index.ts`

Add to the `eth` namespace (around `index.ts:570`):

```ts
eth: {
  // ... existing methods ...
  /** List in-flight ETH txs (status not in confirmed/failed/dropped). */
  getPendingTxs: (): Promise<{ txs: PendingEthTx[] }> =>
    this.client.get('/api/v1/eth/pending'),
  /** Get a single ETH tx by txid. */
  getTxStatus: (txid: string): Promise<PendingEthTx> =>
    this.client.get(`/api/v1/eth/tx/${txid}`),
  /** Re-broadcast the same signed bytes. No device interaction. */
  rebroadcastTx: (txid: string): Promise<{ txid: string; broadcastAtMs: number }> =>
    this.client.post(`/api/v1/eth/tx/${txid}/rebroadcast`, {}),
  /** Sign a new tx at the same nonce with bumped fees. Requires device confirmation. */
  speedUpTx: (txid: string, opts?: SpeedUpParams): Promise<{ newTxid: string }> =>
    this.client.post(`/api/v1/eth/tx/${txid}/speed-up`, opts ?? {}),
  /** Sign a 0-value self-tx at same nonce with bumped fees. Requires device confirmation. */
  cancelTx: (txid: string, opts?: CancelParams): Promise<{ cancelTxid: string }> =>
    this.client.post(`/api/v1/eth/tx/${txid}/cancel`, opts ?? {}),
},
```

Plus types in `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/types.ts`:
- `PendingEthTx`, `PendingEthTxStatus`, `SpeedUpParams`, `CancelParams`.

Bump SDK version to next minor (additive, no breaking changes).

### 5. RPC push channel

`swap-tracker.ts` already pushes `'swap-update'` events via `messageSender(msg, data)`. Mirror with `'eth-tx-update'`. The BEX subscribes via the existing chrome message infrastructure that already routes vault RPC events to the side panel.

Confirm the vault entrypoint registers the new event name in its RPC schema (same place `swap-update` is declared — likely `src/bun/index.ts` near `initSwapTracker`).

---

## Cancel-tx + speed-up — detail

**Cancel** = construct an EIP-1559 tx with:
- `to = from` (self-transfer)
- `value = 0`
- `data = '0x'`
- `nonce = original.nonce`
- `maxFeePerGas = max(original.maxFeePerGas * 1.3, currentBaseFee * 2)`
- `maxPriorityFeePerGas = original.maxPriorityFeePerGas * 1.3`

Send through `wallet.ethSignTx(...)` (device confirms). On success, broadcast via `EVM_RPC_URLS[chainId]`. Mark original tx as `dropped` with `errorReason = 'cancelled by user'`.

**Speed-up** = same `{to, value, data, nonce}` as the original, just bumped fees. Same device-confirm flow.

Both need access to the original tx's structured fields. **Source the original from `api_log.request_body`** (the `/eth/sign-transaction` call's request payload has `to`, `value`, `data`, `nonce`, `maxFeePerGas`, etc.). Add a small helper:

```ts
function getOriginalEthTxFromAuditLog(txid: string): EthSignTxRequest | null {
  // join via eth_tx_status.txid → api_log row → JSON.parse(request_body)
}
```

If `api_log` was pruned (>5000 rows), we may not have the original. In that case return `409 'original tx fields no longer available'` and surface that to the BEX (the user can still use rebroadcast, which only needs the raw hex).

---

## Test plan (vault-side)

`/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/` is the controlled test environment.

New file: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/eth-tx-tracker/lifecycle.js`

Cases:
1. **Sign + auto-register** — call `eth.ethSignTransaction(...)`, assert it appears in `eth.getPendingTxs()` within 1s.
2. **Confirmed transition** — submit a real low-value mainnet tx, wait, assert status flips to `'confirmed'` with `confirmations >= 1`.
3. **Failed transition** — submit a tx that reverts (e.g., transfer of ERC-20 you don't own), assert `status === 'failed'`.
4. **Dropped transition** — submit a tx with absurdly low fees, then a competing tx at same nonce + 30% bump, assert original transitions to `'dropped'`.
5. **Rebroadcast idempotency** — call `rebroadcastTx(txid)` twice, second call should return same hash without 502.
6. **Cancel** — call `cancelTx(txid)`, confirm on device (test fixture skips this), assert `cancelTxid` returned and original goes to `'dropped'`.
7. **Speed-up** — call `speedUpTx(txid)`, confirm on device, assert `newTxid` returned and is a different hash.

Plus a smoke test for `'eth-tx-update'` RPC events — subscribe, sign, expect at least one `pending` then one terminal event.

---

## Sequencing

1. **Vault PR #1 (~3-4h)**: schema + helpers + tracker + auto-register + GET endpoints. Ship these alone first; rebroadcast/speed-up/cancel come second since they're independent.
2. **Vault PR #2 (~2h)**: rebroadcast + speed-up + cancel endpoints + audit-log lookup helper.
3. **SDK release**: bump after PR #1 lands so the BEX can start consuming `getPendingTxs()` even while PR #2 is in review.
4. **BEX PR (`feat/pending-tx-visibility`)**: ShieldBadge pip + dropdown + buttons. Gated on SDK release.

---

## Decisions baked in (call out if you disagree)

- **Tracker is per-device, not per-paired-app.** All paired apps share visibility. Matches `swap-tracker` behavior. The tracker writes `app_name` to history so users can see which dApp originated each tx.
- **Polling lives in vault, not BEX.** BEX polls vault every 60s for state but vault is the only thing hitting RPC nodes for chain status. Single source of truth.
- **Re-broadcast does not bump fees.** Re-broadcast = same bytes again (e.g., your RPC dropped it but it's still valid). Speed-up = different bytes, new device confirmation. Different mental model, different endpoints.
- **Drop heuristic is `pending=latest && tx unfindable for 2 min`.** Conservative — RPC lag for 30-60s is normal. If you want faster drop detection, lower `DROP_AFTER_MS`.
- **Custom EVM networks (`customEvmNetworksStorage`) need RPC lookup hooked into the tracker** — `EVM_RPC_URLS` is static. TODO note in the tracker code; first PR can ignore custom networks (gracefully skip), follow-up extends.
- **Privacy: passphrase wallets get empty results** for `GET /api/v1/eth/pending` (mirror `/api/v1/activity` behavior at `rest-api.ts:2525`).

---

## File index (every path referenced in this doc, absolute)

**Vault — files to read:**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/db.ts` (api_log schema, swap_history schema, helper export pattern)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/swap-tracker.ts` (polling + push pattern, lines 60-141)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/evm-rpc.ts` (EVM_RPC_URLS, broadcastEvmTx, waitForTxReceipt, getEvmNonce)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts:1704` (existing /eth/sign-transaction handler — add register hook here)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts:2523` (existing /api/v1/activity — privacy gate to mirror)

**Vault — files to create:**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/eth-tx-tracker.ts` (new)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/eth-tx-tracker/lifecycle.js` (new)

**Vault — files to modify:**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/db.ts` (add eth_tx_status table + helpers)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts` (5 new endpoints + auto-register in /eth/sign-transaction)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/schemas.ts` (zod schemas for new endpoints)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/index.ts` (call initEthTxTracker on startup)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/index.ts` (5 new SDK methods on eth namespace)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/types.ts` (PendingEthTx, SpeedUpParams, CancelParams types)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/package.json` (version bump)

**BEX — companion (separate PR, this repo):**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/components/NetworkAccountHeader.tsx:340-348` (ShieldBadge — add pip + dropdown trigger here)
- New: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/components/PendingTxDropdown.tsx`
- New: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/hooks/usePendingTxs.ts`

**Memory references (for whoever picks this up):**
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_handoff_paths.md`
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_pr_to_develop.md`
