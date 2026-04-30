# Retro — Uniswap swap signs OK, broadcasts, then drops from mempool

> **⚠ SUPERSEDED — root cause was misdiagnosed in this doc.** The actual bug is in EIP-1559 type-2 signing inside `keepkey-vault-sdk` / firmware: the signed envelope's signature does not recover to the device's address. The mempool drops the tx because the recovered "from" account has no balance. That's why etherscan showed wrong "from" addresses — not because of a Blink Protect relayer story I hallucinated.
>
> Read `RETRO_evm_tx_1559_signing_chain.md` and `HANDOFF_evm_tx_1559_signing_chain.md` instead. The fee-warning / drop-check / passthrough fixes captured below are still real cleanups, but they do not fix the swap UX — that requires fixing the upstream signing-chain bug.

**Status:** 🟡 Cleanups landed; root cause was wrong; see superseding retro.
**Captured:** 2026-04-28
**Branch in flight:** `docs/vault-eth-tx-tracker` (1 commit ahead of develop, docs only)
**Bundle under test:** `dist/` rebuilt 2026-04-28 15:42 — contains all of develop's ETH fixes plus the `09142ec` handoff doc
**Reference tx:** https://etherscan.io/tx/0xd5d733ff53d4222ae98a5382a794fac758bb9f251f3431dc05e1bae39547281e

---

## Symptom (observed today)

1. User on Uniswap mainnet, swap LINK → WETH, account `0x141D9959cAe3853b035000490C03991eB70Fc4aC`.
2. Permit2 typed-data step approved on device → succeeded.
3. `eth_sendTransaction` for Universal Router `execute(...)` approved on device → BEX returned hash `0xd5d733ff…81e` to the dApp:
   ```
   [HANDOFF] dApp ← KeepKey (ethereum/eth_sendTransaction) RESOLVE
     value=0xd5d733ff53d4222ae98a5382a794fac758bb9f251f3431dc05e1bae39547281e
   ```
4. Tx **briefly visible on etherscan**, then evicted.
5. Subsequent `eth_getTransactionByHash` calls (driven by Uniswap polling through our injected provider) all resolve to `null`:
   ```
   [HANDOFF] dApp ← KeepKey (ethereum/eth_getTransactionByHash) RESOLVE
     value=null
   ```
6. **Independent confirmation:** `curl -X POST https://ethereum.publicnode.com -d '{… eth_getTransactionByHash …}'` returned `{"result":null}` at retro time. Tx is no longer in any public node we hit.
7. Uniswap UI sticks on **"Confirm swap in wallet"** indefinitely — it never advances to a "pending tx" state because its receipt poll never returns a non-null tx.

This is the **same shape as the previous three stuck-pending swaps** the user reported earlier (`HANDOFF_fee_pipeline_audit.md` referenced "latest=pending=495, nothing in flight" — those three priors all dropped out the same way). So this is a recurring failure mode, not a one-off.

---

## Tx params actually broadcast (from the [HANDOFF] log)

```
chainId:               0x1
to:                    0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca   (Uniswap Universal Router)
value:                 0x0
gas:                   0x3583c                        =   219,708
maxFeePerGas:          0x7154e01e                     = 1.9015 gwei
maxPriorityFeePerGas:  0x2d5dab3a                     = 0.7607 gwei
data:                  0x3593564c…                    (execute() selector)
```

Live base fee at the time: **1.063 gwei**. So the tx was valid (`maxFee 1.9015 ≥ baseFee 1.063 + tip 0.7607`), but the effective tip miners would see is just **0.76 gwei** — well below current spot tip. **Cheap enough to be accepted by an entry node, then never propagated/included, then evicted.**

---

## What's actually working (confirmed)

- BEX nonce row renders correctly. Screenshot proof: "**Nonce 495 (next available). view on etherscan ↗**" at the top of the approval screen for `eth_sendTransaction`. So the user's claim "still do not see nonce in the bex" is observation error — it is rendering. (See `pages/side-panel/src/approval/evm/NonceInfoRow.tsx`, wired in via `1ad6eb1`.)
- BEX honors dApp-supplied `maxFeePerGas`/`maxPriorityFeePerGas` (commit `8d65cbf`).
- BEX broadcast path is firing — the `[HANDOFF] BEX → RPC (broadcast)` log exists in the bundle (verified with `grep` against `dist/background.iife.js`), tx hash matched what etherscan briefly showed, so signing + broadcast is working at the BEX layer.

## What is NOT working

