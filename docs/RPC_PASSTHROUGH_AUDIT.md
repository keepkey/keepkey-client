# RPC passthrough audit — JSON-RPC contract for the dApp handoff

**Status:** Three handler fixes applied on branch `fix/eth-swap-dropped-tx`, this doc vendored for further auditing of the read-side RPC handlers.

## Why this matters

When a dApp calls `eth_sendTransaction`, three things have to be true for the swap UX to actually finish:

1. We sign the right thing.
2. The signed bytes broadcast to a network the dApp's polling can see.
3. **When the dApp polls back through us — `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber` — we hand back the JSON-RPC response shape it parses against, byte-identical to what a non-wrapped public RPC would return.**

Item 3 is the part this audit is about. If we return *almost* the right shape but with the field names ethers picked instead of the field names the spec defines, the dApp can't reconcile the response with what it expects, and its UI gets stuck. This is a silent failure: nothing throws, nothing logs an error, the dApp just spins forever on "Confirm in wallet."

## The smell

Every RPC handler that lived as `await provider.<wrapperMethod>(...)` returns an **ethers v6 class instance** instead of the raw JSON-RPC response. The two are not the same shape.

After ethers wraps the response, we send it over `chrome.runtime.sendMessage` to the side-panel / content script / dApp. `chrome.runtime.sendMessage` uses the structured-clone algorithm under the hood, which:

- **Strips the prototype** (so `instanceof TransactionResponse` would fail on the receiver, but more importantly, all class methods like `wait()`, `replaceableTransaction()`, getters, etc. disappear).
- **Drops anything non-cloneable** (functions, symbols, etc.).
- **Keeps the renamed/dropped fields exactly as ethers shaped them** — it doesn't re-translate them back to the JSON-RPC names.

The dApp then receives an object whose surface area looks superficially like a tx response but whose field names are wrong. Most dApps short-circuit on a missing required field and treat the whole thing as `null` / "not found yet."

## Field-name divergence

### `eth_getTransactionByHash` — JSON-RPC vs ethers `TransactionResponse`

| JSON-RPC spec field | ethers v6 field | Notes |
|---|---|---|
| `hash` | `hash` | ✓ |
| `blockHash` | `blockHash` | ✓ |
| `blockNumber` | `blockNumber` | ✓ |
| `transactionIndex` | `index` | **renamed** |
| `from` | `from` | ✓ |
| `to` | `to` | ✓ |
| `value` | `value` (BigInt) | type drift after clone |
| `gas` | `gasLimit` | **renamed** |
| `gasPrice` | `gasPrice` | ✓ |
| `maxFeePerGas` | `maxFeePerGas` | ✓ |
| `maxPriorityFeePerGas` | `maxPriorityFeePerGas` | ✓ |
| `input` | `data` | **renamed** |
| `nonce` | `nonce` | ✓ |
| `v` / `r` / `s` (flat) | `signature.{v, r, s}` | **nested** |
| `type` | `type` | ✓ |
| `accessList` | `accessList` | ✓ |
| `chainId` | `chainId` (BigInt) | type drift after clone |

The breaking renames are `gas`/`gasLimit`, `input`/`data`, `transactionIndex`/`index`, and the flat-vs-nested signature.

### `eth_getTransactionReceipt` — JSON-RPC vs ethers `TransactionReceipt`

| JSON-RPC spec field | ethers v6 field | Notes |
|---|---|---|
| `transactionHash` | `hash` | **renamed** |
| `transactionIndex` | `index` | **renamed** |
| `blockHash` | `blockHash` | ✓ |
| `blockNumber` | `blockNumber` | ✓ |
| `from` | `from` | ✓ |
| `to` | `to` | ✓ |
| `cumulativeGasUsed` | `cumulativeGasUsed` | ✓ |
| `gasUsed` | `gasUsed` | ✓ |
| `effectiveGasPrice` | `gasPrice` | **renamed** |
| `contractAddress` | `contractAddress` | ✓ |
| `logs[]` | `logs[]` (`Log` class instances, recursively wrapped) | shape drift |
| `logsBloom` | `logsBloom` | ✓ |
| `status` | `status` | ✓ |
| `type` | `type` | ✓ |
| `root` (post-Byzantium absent) | (n/a) | ✓ |

`Log` instances inside `logs[]` have their own shape drift — `transactionHash` vs `hash` and `transactionIndex` vs `index` again, plus `topics[]` typed as `ReadonlyArray<string>` (a class) rather than a plain array.

### `eth_getBlockByNumber` — JSON-RPC vs ethers `Block`

ethers' `Block` keeps the common fields but drops a long tail the spec considers required for a complete block response:

- Dropped: `sha3Uncles`, `logsBloom`, `transactionsRoot`, `stateRoot`, `receiptsRoot`, `difficulty`, `totalDifficulty`, `size`, `uncles`, `mixHash`, `nonce` (block nonce, not tx nonce).
- Renamed: none material.

dApps that only read `number`, `timestamp`, `baseFeePerGas` are unaffected; anything that touches `size`, `uncles`, or the merkle roots breaks.

## Why the existing `eth_call` handler already does it right

`chrome-extension/src/background/chains/ethereumHandler.ts` line 241–249 already uses the right pattern:

```ts
const handleEthCall = async params => {
  // ethers v6 provider.call(tx) ignores extra args, dropping blockTag AND
  // stateOverride. Uniswap's pre-quote simulation uses stateOverride to
  // model the not-yet-broadcasted Permit2 approval; if we drop it the
  // simulation reverts and the quote is rejected (/v1/swap returns 404).
  // Passthrough raw RPC so the dApp's params arrive byte-identical.
  const provider = await getProvider();
  return provider.send('eth_call', params);
};
```

