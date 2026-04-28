# Handoff — Uniswap swap regression, audit round 2

**Status:** 🔴 Still blocking 0.0.28 release. 712 signing chain definitively cleared.
**Captured:** 2026-04-28
**Predecessor:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_uniswap_swap_release_blocker.md`

---

## What this round proved

### Sig is provably valid end-to-end (off-chain AND on-chain)

| Check | Method | Result |
|---|---|---|
| Off-chain ECDSA recover | `ethers.utils.verifyTypedData` | ✅ Recovers to `0x141D9959cAe3853b035000490C03991eB70Fc4aC` |
| On-chain Permit2 acceptance | `eth_call Permit2.permit(owner, permitSingle, sig)` against mainnet | ✅ Returns `0x` (success, no revert) |
| On-chain nonce match | `Permit2.allowance(owner, token, spender).nonce` vs typed-data nonce | ✅ Both 0 |
| Sig wire format | 65 bytes, v∈{27,28}, low-S, EIP-55 address | ✅ All pass |
| Sig determinism (RFC 6979) | Re-sign same fixture → byte-identical | ✅ |

The Permit2 contract is the on-chain authority on whether a Permit2 sig is valid. It accepts ours. Broadcasting a tx that consumes this sig would succeed.

**Conclusion: the bug is NOT in 712 signing.** Not in firmware, not in vault, not in hdwallet, not in the SDK, not in the BEX→dApp handoff.

### BEX → dApp handoff is byte-identical

User instrumented HANDOFF logging in BEX. Captured during a failing swap:

```
[HANDOFF] vault → BEX (eth_signTypedData_v4 raw):
  {"address":"...","signature":"0xa6ac6665…2c1c"}
[HANDOFF] BEX → dApp (eth_signTypedData_v4 final):
  type=string len=132 value=0xa6ac6665…2c1c
```

132 hex chars (= 65 bytes) forwarded byte-identically. No mutation in the chrome.runtime → content script → injected → dApp chain.

### No stray EIP-1193 events disrupting dApp state

Around the failed sign, the only events fired by our provider are normal polling — `eth_chainId`, `eth_blockNumber`, `eth_accounts`, `wallet_getCapabilities`. **No `accountsChanged`, no `chainChanged`, no provider reset.** Hypothesis #4 from the prior retro (SET_ASSET_CONTEXT EIP-1193 emit block from commit `c415975`) is conclusively ruled out for this failure mode.

### State surfaces consistent

- `eth_accounts` → `["0x141D9959cAe3853b035000490C03991eB70Fc4aC"]` (checksum case, correct)
- `eth_chainId` → `0x1` (mainnet)
- `wallet_getCapabilities` → `{atomicBatch:false, paymasterService:false}` (correct for KeepKey today)

---

## What's left as the bug

Given everything above, there is **only one class of failure left** that's consistent with all the data:

> The dApp built its quote using values it got from our provider during the **pre-sign** phase. If any of those values are wrong, the resulting quote is structurally inconsistent with our actual on-chain state. When the dApp later POSTs the quote + sig to `/v1/swap`, Uniswap's server reconstructs the expected on-chain state, sees the inconsistency, and rejects with 404.

In other words: **the regression is in how our provider answers some RPC call that happens before signTypedData_v4 — not in signTypedData_v4 itself.** Likely candidates (in rough probability order):

1. **`eth_call` to Permit2.allowance(owner, token, spender)** — if the dApp asked us to read this and we returned something other than the actual on-chain (0, 0, 0) state, the dApp would build a typed-data with the wrong nonce/expiration.
2. **`eth_call` to Permit2.allowance() on a different token/spender pair** during pre-quote checks.
3. **`eth_call` simulation of Universal Router** — if the dApp simulates the swap before calling `/v1/swap` and we return a wrong revert / state.
4. **`eth_getBalance`** for the input token's native balance.
5. **`eth_chainId` returned at the wrong moment** (e.g., during chain-switch transition) — but the existing log shows `0x1` consistently.
6. **`wallet_getCapabilities`** — atomicBatch=false is correct, but if Uniswap inferred something from this we don't fulfill, /v1/swap could 404.
7. **`eth_estimateGas`** for the eventual swap tx — if the dApp pre-validates and we lied about gas.

---

## What to log next from the BEX (concrete instrumentation spec)

You already have `[HANDOFF] BEX → content script (ethereum/<method>)` covering simple RPCs. Extend it to **log the params AND return value of EVERY RPC call** during the swap flow — not just the simple readonly ones.

### Add a log line in `chrome-extension/src/background/chains/ethereumHandler.ts` at the central RPC dispatcher

For every method that hits the dApp tab — including `eth_call`, `eth_getBalance`, `eth_getCode`, `eth_estimateGas`, `eth_getTransactionCount`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getStorageAt`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `wallet_addEthereumChain`, `wallet_switchEthereumChain`, `wallet_revokePermissions`, `wallet_getPermissions`, `wallet_requestPermissions` — log:

```ts
console.log(`[HANDOFF] BEX → content script (ethereum/${method})`,
  'params=', JSON.stringify(params)?.slice(0, 400),
  'value=', JSON.stringify(value)?.slice(0, 400),
  'len=', JSON.stringify(value)?.length);
```

The two big asks:

- **`params`** must be logged for `eth_call` — the calldata + `to` field is what tells us which contract+function the dApp is querying. Without it, we know the dApp called `eth_call` but not what it asked.
- **`len` of large `eth_call` returns** — Uniswap's quote pipeline calls many `eth_call`s with large multicall calldata; just logging the first 400 chars is fine, but we want the byte length so we can spot suspicious truncation.

