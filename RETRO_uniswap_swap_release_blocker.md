# Release blocker — Uniswap swap regression on develop (0.0.28)

**Status:** 🔴 **BLOCKING release of 0.0.28 / PR #51 (develop → master).** Do not merge.
**Captured:** 2026-04-28
**Owner needed:** next person picking this up

---

## Symptom

User signs Permit2 typed-data successfully on the device, but the Uniswap swap then fails:

```
POST https://trading-api-labs.interface.gateway.uniswap.org/v1/swap 404 (Not Found)
TransactionStepFailedError: SwapTransactionAsync failed during swap
```

Reproduces against ETH mainnet on at least one address (`0x141D9959cAe3853b035000490C03991eB70Fc4aC`). User has seen this pattern before and asserts it is a real regression — not an intermittent Uniswap quote-expiry issue.

A subsequent attempt produced a successful `eth_signTransaction` for a Universal Router `execute(...)` call (see "Open data" below) — the broadcast/landing status of that tx is unknown, so we can't yet say whether the failure window is just the permit→swap handoff or affects the full flow.

---

## Disposition

- PR #51 (release: 0.0.28): **HOLD**, do not merge. URL: https://github.com/keepkey/keepkey-client/pull/51
- Tracking issue: https://github.com/keepkey/keepkey-client/issues/52
- Local-only fix in working tree (unstaged): removed `SET_ASSET_CONTEXT`-driven EIP-1193 emission in `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/index.ts:959-1037` (line numbers from before the unstaged delete). Build is green. **User reports bug persists with this change present** — but the user may not have reloaded the unpacked extension at `chrome://extensions` after `make build`, so this is unverified.
- Memory notes saved (read these before continuing):
  - `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_eip712_diagnosis.md` — avoids the verify-mismatch gaslighting trap
  - `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_handoff_paths.md` — absolute-paths-only rule for handoff docs

---

## Hypotheses tried and outcome

| # | Hypothesis | Status | Notes |
|---|---|---|---|
| 1 | Wrong derivation path — device signing with wrong account | ❌ ruled out | Path `[2147483692, 2147483708, 2147483648, 0, 0]` = `m/44'/60'/0'/0/0` is canonical BIP44 ETH. User confirmed `0x141D9959…` is the right address. |
| 2 | EIP-712 signer mismatch (data drift in signing chain) | ❌ ruled out | Captured production sig `0x44b8eec…c1b` recovers cleanly to `0x141D9959…` against the captured typed data — see SDK fixture (offline check passes). My initial recovery against the wrong fixture variant was the source of the false alarm. |
| 3 | Uniswap quote expiry / `interface-labs` endpoint quirk | unconfirmed | Plausible but the user has rejected this framing. Need response body of the `/v1/swap` 404 to confirm/deny. Not yet captured. |
| 4 | `SET_ASSET_CONTEXT` emitting `accountsChanged`/`chainChanged` to dApp tabs mid-swap (regression from `c415975`) | unconfirmed (likely not the cause) | Hypothesized that the new EIP-1193 emit block fires after `signature_complete` and disrupts Uniswap's swap state. Unstaged fix removes the block. User reports bug persists with the build but reload-status of the unpacked extension is unverified. |
| 5 | MetaMask masking from `79eecf4` | not yet investigated | Provider shape changes for MetaMask compatibility could break Uniswap behavior. Worth a careful read. |
| 6 | Vault/firmware EIP-712 regression (e.g., from `8fe2d26 EVM clear-signing end-to-end`) | not yet tested live | Test infrastructure is in place — see "Test scaffolding" — but the online check has not been run yet. |

---

## Test scaffolding built (use this)

Four new files in the SDK test tree (full absolute paths — handoff is cross-repo):

1. `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/fixtures/eip712-blobs.json` — vendored production-captured payloads. Two Permit2 LINK entries already in there; one carries `knownGoodSignature` for offline recovery.
2. `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/permit2.js` (rewritten) — basic Permit2 sign + recover round-trip.
3. `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/permit2-bex-shape.js` — same payload but invoked in the exact shape the BEX uses (extra `addressNList` field, JSON.parse round-trip on typed data).
4. `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/uniswap-permit-prod.js` — fixture-driven runner. **This is the one to extend.** Walks every blob, runs offline recovery (where `knownGoodSignature` is set), then signs fresh via the local vault and verifies the recovery.

### How to add new failures

When the user hits another failing swap, paste the BEX background-console blob into `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/fixtures/eip712-blobs.json` as a new entry:

```json
{
  "<unique-name>": {
    "context": "what the user was doing",
    "expectedSigner": "0x...",
    "address": "0x...",
    "addressNList": [...],
    "knownGoodSignature": "0x...",   // optional but valuable — enables offline regression check
    "typedData": { ... }              // exact bytes from the BEX log
  }
}
```

Re-run from the SDK directory:

```
cd /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk
KEEPKEY_API_KEY=<paired-bearer-token> node tests/evm-eip712/uniswap-permit-prod.js
```

Get a fresh bearer token with `curl -s -X POST http://localhost:1646/auth/pair -H "Content-Type: application/json" -d '{"name":"sdk-test","url":"http://sdk-test.local"}'`.

### Current SDK test results (sanity baseline)

Offline check on `uniswap-permit2-link-attempt-2` passes — captured fixture is internally consistent. Online check (sign fresh + recover) passed when run during this session for the basic permit2.js and permit2-bex-shape.js variants — both recovered to the device address.

