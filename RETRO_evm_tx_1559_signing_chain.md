# Retro — EIP-1559 type-2 tx signing chain produces malformed-hex (release blocker)

**Status:** 🔴 **RELEASE BLOCKER** for any keepkey-client build that exposes EVM `eth_sendTransaction` flows. Do not ship 0.0.28 / merge develop → master while this is open.

**Captured:** 2026-04-28
**Symptom owner:** signing chain in `keepkey-vault-sdk` (`/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/`) and/or vault firmware (`keepkey-vault-v11`).
**Not** in keepkey-client — this PR (`fix/eth-swap-dropped-tx`, https://github.com/keepkey/keepkey-client/pull/55) only adds the diagnostic that surfaces the bug.

---

## TL;DR

`sdk.eth.ethSignTransaction(...)` is returning a serialized type-2 (EIP-1559) envelope whose ECDSA signature **does not recover to the device's address**. It recovers to a wrong-but-deterministic address (e.g. `0xEB152892…` for one captured tx). The on-chain effect is the same as if the user signed with the wrong key:

- The tx broadcasts to whatever RPC we use; the RPC accepts it (the signature is mathematically valid against *some* hash, just not the right pre-image).
- The tx hash is real and lives in the mempool briefly.
- It can never confirm because the recovered "from" account has no balance / wrong nonce.
- The mempool drops it after a short window.
- The dApp's `eth_getTransactionByHash` poll returns null forever.
- The dApp's UI hangs at "Confirm in wallet."

Every Uniswap swap on this branch fails for this reason. The PR's other fixes (passthrough, fee-warning, drop-check) are necessary cleanups but do not address the signing bug.

---

## Definitive evidence — recovery does not match

For tx `0x9475ee7d5d144c628dcbc3f2069e9775bbfd41220064ec1dd48383344416265e`:

```
expected signer:  0x141D9959cAe3853b035000490C03991eB70Fc4aC  (device EOA, m/44'/60'/0'/0/0)
recovered signer: 0xEB152892ABe5D59c529984C355cF1D08FfFb1b5D  (from ECDSA recovery against canonical type-2 pre-image)
v-parity flipped: 0xA90284b3758f4cECf58Be68323175B9ae7c8Df1f  (rules out simple parity inversion)
```

Captured serialized bytes:
```
0x02f9067f018201ef850218711a00850291d5740f8306c8b8944c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca80b9060e3593564c…c080a029a5619898922af8414aba680899d5aa576bd6dec66391d3fcc79607e2fb1868a0412233e619f4f50b240958f1ab5632e4bbffa6c5d66515d69c78aa3fb3da7b0a
```

Full fixture: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/fixtures/evm-tx-1559-regression.json` (entry `uniswap-link-to-usdt-1`).

`from` is a normal EOA — `eth_getCode(0x141d…)` returns `0x` — so there is exactly one valid signature per pre-image. The SDK's signature is over a different pre-image than the envelope encodes.

---

## What I tested in this session and ruled out

I ran the captured `r/s` against 30+ candidate pre-image hashes. **None recover to the expected signer.**

| # | Hypothesis | Result |
|---|---|---|
| 1 | Canonical EIP-1559 type-2 pre-image (chainId=1) | recovers `0xEB152892…` ❌ |
| 2 | v-parity flip (yParity 0 ↔ 1) | recovers `0xA90284b3…` ❌ |
| 3 | Eight wrong chainIds in pre-image (137, 56, 10, 8453, 42161, 43114, 324, 100) | each yields its own wrong address ❌ |
| 4 | Legacy EIP-155 pre-image with `gasPrice = maxFeePerGas` | wrong ❌ |
| 5 | Legacy EIP-155 pre-image with `gasPrice = maxPriorityFeePerGas` | wrong ❌ |
| 6 | Type-2 RLP without the `0x02` type-prefix in pre-image | wrong ❌ |
| 7 | Type-2 with `maxFeePerGas`/`maxPriorityFeePerGas` swapped in field order | wrong ❌ |
| 8 | Plain legacy (no chainId, gasPrice = maxFee) | wrong ❌ |
| 9 | Data truncation at every 32-byte boundary up to full length (1550 bytes), and at 256/512/1024/1280/1408/1500/1518 | wrong ❌ |
| 10 | Data extension (zero-pad to length+1, +16, +32, +64) | wrong ❌ |

The bug is not a standard variant. It's in some field-encoding detail my hypothesis battery didn't hit.

---

## What I confirmed *is* working

Earlier in the same session a Permit2 typed-data signature was captured and recovered correctly:

```
Permit2 sig 1 — 0x5f4eb4e3…1b → recovered 0x141D9959…  ✅ (match)
Permit2 sig 2 — 0x69720389…1c → recovered 0x141D9959…  ✅ (match)
```

So **EIP-712 typed-data signing is fine**. The bug is *specific to* EIP-1559 type-2 transaction signing. EIP-712 and EIP-1559 go through different SDK methods (`eth.ethSignTypedData` vs `eth.ethSignTransaction`) and likely different firmware message types. Whatever differs between those two paths is where the bug lives.

This narrowing is critical. It means the keychain/derivation/address logic is fine. The corruption is in the EIP-1559-specific pre-image construction or signing-message dispatch.

---

## Things I got wrong in this session and want flagged

These were captured live so the next reader can avoid the same dead-ends.

1. **I hallucinated a "Blink Protect sponsored relayer" story** to explain the wrong "from" on etherscan. There was no evidence for it. The real explanation is the signature recovers to a wrong address — etherscan was just rendering what the broadcast bytes actually encode. The user called this out (`feedback_no_hardcoded_rpcs.md`-adjacent — instinct that I was speculating, not analyzing) and they were right.
2. **I framed the failure as a routing/mempool-eviction problem** for several rounds before getting to the malformed-hex hypothesis the user had already named. Saved as the `RETRO_uniswap_swap_dropped_tx.md` retro that was retroactively wrong on root cause. Updated note added to that retro pointing at this one.
3. **I was about to add hardcoded RPC fallback URLs to `chains.ts`** as a "resilience" patch. User stopped me — `feedback_no_hardcoded_rpcs.md` is the durable rule. RPCs come from Pioneer; hardcoded lists in the extension force a release on every operator change.

The user's debugging memory `feedback_eip712_diagnosis.md` ("EIP-712 verify mismatch is data-drift, not path/seed — when recovered signer ≠ expected, instrument the signing chain; don't blame derivation") applies *exactly* to this EIP-1559 case too. Same medicine: instrument the signing chain. I should have followed it from the first wrong-from observation instead of theorizing about routing.

---

## What this PR *does* contribute toward the bug

Branch `fix/eth-swap-dropped-tx`, PR https://github.com/keepkey/keepkey-client/pull/55. The diagnostic instrumentation is the part that's load-bearing for the next session:

- `chrome-extension/src/background/chains/ethereumHandler.ts` — `[DECODE]` log inside `broadcastTransaction()`. Parses every signed tx via `ethers.Transaction.from()`, recovers the signer, and prints `recoveredFrom / expectedFrom / match`. If `match=false`, prints `[DECODE] ❌ MALFORMED-HEX` at error level. **This is what surfaced the bug.**
- The PR's other content (JSON-RPC passthrough on `eth_getTransaction*` / `eth_getBlockByNumber`, tip-aware fee-warning, smart-contract detection, drop-check) are real fixes to real other smells but are independent of this signing bug. They should still merge once a maintainer reviews.

---

## Test scaffolding added in `keepkey-vault-sdk`

To bisect the SDK ↔ firmware boundary without keepkey-client in the loop:

```
/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/
├── tests/
│   ├── evm-tx-1559/
│   │   ├── recover-fixture.js    ← offline; walks every fixture, asserts recovery
│   │   └── sign-and-recover.js   ← live; re-signs the same input on a paired device
│   └── fixtures/
│       └── evm-tx-1559-regression.json    ← captured failing payload (uniswap-link-to-usdt-1)
└── package.json    ← ethers added as devDep (test-only, not published)
```

Run offline (no device needed):
```bash
cd /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk
node tests/evm-tx-1559/recover-fixture.js
```

Expected today: 1 failure (`serialized envelope recovers to WRONG signer` on `uniswap-link-to-usdt-1`). The "diagnostic match" line will print *if* one of the standard hypotheses in the test file ever lights up — none do today.

Run live (paired device, same seed as the fixture's signer ideally):
```bash
KEEPKEY_API_KEY=<paired-bearer-token> node tests/evm-tx-1559/sign-and-recover.js
```

This reproduces the bug in isolation — signs the captured failing input via the SDK, parses the result, and asserts the recovered signer equals the device address. With a different dev seed, set `EXPECTED_SIGNER=auto` to compare against the device's own address instead of the fixture's.

When the bug is fixed, both scripts should pass and the fixture moves from "failing-by-design" to "passing regression guard."

---

## Where to look next

The bug is somewhere in this slice:

1. **`/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/src/`** — the SDK's `eth.ethSignTransaction` implementation. Specifically: how it builds the signing-message payload sent to the firmware, and how it constructs the returned serialized envelope from the firmware's r/s/v.
2. **vault firmware (`keepkey-vault-v11`)** — the Rust handler for the EthereumSignTx (or whatever the relevant protobuf message is). Same questions: what hash does it actually sign, how does it form r/s/v.

Specifically check:
- Does the SDK build the type-2 RLP **once** for both the firmware request and the returned envelope, or **twice** (with a chance to drift)?
- Does the firmware reuse the SDK's RLP, or does it reconstruct its own from the field-by-field message it receives?
- Is `chainId` passed as a number? hex string? big-endian bytes? Look for any place a chainId conversion could lose/gain a byte.
- Are `maxFeePerGas` and `maxPriorityFeePerGas` always passed as the same hex/number type, or does one path stringify and the other leave it numeric?
- Is the `data` field copied byte-for-byte to the signing-payload, or chunked?
- Is there a code path that signs a *legacy* envelope but wraps the response in a *type-2* serializer (or vice versa)?

The fastest way to find it: in the SDK's `ethSignTransaction`, log the exact bytes/JSON sent to firmware *and* the exact serialized envelope returned, then run `recover-fixture.js`-style logic on both. The hash divergence will name the field.

---

## Open questions

1. Is the bug a recent regression or has every type-2 EVM swap signed by a KeepKey via this SDK silently been malformed for some time? (Worth checking older dApps that were known to work pre-Pioneer-SDK-removal.)
2. Does the same bug exist for legacy (pre-1559) tx signing through this SDK? Add a `evm-tx-legacy-regression.json` fixture and battery alongside.
3. Does it reproduce on every paired KeepKey or only a subset (firmware version dependent)?

These are the first three things `sign-and-recover.js` can probe by capturing more fixtures.

---

## File index

- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_evm_tx_1559_signing_chain.md` — this doc
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/HANDOFF_evm_tx_1559_signing_chain.md` — companion handoff for the next session
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_uniswap_swap_dropped_tx.md` — earlier (now superseded) routing-as-root-cause framing; updated note added pointing here
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/RETRO_uniswap_swap_release_blocker.md` — original Permit2 / `/v1/swap 404` retro from 2026-04-28; the "data drift, not path/seed" diagnosis there applies here too
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts` — `broadcastTransaction()` contains the `[DECODE]` log that surfaces this bug
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-tx-1559/recover-fixture.js` — offline regression test
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-tx-1559/sign-and-recover.js` — live regression test
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/fixtures/evm-tx-1559-regression.json` — fixture file
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_eip712_diagnosis.md` — the diagnostic principle that applies here
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_no_hardcoded_rpcs.md` — separate but related: do not patch this with hardcoded RPC URLs
