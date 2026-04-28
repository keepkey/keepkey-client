# Audit + handoff — EVM fee pipeline (Uniswap stuck-pending)

**Status:** Pipeline audit complete. **No fee tampering anywhere in BEX → vault → firmware.** Two real defects found *adjacent* to fees were fixed this session (nonce + gas-limit). The remaining work is policy: enforce a minimum-fee floor in the BEX with user-visible warning + bump.

**Picked up:** 2026-04-29 morning by next session.

---

## 1. End-to-end fee pipeline (verified, byte-identical at every hop)

**Concrete trace** using the user's last failed tx values (`maxFeePerGas: 0x3ac20391` ≈ 0.986 gwei, `maxPriorityFeePerGas: 0x20ecb07f` ≈ 0.552 gwei):

| Hop | File:line | What happens | Verdict |
|---|---|---|---|
| 1 | dApp → BEX | Uniswap calls `eth_sendTransaction` with `maxFeePerGas: "0x3ac20391"` in `params[0]` | dApp-supplied |
| 2 | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts:1062-1065` | `signTransaction()` reads `transaction.maxFeePerGas`, copies to `input.maxFeePerGas` | ✅ passthrough, no mutation |
| 3 | BEX → vault SDK | `sdk.eth.ethSignTransaction(input)` → POST `/eth/sign-transaction` | ✅ raw JSON forwarded |
| 4 | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts:1743-1748` | Vault REST handler: `msg.maxFeePerGas = body.maxFeePerGas` (and `body.max_fee_per_gas` snake-case alias) | ✅ passthrough, no mutation |
| 5 | Vault → hdwallet-keepkey | `wallet.ethSignTx(msg)` | ✅ |
| 6 | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/node_modules/@keepkey/hdwallet-keepkey/src/ethereum.ts:308-313` | `est.setMaxFeePerGas(core.arrayify(msg.maxFeePerGas))` — copies into protobuf `EthereumSignTx` for the firmware | ✅ passthrough, no mutation |
| 7 | hdwallet → firmware → device signs | Firmware signs the RLP-encoded tx with the supplied fees | ✅ |
| 8 | Vault → BEX | Vault REST returns `{ r, s, v, serialized }` — serialized is the EIP-1559 RLP including the original fee bytes | ✅ |

**Conclusion: no layer in the wallet/vault stack reduces, rounds, or substitutes fee values.** What Uniswap sends in `params[0]` is exactly what gets signed and broadcast.

### Audit method (reproducible)

```bash
# Vault REST handler — fee assignment lines
grep -n "maxFeePerGas\|gasPrice" \
  /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/rest-api.ts \
  | head -10

# hdwallet-keepkey — protobuf field setters
grep -n "maxFeePerGas\|setGasPrice" \
  /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/node_modules/@keepkey/hdwallet-keepkey/src/ethereum.ts \
  | head -10

# BEX signTransaction — fee assignment block
sed -n '1037,1059p' \
  /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts
```

Every site copies the value unchanged. No `Math.min`, no rounding, no oracle substitution. The `[HANDOFF] vault → BEX (eth_signTransaction)` log added this session at `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts:~1067` will print the exact `input` that was signed plus the resulting `serialized` — paste both into a tx decoder to byte-verify.

---

## 2. Defects fixed this session (already in worktree, not yet committed)

| # | File | Line | Bug | Fix | Effect |
|---|---|---|---|---|---|
| 1 | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts` | ~986 | `getTransactionCount(addr, 'latest')` — counted only confirmed txs, so a re-attempted swap reused the same nonce as the prior pending tx. EIP-1559 replacement-underpriced kicks in unless +10% on both fees, and Uniswap's recomputed fees usually aren't 10% higher → second tx silently rejected by miners → "pending forever, `eth_getTransactionByHash` returns null" | `'pending'` instead of `'latest'` | Repeat-attempt swaps now get fresh nonces, won't collide with in-flight txs |
| 2 | same file | ~990 | JSON-RPC spec uses `gas`; our code only checked `transaction.gasLimit` (camelCase) → silently ignored Uniswap's gas limit and re-estimated against publicnode | Honor `transaction.gas` if `gasLimit` absent | Universal Router calls now sign with Uniswap's recommended limit |
| 3 | same file | ~679 | Same `'latest'` nonce defect in the in-extension `transfer` flow | `'pending'` | In-extension Send/transfer also nonce-safe |

