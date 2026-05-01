# Handoff — EIP-1559 signing-chain bug (read this from a cold start)

You are picking up a release-blocker bug in a new session. This document is self-contained: paths are absolute, commands are runnable, no prior conversation context required.

## The one-line problem

`sdk.eth.ethSignTransaction` in `keepkey-vault-sdk` returns serialized type-2 (EIP-1559) envelopes whose ECDSA signature **does not recover to the device's address**. Every EVM swap signed via the keepkey-client browser extension fails downstream because the network treats the tx as signed by a wrong account, drops it, and the dApp UI hangs.

EIP-712 typed-data signing (Permit2 etc.) through the same SDK works correctly. The bug is *specific to* EIP-1559 transaction signing.

## Read these first, in order

1. `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_evm_tx_1559_signing_chain.md` — the comprehensive retro. Read the whole thing once before touching code.
2. `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_eip712_diagnosis.md` — the durable rule that applies here: when recovered signer ≠ expected, instrument the signing chain. Don't blame derivation, don't blame the dApp, don't theorize about routing.
3. `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_no_hardcoded_rpcs.md` — do not patch this with hardcoded RPC URLs. RPCs come from Pioneer.

## Reproduce the failure (no device needed)

Pure offline run that exercises the captured fixture and prints which canonical pre-image it does *or doesn't* match:

```bash
cd /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk
node tests/evm-tx-1559/recover-fixture.js
```

Expected today: 1 of 3 sub-checks fails (`uniswap-link-to-usdt-1: serialized envelope recovers to WRONG signer`). The other two pass, ruling out simple v-parity inversion. No "diagnostic match" line prints — the bug isn't a standard variant.

## Reproduce live on a paired device

```bash
cd /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk
KEEPKEY_API_KEY=$(...your paired bearer token...) node tests/evm-tx-1559/sign-and-recover.js
```

If you're running on a dev device with a different seed than the fixture's `expectedSigner`, the test auto-falls back to comparing against the device's own ETH address — so the assertion `live-signed envelope recovers to expected signer` fires either way and reproduces the bug.

## Where to look (priority order)

Bug is somewhere in this slice. Source order is fastest-to-bisect first.

### 1. SDK `eth.ethSignTransaction`

```
/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/
```

Specifically grep for the EVM tx signing entry point. Add instrumentation to log:
- The exact JSON/bytes sent to firmware
- The exact response received (r, s, v, serialized)
- The hash of the SDK-constructed envelope
- The hash that, given the firmware's (r,s,v), would recover to the device's address (back-compute via `recoverPublicKey`)

The two hashes will differ. The diff names the bug.

### 2. Vault firmware EVM tx handler

```
/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/  (firmware repo, traverse to the Rust EthereumSignTx handler)
```

Same instrumentation: log the message hash the firmware computes right before signing.

### 3. Specific things to check (in order of likelihood)

- Does the SDK build the type-2 RLP **once** for both the firmware request and the returned envelope, or **twice** (with a chance to drift)?
- Does the firmware reuse the SDK's RLP, or reconstruct its own from the field-by-field message?
- Is `chainId` passed as number / hex string / big-endian bytes? Look for any conversion that could lose/gain a byte.
- Are `maxFeePerGas` and `maxPriorityFeePerGas` always passed as the same hex/number type, or does one path stringify and the other leave it numeric?
- Is the `data` field copied byte-for-byte, or chunked?
- Is there a code path that signs a *legacy* envelope but wraps the response in a *type-2* serializer (or vice versa)?

### 4. Compare to EIP-712 path that works

The EIP-712 SDK path (`sdk.eth.ethSignTypedData`) is verified to recover correctly for the same device. Whatever differs between that method's signing-message construction and `ethSignTransaction`'s signing-message construction is the suspect zone.

## When you fix it

1. The fix lives in `keepkey-vault-sdk` and/or the firmware. **Not** in keepkey-client.
2. Re-run the offline recovery — fixture should now pass:
   ```bash
   cd /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk
   node tests/evm-tx-1559/recover-fixture.js
   ```
3. Re-run the live test — should also pass:
   ```bash
   KEEPKEY_API_KEY=... node tests/evm-tx-1559/sign-and-recover.js
   ```
4. Capture **one more** real Uniswap swap via the BEX after the fix is in place. Add it to `tests/fixtures/evm-tx-1559-regression.json` as a *passing* fixture so we have evidence the fix holds end-to-end.
5. The PR https://github.com/keepkey/keepkey-client/pull/55 contains diagnostic instrumentation (`[DECODE]` log) that should remain landed regardless. It catches future regressions of this class.

## What this PR has *already done* (don't re-do)

The open PR (`fix/eth-swap-dropped-tx`, https://github.com/keepkey/keepkey-client/pull/55) has 3 commits + this handoff. None of them fix the signing bug. They fix unrelated smells discovered during diagnosis:
- JSON-RPC passthrough on `eth_getTransactionByHash` / `eth_getTransactionReceipt` / `eth_getBlockByNumber` (replaces ethers wrappers that returned wrong field names to dApps)
- Tip-aware fee-warning in the side-panel approval card
- Smart-contract detection fix (was reading `transaction.request.data`, an array, instead of `transaction.unsignedTx.data`)
- `[DECODE]` instrumentation in `broadcastTransaction()` — **this is the diagnostic that surfaced the bug**
- Two-stage `[DROP-CHECK]` post-broadcast probe

Plus `RETRO_uniswap_swap_dropped_tx.md` (now superseded — has a note pointing here) and `docs/RPC_PASSTHROUGH_AUDIT.md`.

If a maintainer reviews the PR while the signing bug is open, they can merge the diagnostic + cleanup pieces independently. The signing bug is upstream and out of this PR's scope.

## What to **not** do (lessons captured live)

1. **Don't patch this in keepkey-client.** The bug is upstream. Adding wallet-side workarounds (re-signing, re-RLP-encoding the SDK's serialized output, etc.) would mask the real bug and ship a broken contract to dApps.
2. **Don't theorize about routing / private mempools / Blink Protect / etc.** I did this for hours and it was wasted time. The wrong "from" on etherscan was always just the malformed signature recovering to the wrong account. There is no relayer story.
3. **Don't add hardcoded RPC URLs as resilience.** Pioneer is the source of truth for RPCs (see `feedback_no_hardcoded_rpcs.md`). The wallet will broadcast through whatever RPC Pioneer gives it; that's not the bug.
4. **Don't blame the device path / derivation.** The same device-path EIP-712 sigs recover correctly. The issue is in EIP-1559 pre-image construction or signing-message dispatch, not in keychain or seed handling.

## Quick verification checklist for the fix

When you think you have a fix:

- [ ] Offline `recover-fixture.js` passes for `uniswap-link-to-usdt-1`
- [ ] Live `sign-and-recover.js` passes on a paired device
- [ ] A fresh Uniswap swap on mainnet via the BEX:
  - [ ] `[DECODE] match=true` in the background console
  - [ ] No `[DECODE] ❌ MALFORMED-HEX` line
  - [ ] dApp's `eth_getTransactionByHash` poll resolves to a non-null response (tx visible in mempool)
  - [ ] Tx mines on-chain with the correct `from` address
- [ ] EIP-712 signing path remains unaffected (run the existing `tests/evm-eip712/permit2.js`)
- [ ] One additional fixture captured *after* the fix and added to `evm-tx-1559-regression.json` as a passing entry