### 1. Tx evicted from mempool, dApp polling never resolves
- See "Symptom" above. **This is the user-visible bug.**
- The fee-warning banner did NOT fire on this attempt because `maxFeePerGas` (1.90 gwei) passed our **base × 1.5** floor check (`1.063 × 1.5 ≈ 1.59`, and `1.90 > 1.59`). The check is too lenient — it ignores tip entirely, even though tip is what governs propagation/inclusion.
- User's framing: *"its using a blink protocol thing not generally broadcasted, easier to drop I think"* — i.e. they suspect Uniswap is using an MEV-protect / private RPC for either broadcast or polling. We don't currently know whose RPC the broadcast went through (we use whatever the BEX's chain config holds — likely a public one), but the **dApp's** receipt-poll goes through our injected provider, which goes through the BEX's RPC, which is the same one we broadcast on. So the routing isn't actually different at the dApp/BEX boundary; the question is whether *our* upstream RPC is private. Worth checking which URL `chainConfig.ts` resolves to for `eip155:1` and whether it's a propagation-poor endpoint.

### 2. Vault firmware does not show the nonce on-device
- User can see the nonce on the BEX side (Approval UI) but **cannot verify it on the device**. Screenshot of the firmware preview shows: `CHAINID / RECIPIENT / VALUE / DATA` but **no nonce field**. (This is what the user means when they say "still do not see nonce in the vault".)
- Signed nonce is a load-bearing field — the user is trusting the BEX UI alone. That violates the hardware-wallet trust boundary.
- This belongs to vault firmware (keepkey-vault-v11). Out of scope for this PR but blocks the "verify on device" UX.

### 3. EVM `eth_sendTransaction` is misclassified as "Simple transfer"
- Screenshot shows green-check **"Transaction — Simple transfer - no smart contract interaction"** for a tx whose `data` is `0x3593564c…` (Universal Router `execute()`). This is a contract call — should be the yellow **"Smart Contract — Interacts with smart contract — review carefully"** branch.
- Logic at `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/approval/evm/RequestMethodCard.tsx:76-77`:
  ```ts
  const hasSmartContractExecution =
    transaction.request?.data && transaction.request.data.length > 0 && transaction.request.data !== '0x';
  ```
- The check reads `transaction.request.data`, but the `Details` tab in the same UI is populating `DATA: 0x3593564c…` from somewhere else (presumably `transaction.params[0].data` or a normalized field). One side reads the dApp params; the other reads a missing/empty `request.data`. Either source-of-truth bug or shape change — needs one place that normalizes the tx and a single field both branches read.
- This is a **safety regression** — the UI is telling the user "no contract interaction" when there is one. Especially dangerous because the green-check / yellow-warning visual is the only quick safety cue.

---

## Hypotheses for the dropped-tx failure

| # | Hypothesis | Plausibility | How to test |
|---|---|---|---|
| 1 | Effective tip 0.76 gwei is below propagation threshold of the public RPC we broadcast through; tx briefly accepted at entry node, never gossiped to miners, evicted on next mempool sweep. | **High.** Matches "appeared on etherscan briefly then dropped" exactly. | Reproduce, then immediately query 3+ public RPCs (publicnode, llamarpc, ankr) for the hash. If all return null within ~30s, propagation never happened. |
| 2 | BEX's broadcast goes to one RPC, BEX's receipt-poll goes to a different one (different upstream cluster), and the receipt-poll RPC simply hasn't seen the hash. | Low — we use one provider object per chain, so URL should be identical. | Inspect `pages/side-panel/src/utils/getProvider.ts` (or wherever) and confirm broadcast + read share a single `JsonRpcProvider`. |
| 3 | Uniswap's Universal Router `execute()` payload includes a deadline that already expired by the time the tx was mineable, and the tx was rejected. | Medium. The `0x3593564c` payload contains a `deadline` field. With low tip + slow inclusion, expiry is plausible. | Decode the calldata against UR's ABI, check the `deadline` (third arg). Compare to broadcast time + mempool dwell time. |
| 4 | Uniswap-side / "blink" private mempool routing (user's hypothesis) — Uniswap is using its own RPC for some operation that competes with ours and the orchestration drops the tx. | Unconfirmed. The dApp logs in the trace all go through our injected provider; we don't see Uniswap making outbound RPC of its own to a private endpoint. | Capture network tab (not just console) during a swap. Look for outbound POSTs to anything other than `kkapi://` or our chosen RPC. |
| 5 | Underpriced eviction loop: the same nonce `495` was attempted multiple times in close succession, each replaced/dropped. The user's prior 3 stuck txs were probably at this same nonce. | High that this is the *user-visible pattern*, but the immediate cause is still tip economics (#1). | Track nonce + hash on each broadcast, log when a hash disappears from mempool. Builds on the vault-side tx tracker handoff. |

The conservative read: **#1 is the proximate cause, #3 may compound it**. We can ship a fix that helps both without picking a winner.

---

## Concrete next steps (in order)

### Quick win — tighten fee-warning to use *tip*, not just `maxFeePerGas`
- File: wherever the fee-warning predicate lives (search the develop merge `1ad6eb1` — likely `pages/side-panel/src/approval/evm/FeeWarning*.tsx` or a hook in `chrome-extension/src/background/chains/ethereum.ts`).
- Add: warn if `maxPriorityFeePerGas < 1 gwei` on mainnet (configurable per-chain in `chainConfig.ts`). The current `maxFee < 1.5 × baseFee` rule did NOT fire today because Uniswap padded `maxFeePerGas` to 1.9 gwei, but the priority tip was still 0.76 gwei.
- Bonus: surface the **effective miner tip** (`min(maxPriorityFeePerGas, maxFeePerGas - baseFee)`) in the Fees tab. Today the user sees raw maxFee/maxPriority numbers; an effective-tip summary makes underpriced txs obvious before signing.

### Quick win — fix the "Simple transfer" misclassification
- `pages/side-panel/src/approval/evm/RequestMethodCard.tsx:76-77` — replace `transaction.request?.data` with whatever path the `Details` tab uses to populate `DATA`. They have to share. Add a unit test that feeds a Universal Router payload and asserts `hasSmartContractExecution === true`.

### Diagnostic — figure out which RPC we're using for mainnet broadcast
- **Audited:** `chrome-extension/src/background/chains.ts` ships `https://ethereum-rpc.publicnode.com` as the bootstrap mainnet RPC. That's a reputable public endpoint, not an MEV-protect / "blink" private mempool.
- The "blink protocol" hypothesis is therefore unlikely to be the cause; the proximate failure is fee economics (low tip, weak propagation), not RPC routing.
- **Do NOT add a hardcoded fallback list.** RPC lists belong in Pioneer; the extension takes them at runtime. Hardcoding endpoints here forces an extension release on every operator change. Captured as a hard rule in `~/.claude/projects/.../memory/feedback_no_hardcoded_rpcs.md`. If propagation is still a concern, the right move is a Pioneer-side fan-out / multi-broadcast story.

### Verify-against-mempool after broadcast (BEX-side)
- After `provider.broadcastTransaction(...)` resolves with a hash, schedule one delayed (~5s) `eth_getTransactionByHash(hash)` against the same RPC. If null, surface a **"transaction was rejected by the network — fee likely too low"** error to the user instead of letting the dApp think the tx is in flight. Today we silently return a hash to the dApp and let it spin.
- Pairs naturally with the vault-side tx tracker (`HANDOFF_vault_eth_tx_tracker.md`): the BEX gets immediate post-broadcast status, the vault gets long-term tracking. Don't duplicate; the BEX-side check is purely a 5-second sanity check before the vault tracker takes over.

### Vault firmware — render `nonce` on the EVM signing screen
- Out of this repo. File against `keepkey-vault-v11` firmware. The on-device verification needs to show nonce or the hardware-wallet trust model is broken for any flow where the dApp/BEX could lie about the nonce.

---

## File index

- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/approval/evm/RequestMethodCard.tsx` — smart-contract detection bug at line 76-77
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/approval/evm/NonceInfoRow.tsx` — working BEX nonce display
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/index.ts` — broadcast handoff log site
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/HANDOFF_fee_pipeline_audit.md` — earlier audit, contains base-fee analysis
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/HANDOFF_vault_eth_tx_tracker.md` — companion vault-side tracker plan
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/HANDOFF_uniswap_swap_v2.md` — running notes
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_uniswap_swap_release_blocker.md` — prior retro (Permit2 verify mismatch saga)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/dist/background.iife.js` — built bundle, 510KB, contains [HANDOFF]/[DIAG]/fee-warning probes (verified by grep)

## Reference

- Failing tx (briefly mined-pending, then dropped): https://etherscan.io/tx/0xd5d733ff53d4222ae98a5382a794fac758bb9f251f3431dc05e1bae39547281e
- Account: https://etherscan.io/address/0x141d9959cae3853b035000490c03991eb70fc4ac
- Universal Router: `0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca`
