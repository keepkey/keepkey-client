# HANDOFF → vault: activity txid intake + history endpoints

**From:** keepkey-client (BEX)
**To:** keepkey-vault (v11, `projects/keepkey-vault`)
**Why:** The BEX broadcasts many transactions itself (EVM sends, dApp/DeFi
`eth_sendTransaction` / `eth_sendRawTransaction`, and UTXO/Cosmos/XRP/TON/Solana/Tron
broadcasts via Pioneer/RPC). Those txids never reach vault's SQL DB, so vault's
activity history is incomplete and the BEX has no backend to read a unified history
from. Swaps are the exception — they go through `/api/v2/swap/execute`, so vault
already broadcasts + tracks them.

This asks vault for **two** things: (1) an **intake** endpoint so the BEX can hand
off txids it broadcasts, and (2) a **verbose, filterable history** read endpoint
(swaps already have `GET /api/v1/swaps`; this is the general-activity equivalent).

---

## 1. Txid intake — `POST /api/v2/activity/intake`

The BEX already calls this (best-effort, fire-and-forget; a 404 is a silent no-op
until you deploy it). See `chrome-extension/src/background/activityReport.ts` and the
EVM chokepoint in `chains/ethereumHandler.ts` (`broadcastTransaction`).

**Auth:** `Authorization: Bearer <apiKey>` (same paired-vault key as the swap REST).

**Request body** (`ActivityReport`):
```jsonc
{
  "txid":      "0x8bdf…",            // required — broadcast tx id / hash
  "networkId": "eip155:1",            // required — CAIP-2; vault resolves the chain
  "caip":      "eip155:1/slip44:60",  // optional — CAIP-19 asset (native or token)
  "address":   "0x…",                 // optional — sender (the wallet that broadcast)
  "type":      "evm",                 // optional — 'send'|'evm'|'defi'|'approve'|'contract'
  "amount":    "0.25",                // optional — human-readable amount when known
  "contract":  "0x…",                 // optional — token contract for ERC-20/SPL/TRC-20
  "label":     "app.uniswap.org"      // optional — dApp origin / method, for display
}
```

**CRITICAL — verify before persist.** The BEX is an untrusted reporter. Vault MUST
**verify the txid on-chain** (exists / matches the claimed network + sender) before
writing it to the DB. Never persist an unverified, BEX-asserted record. Reject or
quarantine anything that doesn't confirm on-chain. The BEX never asserts success —
it only says "this txid was broadcast on this network."

**Behavior:**
- **Idempotent** on `(txid, deviceId, walletId)` — the BEX may report the same txid
  more than once (retries, reload). Upsert, don't duplicate.
- Scope to the connected **device + wallet** (same `getWalletDbScope()` the swap
  tracker uses). For **passphrase/hidden wallets**, do NOT persist (privacy) — return
  `202`/`204` and drop, matching the swap-history behavior.
- Kick off async on-chain verification + enrichment (symbol/amount/USD via Pioneer)
  so the history rows are display-ready.

**Response:** `200/202 { ok: true, status: "pending_verification" | "recorded" }`.
The BEX ignores the body; only non-2xx matters (and even that is non-fatal).

---

## 2. Activity history — `GET /api/v1/activity`

A verbose, filterable read of the unified activity DB (sends + swaps + defi). Swaps
already have `GET /api/v1/swaps`; this is the superset the BEX history UI will read.

**Auth:** Bearer, device+wallet scoped, empty for passphrase wallets (mirror
`GET /api/v1/swaps`).

**Query params (all optional):**
| param | example | notes |
|---|---|---|
| `type` | `swap` \| `send` \| `defi` \| `all` | **must support filtering to `swap`** |
| `networkId` | `eip155:1` | CAIP-2 chain filter |
| `caip` | `eip155:1/slip44:60` | asset filter |
| `status` | `pending` \| `confirmed` \| `failed` | on-chain confirmation state |
| `address` | `0x…` | sender/recipient |
| `fromDate` / `toDate` | unix ms | range |
| `limit` / `offset` | `50` / `0` | pagination |

**Response:** `{ entries: ActivityRecord[], count }` where each record is verbose
enough to render a row without extra lookups:
```jsonc
{
  "txid": "0x…", "networkId": "eip155:1", "caip": "eip155:1/slip44:60",
  "type": "swap", "status": "confirmed",
  "symbol": "ETH", "amount": "0.25", "valueUsd": "910.12",
  "fromAddress": "0x…", "toAddress": "0x…",
  "direction": "out", "label": "app.uniswap.org",
  "blockHeight": 19_000_000, "confirmations": 12,
  "createdAt": 1718800000000, "confirmedAt": 1718800120000,
  // when type === 'swap', also surface the swap_history join:
  "swap": { "fromSymbol": "BTC", "toSymbol": "ETH", "swapper": "THORChain",
            "receivedOutput": "…", "outboundTxid": "…" }
}
```

So a single `GET /api/v1/activity?type=swap` returns swap rows, and the unfiltered
call returns everything — that's the contract the BEX history view wants.

---

## What the BEX already implements (our side)

- **Swap history** — already wired to the existing `GET /api/v1/swaps`
  (`swapHandler.ts` `history` action → `swapApi.fetchSwapHistory` → `SwapHistory.tsx`).
  No vault change needed for swaps; §2 is for general activity.
- **Txid intake calls** — `activityReport.reportActivityToVault()` is live and wired
  at the EVM broadcast chokepoint (`ethereumHandler.broadcastTransaction`), covering
  `eth_sendTransaction` + `eth_sendRawTransaction` (the DeFi blind spot). It POSTs to
  `/api/v2/activity/intake` and no-ops on 404, so it's safe to ship before vault.
- **Remaining BEX wiring (incremental):** the same one-line `reportActivityToVault(...)`
  can be added at each non-EVM broadcast site once intake is live —
  `bitcoinHandler.ts:~149`, `litecoin/doge/dash/bitcoinCash`, `solanaHandler.ts:~911`,
  `tronHandler.ts:~1156`, `cosmos/osmosis/thorchain/maya`, `ripple`, `ton` (each right
  after it sends `transaction_complete`). We'll land those as a follow-up.

## Open questions for vault

1. Endpoint paths OK as named (`/api/v2/activity/intake`, `/api/v1/activity`), or do
   you prefer to fold intake into the existing swap/tracker module?
2. Is the on-chain verification path you use for the swap tracker reusable for
   arbitrary sends, or does it need a generic per-chain confirm helper?
3. Do you want the BEX to also report **send amount/caip** (we have them at most
   broadcast sites) so you can skip a Pioneer enrichment round-trip?