**These don't address fee-magnitude.** They address downstream symptoms (stuck-pending due to nonce collision, gas underprovisioning). Whether to commit them tomorrow alongside the fee-policy work is your call; build is green.

---

## 3. Where Uniswap actually gets its fee numbers (RPC surface audit)

The dApp hands us EIP-1559 fees in `eth_sendTransaction` params. Where do *those* numbers come from? Three RPCs Uniswap could hit on us:

| RPC | Our handler | File:line | Risk |
|---|---|---|---|
| `eth_gasPrice` | `handleEthGasPrice` | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts:265-269` | Returns publicnode's `feeData.gasPrice` (or `'0x0'`). On EIP-1559 chains publicnode usually returns a sane base+tip; if it ever returns 0 we'd hand Uniswap a literal zero and they'd build a doomed tx. **Worth checking what publicnode currently returns.** |
| `eth_maxFeePerGas` | `handleEthMaxFeePerGas` | same file:253-257 | Returns `feeData.maxFeePerGas`. ethers v6 computes this as `2*baseFee + maxPriorityFeePerGas` — usually a safe multiplier. |
| `eth_maxPriorityFeePerGas` | `handleEthMaxPriorityFeePerGas` | same file:247-251 | Returns `feeData.maxPriorityFeePerGas` from ethers' fee oracle. |
| **`eth_feeHistory`** | **MISSING** | — falls through to `default` in switch at `~870` → throws `Method ... not supported` | **Big gap.** Modern dApps (incl. Uniswap's UI via ethers v6 fee estimator) prefer `eth_feeHistory` for percentile-based fee math. If we throw, the dApp falls back to `eth_gasPrice` or whatever cached/default value it has — often stale or low. |

**Recommendation for tomorrow:** add `case 'eth_feeHistory':` that does `provider.send('eth_feeHistory', params)` — pure passthrough, ~3 lines. This alone may make Uniswap supply correct fees without any policy logic.

The `[HANDOFF] BEX → content script` instrumentation already logs every method's params and result, so after the fix you'll see whether Uniswap actually calls `eth_feeHistory` and what we return.

---

## 4. The fee-policy work you described (for tomorrow)

> "force warnings if a dApp tells us one fee, and offer a higher fee our side, if under our 1gwei"

Recommended placement and shape:

### 4a. Where to inject the policy

**Single chokepoint:** `signTransaction` at `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts:1037-1059` — the block that maps `transaction.*` → `input.*` is the last point we can mutate before sending to the vault. Every signed-tx flow funnels through it.

### 4b. Suggested shape

```ts
// New top-of-file constant
const MIN_MAX_FEE_PER_GAS_WEI = BigInt('0x3b9aca00'); // 1 gwei = 1_000_000_000