---

## Open data we have not analyzed

The user pasted a `/eth/sign-transaction` log near the end of the session showing a Universal Router `execute(0x3593564c, ...)` swap. Vault returned:

```
{
  "r":"0x0a52477eafde4ab4a4fb14a953a6fa10e2ba30085c43f72dfc78400de9235c5d",
  "s":"0x46a273d0a6fdefbb9b0d91e81cdba26b07828647d047de97b3b72637367ac4ac",
  "v":0,
  "serialized":"0x02f904dd018201ef841dcd26ea8432ee49db83037dde944c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca80b9046e3593564c…"
}
```

Embedded in the calldata is a Permit2 sig — `0x9662b1bd…3f1b` — different from the earlier `0x44b8eec…c1b`. So this is a NEW swap attempt, not the same one as the 404.

Open questions:
- Did this signed tx broadcast successfully? Did it land on chain?
- Was this run before or after the unstaged `SET_ASSET_CONTEXT` fix was reloaded into Chrome?
- Was this attempt's signed Universal Router calldata the one Uniswap rejected, or a separate flow?

The user also mentioned address `0xe24A8f2ae82F6829ef277E59268111BEE54B5D3e` without context — unknown if it's a different account, recipient, contract, or red herring.

---

## Concrete next steps

In order:

1. **Confirm reload state.** Have the user reload the unpacked extension at `chrome://extensions` after `make build`, then retest. Decide whether the unstaged `SET_ASSET_CONTEXT` EIP-1193-emit removal helps or doesn't. Either commit or revert.

2. **Capture the `/v1/swap` 404 response body.** DevTools → Network → filter `/v1/swap` → copy response body. The 404 from `trading-api-labs` usually carries a JSON error explaining what Uniswap's server actually rejected (quote not found, signature mismatch, etc.). This single data point likely collapses 3–4 hypotheses.

3. **Run the online half of `uniswap-permit-prod.js`** against the local vault with the user's actual paired KeepKey:

   ```
   cd /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk
   KEEPKEY_API_KEY=<bearer> node tests/evm-eip712/uniswap-permit-prod.js
   ```

   If a fresh sig fails to recover to the device address — proven vault/firmware regression. The test prints `domainSeparator`/`structHash`/`digest` to diff against the firmware's hashes.

4. **If (3) passes**, the regression is in the BEX layer. Next-most-likely candidates in order:
   - Side-panel `signature_complete` handler causing a context resync that mutates state mid-swap. Background sender: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts:1109-1114`.
   - MetaMask masking shim from commit `79eecf4` returning a value/event the dApp doesn't expect. Files: `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/injected/injected.ts` and `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/content/src/index.ts`.
   - Popup→side-panel merge from commit `80be566` changing event timing.

5. **Determine whether the open Universal Router sig (Open Data above) actually broadcasts and lands.** That tells us whether the failure window is *only* the permit→swap handoff (Uniswap-server-side gate) or affects the full flow (our wallet returning bad data).

---

## Pre-existing release work that is fine

The 0.0.28 release also contains commit `ec5c7c8` (this session): version bump + 10 leftover `[TON-DEBUG]` `console.log` statements stripped. That work stands; the release blocker is the swap regression, not the bump.

---

## Important context for whoever picks this up

- The user gave a forceful correction earlier in the session that EIP-712 verify mismatch is a *symptom of bad input data to the verifier*, not a derivation/seed bug. I made that mistake twice — saved as a feedback memory at `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_eip712_diagnosis.md`. Read it before chasing path/account theories.
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk` is the user's preferred controlled environment for diagnosing this class of bug. Add tests there, not in the BEX.
- The vault's `auth.accounts` cache lives at `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/auth.ts:241-249` and is shared across all paired bearer tokens. State from earlier failed attempts can poison subsequent runs — clear-and-repair when in doubt.
- The firmware's `fsm_msgSolanaSignMessage` AdvancedMode gate at `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/keepkey-firmware/lib/firmware/fsm_msg_solana.h:467-475` is unrelated to this bug but is itself a separate vault-side regression we documented earlier in the session — keep separate.

## File index (every path referenced in this doc, absolute)

**keepkey-client (this repo, where the doc lives):**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/index.ts` — global background, contains `SET_ASSET_CONTEXT` handler
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts` — `signTypedData`, `signTransaction`, `switchToProvider`, `signature_complete` emitter
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/injected/injected.ts` — page-side EIP-1193 provider, MetaMask mask
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/content/src/index.ts` — content script relay between background and injected provider

**keepkey-vault-v11 (cross-repo):**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/fixtures/eip712-blobs.json` — captured failing payloads
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/permit2.js`
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/permit2-bex-shape.js`
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-sdk/tests/evm-eip712/uniswap-permit-prod.js`
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts` — `/eth/sign-typed-data` REST handler
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/auth.ts` — shared `auth.accounts` cache

**keepkey-firmware (submodule of vault):**
- `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/keepkey-firmware/lib/firmware/fsm_msg_solana.h` — Solana sign-message AdvancedMode gate (separate issue, see disposition note above)

**Private memory (not in any repo):**
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_eip712_diagnosis.md`
- `/Users/highlander/.claude/projects/-Users-highlander-WebstormProjects-keepkey-stack-projects-keepkey-client/memory/feedback_handoff_paths.md`