### What we're hunting for in the new logs

When you re-run the failing swap with this instrumentation:

1. Find the `[HANDOFF] BEX → content script (ethereum/eth_call)` lines that target Permit2 (`0x000000000022d473030f116ddee9f6b43ac78ba3`). The `params[0].data` field will start with `0x927da105` (allowance selector — keccak("allowance(address,address,address)")[:4]) or `0x65b6ec38`. Compare the return value against what `Permit2.allowance(0x141D…, 0x5149…, 0x4c82…)` returns on mainnet directly (the SDK test prints this — `(0, 0, 0)`).
2. Find any `eth_call` that returns suspicious empty data (`0x`) for a non-empty contract, OR returns something that doesn't decode cleanly as the expected return type.
3. Find any `eth_call` where the return value differs between successive calls during the same swap attempt.

If the new logs show every `eth_call` returning sane values, the bug is downstream of our provider entirely — i.e., the regression is on Uniswap's interface gateway and not on our side. (User has rejected this framing; if the new instrumentation supports it, we have evidence to revisit.)

### Optional: capture the dApp's own outgoing /v1/swap request

Out-of-band of BEX: in DevTools Network tab during the failure, click the failing `/v1/swap` row → Payload → copy the Request Payload. Paste below in this doc. The fields of interest are:

- `quote.swapper` (must equal `0x141D9959cAe3853b035000490C03991eB70Fc4aC`)
- `quote.permitData.values.message.{nonce, expiration, sigDeadline, amount, token, spender}`
- `signature` (must equal what BEX returned: `0xa6ac6665…2c1c` for the latest entry)

If the `quote.permitData.values.message` differs in any byte from what we signed, that's the divergence — the dApp lied to us about what it was going to send.

---

## Reproducer paths

### Re-prove sig validity any time

```bash
KEEPKEY_API_KEY=<bearer> \
  node /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/permit2-onchain-validate.js
```

Pulls the latest `/eth/sign-typed-data` entry from `/api/v1/activity`, runs off-chain recover + on-chain `Permit2.permit()` simulation. Should print "✅ sig is on-chain valid" in <2s.

### Re-prove sig wire format

```bash
KEEPKEY_API_KEY=<bearer> \
  node /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/sig-format-audit.js
```

Asserts 65 bytes, v∈{27,28}, low-S, EIP-55 case, recovery, EIP-2098 compactability. 20 assertions. Requires a fresh device approval.

### Pull the latest signing entry

```bash
curl -sS -H "Authorization: Bearer $KEEPKEY_API_KEY" \
  'http://localhost:1646/api/v1/activity?route=/eth/sign-typed-data&limit=1' | jq
```

Returns full request body (typed data) and response body (sig) for offline replay.

### Get a fresh bearer token

```bash
curl -sS -X POST -H "Content-Type: application/json" -d '{"name":"sdk-test","url":"http://sdk-test.local"}' \
  http://localhost:1646/auth/pair
```

---

## File index (every absolute path referenced)

**keepkey-client (this repo):**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/HANDOFF_uniswap_swap_v2.md` — this doc
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_uniswap_swap_release_blocker.md` — round-1 retro
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts` — where to add the param-logging
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/index.ts` — alternative HANDOFF logging location

**keepkey-vault-v11 (cross-repo):**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/permit2-onchain-validate.js` — new on-chain validation test
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/sig-format-audit.js` — new wire-format audit test
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/uniswap-permit-prod.js` — fixture-based regression suite (existing)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/fixtures/eip712-blobs.json` — captured failing payloads
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts` — `/api/v1/activity` endpoint
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/docs/incident-7.14-eip712-regression.md` — original incident doc
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/docs/handoff-signing-history.md` — REST audit-log workflow
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/hdwallet/packages/hdwallet-keepkey/src/ethereum.ts:451` — `ethSignTypedData` (host-side hashing via `@metamask/eth-sig-util`)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/keepkey-firmware/lib/firmware/fsm_msg_ethereum.h:333` — firmware `fsm_msgEthereumSignTypedHash` (signs precomputed digests, doesn't walk typed data)
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/keepkey-firmware/lib/firmware/ethereum.c:1083` — `ethereum_typed_hash_sign` (emits v=27+recid)

**Memory (private):**
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_eip712_diagnosis.md` — don't blame derivation when verify-mismatches; instrument the chain
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_uniswap_blame.md` — don't propose Uniswap-server-side hypotheses
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_handoff_paths.md` — absolute paths only in handoff docs

---

## Open questions for the next reader

1. With `eth_call` Permit2.permit() simulation passing on mainnet, what mechanism could cause a /v1/swap 404 that's *our* fault and not Uniswap's interface gateway's fault? The new RPC-param instrumentation should answer this empirically.
2. Is there a recent commit that changed how we answer `eth_call` for any of `Permit2.allowance`, ERC-20 `balanceOf`, ERC-20 `allowance`, Universal Router views, or multicall aggregations? Worth grepping `git log -p chrome-extension/src/background/chains/ethereumHandler.ts | grep -E 'eth_call|case .eth_'`.
3. If the new instrumentation shows every value sane: the regression is downstream of our provider. Reopen the Uniswap-server-side framing only if multiple wallets fail in the same way — that's a meaningful new data point.

---

## Closure criteria

The release ships when EITHER:
- The new BEX RPC-param logs reveal which return value diverges from on-chain truth, AND that divergence is fixed; OR
- A different reproducer paths surfaces (e.g., the failure correlates with a specific recent commit, the user finds a similar regression on another EVM dApp, etc.) that lets us bisect.

Until then, do not merge PR #51 / `develop → master`.
