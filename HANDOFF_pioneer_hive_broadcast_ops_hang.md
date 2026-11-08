# HANDOFF — pioneer: `/api/v1/hive/broadcast-ops` hangs forever

**Status:** root cause identified in Pioneer source, not yet fixed. Blocks
**every** Hive broadcast from the browser extension — vote, post, custom_json,
transfer-via-ops, limit orders. Not specific to any operation type.

## Symptom

A Hive dApp action signs on the device, the vault returns the signature, and
then nothing comes back. The extension's dApp promise never settles; the
MV3 service worker is eventually evicted mid-wait, so the page hangs instead of
receiving an error. Background console after the fact:

```
Background loaded
| clearOrphanedApprovalEvents | dropping 1 orphaned pending event(s) (preserving 0 post-broadcast)
```

The dropped event is still at `status: 'request'` — it never reached
`broadcasted`, i.e. the broadcast call never returned.

## Reproduction (no browser, no device, no signature needed)

```bash
# Control — Pioneer is healthy
curl -s -m 15 -X POST https://api.keepkey.info/api/v1/market/info \
  -H 'Content-Type: application/json' -d '["hive:beeab0de/slip44:1275"]' \
  -w '\nHTTP %{http_code} time=%{time_total}\n'
# → {"data":[0.048],"success":true}   HTTP 200 time=3.1

# Validation path — fast
curl -s -m 15 -X POST https://api.keepkey.info/api/v1/hive/broadcast-ops \
  -H 'Content-Type: application/json' -d '{}' \
  -w '\nHTTP %{http_code} time=%{time_total}\n'
# → 400 with per-field errors,  time=0.30

# Complete body (signature intentionally invalid) — HANGS
curl -s -m 20 -X POST https://api.keepkey.info/api/v1/hive/broadcast-ops \
  -H 'Content-Type: application/json' \
  -d '{"ref_block_num":1,"ref_block_prefix":1,"expiration":"2026-07-20T20:00:00","operations":[["vote",{"voter":"keepkeytest","author":"a","permlink":"p","weight":1}]],"signature":"00"}' \
  -w '\nHTTP %{http_code} time=%{time_total}\n'
# → HTTP 000 time=20.006   (no response; same with limit_order_cancel)
```

Body validation returns in 300ms, so the request is accepted and then stalls in
the node-relay loop. An invalid signature should produce a fast node-side
`Assert Exception`, not silence — whatever node it picks is not answering.

## Root cause

`keepkey-stack/projects/pioneer/services/pioneer-server/src/controllers/hive.controller.ts`

The file already knows about this failure mode. Line 18-22:

```ts
const HIVE_NODES = ['https://api.hive.blog', 'https://anyx.io'];
// Per-node timeout so a single hanging node can't stall the whole request. Without it
// a dead node (e.g. anyx.io returning an HTML error page slowly) held /hive/account
// open ~30s before falling through. AbortSignal.timeout is a node 18+ builtin.
const HIVE_RPC_TIMEOUT_MS = Number(process.env.HIVE_RPC_TIMEOUT_MS ?? 5000);
```

But only **one** of the three `fetch(node, …)` call sites actually passes it:

| line | endpoint | `signal:` |
|---|---|---|
| 33 | shared account helper | ✅ `AbortSignal.timeout(HIVE_RPC_TIMEOUT_MS)` |
| 515 | `POST /hive/broadcast` | ❌ none |
| 597 | `POST /hive/broadcast-ops` | ❌ none |

Both broadcast paths `await fetch(node, …)` with no abort signal, inside a
sequential `for (const node of HIVE_NODES)` loop. One unresponsive node blocks
the loop forever, so the fallback to the second node never happens and the HTTP
request never completes. The fix that was applied to `/hive/account` was never
carried to the two broadcast endpoints.

## Fix

Add the signal to both call sites (lines 515 and 597). Use a **longer** budget
than the 5s account timeout: these call
`condenser_api.broadcast_transaction_synchronous`, which legitimately blocks
until the tx is included in a block (~3s block time, occasionally longer).
Something like `HIVE_BROADCAST_TIMEOUT_MS ?? 20000`; reusing the 5s value risks
aborting broadcasts that would have succeeded.

```ts
const res = await fetch(node, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction_synchronous', params: [tx], id: 1 }),
  signal: AbortSignal.timeout(HIVE_BROADCAST_TIMEOUT_MS),
});
```

The existing `catch (nodeErr)` already records `lastError` and continues to the
next node, so an abort degrades into the intended fallback with no other change.

### Retry-after-timeout is safe

Relaying the same signed tx to the second node after a timeout cannot
double-spend: the transaction is already signed and bound to a TaPoS header, so
a duplicate is rejected on-chain as a duplicate. Failing over is correct.

### Worth checking while in there

`broadcast_transaction_synchronous` waits for block inclusion. If the intent is
"relay and return", `broadcast_transaction` returns immediately and would make
the endpoint far less exposed to node latency — at the cost of not being able to
return `blockNum`/`trxNum`. The extension only needs `txid`
(`hiveHandler.ts:686` treats `blockNum` as optional, feeding a `confirmed`
boolean). That's a product call, not a bug.

## Client side (already understood, tracked separately)

`keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/hiveHandler.ts:668`
posts to this endpoint with `AbortSignal.timeout(30_000)` but **outside** any
try/catch — the sign call above it has one, the broadcast call does not. So even
once Pioneer is fixed, a slow broadcast surfaces a raw `AbortError` rather than a
clean JSON-RPC timeout. Client-side hardening is a separate PR and does not
substitute for the Pioneer fix: 30s of waiting is long enough for Chrome to evict
the service worker, which is what turns the error into a silent hang.

## Verification

After deploying, the third curl above must return within ~20s with
`{"success":false,"error":"…"}` (an on-chain assert about the bogus signature),
never HTTP 000. Then re-run a real Hive vote from the extension and confirm the
dApp promise settles.