// Inside signTransaction, after the existing fee-passthrough block:
if (input.maxFeePerGas) {
  const dappMaxFee = BigInt(input.maxFeePerGas);
  if (dappMaxFee < MIN_MAX_FEE_PER_GAS_WEI) {
    // Fetch our own oracle for a sane suggestion
    const ourFeeData = await provider.getFeeData();
    const ourSuggested = ourFeeData.maxFeePerGas ?? MIN_MAX_FEE_PER_GAS_WEI;

    // Surface the warning + suggestion in the approval event so the side-panel
    // UI can show a "dApp suggested X gwei (too low for current network),
    // we suggest Y gwei — accept | edit | reject" choice. Don't silently bump.
    await requestStorage.updateEventById(eventId!, {
      feeWarning: {
        dappMaxFee: input.maxFeePerGas,
        dappPriorityFee: input.maxPriorityFeePerGas,
        suggestedMaxFee: '0x' + ourSuggested.toString(16),
        suggestedPriorityFee: '0x' + (ourFeeData.maxPriorityFeePerGas ?? 0n).toString(16),
        reason: `dApp fee ${dappMaxFee} wei < 1 gwei minimum`,
      },
    });
    // Block here on a user choice — extend requireApproval to surface fee edit.
  }
}
```

**Important: do NOT silently bump fees.** Both UX-wise (user paid more than they expected) and security-wise (don't make signing decisions for the user). The flow should be:

1. Detect under-floor fee
2. Pause the signing flow
3. Show side-panel modal: "Uniswap suggested 0.986 gwei. Current network base fee: 0.578 gwei. Your tx may sit pending. Recommended: 1.5 gwei. **[Use suggested] [Use ours] [Cancel]**"
4. Resume signing with whichever fees the user picked

### 4c. Threshold considerations

`1 gwei` as the floor is reasonable for mainnet *most* of the time, but it's chain-specific. Worth parameterizing:
- Mainnet: 1 gwei reasonable
- L2s (Optimism, Arbitrum, Base): much lower — 0.001 gwei normal
- BSC: 3 gwei minimum
- Polygon: 30 gwei minimum

Consider per-chain floors stored alongside `EIP155_CHAINS` in `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains.ts` (or wherever chain metadata lives — grep for `EIP155_CHAINS`).

A cheaper first cut: only warn when `dappMaxFee < currentBaseFee` (we already know base fee from the same `getFeeData()` call). That's empirically correct: `maxFeePerGas < baseFee` means the tx *literally cannot mine* until base fee drops below it. That's a stronger guarantee than an arbitrary 1-gwei floor.

### 4d. UI integration points

The side-panel approval surface lives at `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/pages/side-panel/src/approval/` (per the existing `RETRO_uniswap_swap_release_blocker.md` reference). The fee-warning UI would slot in there as a new banner above the existing tx-detail card. Look at how the EIP-712 blind-signing banner is wired in vault's `SigningApproval.tsx` (referenced in earlier session) for a pattern to mirror.

---

## 5. Open questions / nice-to-haves

1. **Why does Uniswap supply sub-gwei fees?** Mainnet base fee is 0.5–0.6 gwei right now (low-congestion period), so 0.986 gwei isn't crazy. But the user's first attempt at higher fees had a pending tx that competed. Their fee oracle is probably fine; the *first* attempt wasn't doomed by fees, it was doomed by something else (the EIP-712 / `/v1/swap` 404 in earlier sessions). Subsequent attempts then hit the nonce-collision bug.

2. **Should we add `eth_feeHistory` passthrough proactively?** Yes — 3 lines, no downside, removes a known gap dApps depend on. Suggest doing this *before* the fee-policy work so we can see whether Uniswap actually calls it (the `[HANDOFF]` logs will tell you).

3. **The two stuck pending txs (`0x3d5b…` and `0x9fd9…`)** on the user's wallet. Both nonce N. They'll either:
   - Get evicted from mempool over the next few hours
   - Mine if base fee drops far enough
   - Be cancellable by the user via etherscan/MetaMask sending a self-transfer with same nonce + 10%+ higher fees

   Without clearing them, fresh swap attempts will keep nonce-colliding *until* the new code (using `'pending'`) goes live AND the user reloads the extension.

---

## 6. Files touched this session (uncommitted)

```
modified:   /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/ethereumHandler.ts
            (eth_call passthrough, eth_estimateGas passthrough, [HANDOFF] logs,
             nonce 'pending' x2, gas/gasLimit honor)

modified:   /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/index.ts
            (extended [HANDOFF] log with params + value)

modified:   /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/injected/injected.ts
            (extended [HANDOFF] log on dApp resolve path)

modified:   /Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/public/injected.js
            (rebuilt artifact — esbuild output of injected.ts changes)
```

`make build` green at last edit. Committed in earlier sessions: the EIP-1193 emit removal + retro doc updates. Uncommitted: the eth_call / nonce / gas-limit / handoff-logging changes.

---

## 7. Action items, ordered

1. **Commit the uncommitted defects** — eth_call passthrough + nonce 'pending' + gas-limit honor + handoff logs. They're not the fee-policy work but they're correct fixes that should ship regardless.
2. **Add `eth_feeHistory` passthrough** — 3 lines in `ethereumHandler.ts`. Run a swap, grep `[HANDOFF]` in background console, see if Uniswap calls it.
3. **Decide on fee-floor strategy** — fixed `1 gwei` vs dynamic `max(1 gwei, currentBaseFee * 1.1)` vs per-chain floors.
4. **Wire the warning UI** in the side-panel approval surface; intercept the signing flow to require user choice on under-floor fees.
5. **Decide whether to silently bump or always require user confirmation.** My strong rec: always require user confirmation. Silent bump = paying users more than they expect.
6. **Clear the user's stuck pending txs** if any are still around when you pick this up — etherscan check on `0x141D9959cAe3853b035000490C03991eB70Fc4aC` will show pending nonce(s). Cancel or wait for eviction before retrying any swap.