Same root cause (ethers wrapper drops information vs raw passthrough), opposite direction (params-side rather than response-side). The audit just extends that pattern to the read-side handlers it never reached.

## What this PR changes

Three one-line fixes in `chrome-extension/src/background/chains/ethereumHandler.ts`:

| Line(s) | Handler | Before | After |
|---|---|---|---|
| 194–203 | `handleEthGetBlockByNumber` | `provider.getBlock(params[0])` | `provider.send('eth_getBlockByNumber', params)` |
| 223–231 | `handleEthGetTransactionReceipt` | `provider.getTransactionReceipt(params[0])` | `provider.send('eth_getTransactionReceipt', params)` |
| 233–246 | `handleEthGetTransactionByHash` | `provider.getTransaction(params[0])` | `provider.send('eth_getTransactionByHash', params)` |

Each comes with an inline comment pointing back to this doc so the next reader doesn't have to re-derive the reasoning.

## Handlers audited and left alone

These already produce a JSON-RPC-compatible primitive (hex string or boolean) and do not need a passthrough.

| Handler | Returns | Verdict |
|---|---|---|
| `handleEthChainId` | hex string | ✓ no change |
| `handleNetVersion` | string | ✓ no change |
| `handleEthBlockNumber` | hex string | ✓ no change |
| `handleEthGetBalance` | hex string | ✓ no change |
| `handleEthCall` | already passthrough | ✓ no change |
| `handleEthMaxPriorityFeePerGas` | hex string | ✓ no change |
| `handleEthMaxFeePerGas` | hex string | ✓ no change |
| `handleEthEstimateGas` | hex string | ✓ no change |
| `handleEthGasPrice` | hex string | ✓ no change |
| `handleEthFeeHistory` | already passthrough | ✓ no change |
| `handleEthGetCode` | hex string | ✓ no change |
| `handleEthGetStorageAt` | hex string | ✓ no change |
| `handleEthGetTransactionCount` | hex string (we re-encode) | ✓ no change, optional cleanup |
| `handleEthSendRawTransaction` | hash string | ✓ no change |
| `handleWeb3ClientVersion` | uses `provider.send(...)` | ✓ already passthrough |

Optional cleanup: `handleEthGetTransactionCount` could become a passthrough too. Today it does `'0x' + transactionCount.toString(16)` over a number returned by ethers, which yields the same hex string the spec wants. Functionally equivalent; passthrough is just one fewer place where ethers and the spec could drift.

## Audit candidates outside `ethereumHandler.ts`

A reviewer should also sweep these for the same smell:

| Handler / call site | Concern |
|---|---|
| `chrome-extension/src/background/chains/{cosmos,maya,osmosis,thorchain,...}Handler.ts` | These already use Pioneer (`fetch('https://api.keepkey.info/api/v1/...')`) so the response shape is whatever Pioneer returns, not an ethers wrapper. Lower risk, but worth confirming Pioneer's shape matches what each chain's dApp ecosystem expects. |
| Side-panel approval UI fields | `transaction.unsignedTx.data` is the right path (verified in this PR for `RequestMethodCard.tsx`). Worth checking other approval-UI consumers for the same `transaction.request.data` mistake (`transaction.request` is the raw params *array*, not an object). |
| `handleEthSendRawTransaction` | Returns `txResponse.hash` from ethers' `broadcastTransaction(...)`. This is fine because ethers v6 verifies `tx.hash === rpcReturnedHash` internally and throws BAD_DATA on mismatch — see https://github.com/ethers-io/ethers.js/blob/v6/src.ts/providers/abstract-provider.ts. So we can rely on the hash being authoritative. |
| Subscription / event-emitter handlers | We don't currently expose `eth_subscribe` / `eth_unsubscribe`. If a future change adds them, the same passthrough rule applies — ethers' event objects are not the JSON-RPC subscription payload shape. |

## How to verify locally

1. Reload the extension at `chrome://extensions` after `pnpm build`.
2. Open Uniswap on ETH mainnet, swap a small amount.
3. After signing, in the dApp's console (filter by `[HANDOFF]`), look for:
   ```
   [HANDOFF] dApp ← KeepKey (ethereum/eth_getTransactionByHash) RESOLVE
     params=["0x..."]
     type=object value={ blockHash: ..., blockNumber: ..., transactionIndex: ..., gas: ..., input: ..., v: ..., r: ..., s: ... }
   ```
   The `value` object should have `gas` (not `gasLimit`), `input` (not `data`), `transactionIndex` (not `index`), and flat `v/r/s`.
4. The Uniswap UI should advance from "Confirm in wallet" to a "Pending" state with the txid linked.

If the value still has `gasLimit`/`data`/`index`, the build didn't reload — repeat step 1.

## What this PR does *not* fix

- The "tx drops from mempool" issue is a separate problem with low-tip / private-mempool routing. See `RETRO_uniswap_swap_dropped_tx.md` and `project_evm_rpc_not_via_pioneer.md` (memory). The passthrough fix here is independent — the dApp handoff will work correctly once the tx is in a mempool the RPC can see.
- The vault firmware nonce display. Out of this repo.
- The hardcoded RPC URL bootstrap (`chains.ts` + `index.ts:665`). Tracked separately as a Pioneer-migration workstream.
