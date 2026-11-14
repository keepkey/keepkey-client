# Handoff: native sends are built by KeepKey Desktop, not a server

Replaces the `/buildTx` notes in `HANDOFF_pioneer_gateway_cutover.md` (§2 line 34, §3.9, §4).

## What changed

Owner decision 2026-11-13: no server builds transactions. Servers only supply chain data (UTXOs, fee rates, account info).

- **Before (0.0.39):** 10 handlers POSTed `{caip,to,amount,feeLevel:5,isMax,pubkeys}` to `https://api.keepkey.info/api/v1/buildTx`. That route never existed on any server, so it returned 404 and BTC, BCH, LTC, DOGE, DASH, ATOM, OSMO, RUNE, CACAO and XRP sends were all broken.
- **Now:** the 10 handlers make one call to `chains/buildViaDesktop.ts`.
  - It runs `POST http://localhost:1646/api/v2/tx/build` with the pairing key and `X-KeepKey-Device-Access: foreground`, through the existing `readFromVault` helper.
  - The body is `{caip, to, amount?, isMax, memo?, accountIndex?}`. No pubkeys, xpubs or fee level are sent: Desktop picks the sender keys, UTXOs, change and fee itself.
  - Desktop answers `{signRoute, signBody, summary}`. The approval event stores `unsignedTx = signBody` and `summary`. After approval the handler calls `signViaVault(build.signRoute, build.signBody)` with exactly what Desktop built. The `{...unsignedTx, coin}` spreads are gone.
  - `memo` from the Send form is forwarded now. It used to be dropped.
    - Cosmos family: it becomes the tx memo.
    - XRP: a digits-only memo becomes the destination tag.
    - UTXO: Desktop refuses a memo with `MEMO_UNSUPPORTED` in v1.
- **Approval UI:** the Tendermint card shows `summary.amount`/`summary.fee` plus the symbol. The old hard-coded ÷1e8 was wrong for ATOM/OSMO (6 decimals) and CACAO (10), and showed 0 fee for RUNE/CACAO. The UTXO and XRP cards read fields that are still in `signBody`, so they are unchanged.
- **Removed:** `wallet.getSendPubkeys`/`getAccountPubkeys`. They had no other callers.

## Behaviour notes

- **dApp transfers with no `accountIndex`:** Desktop uses account 0. BTC used to aggregate accounts 0-3. It never shipped, because the route was 404.
  - BTC: account N is Desktop's BTC account N, using Desktop's selected script type.
  - Other chains: only account 0. A non-zero index gets a 400 `ACCOUNT_UNSUPPORTED`; Desktop never silently spends account 0.
- **Fee level:** BEX has no fee picker, so Desktop uses its own "average" level.

### Errors shown to the user

| Desktop response | BEX shows |
|---|---|
| 404 (Desktop too old) | `Update KeepKey Desktop to send <Chain> from the extension` |
| 423 | the existing locked-device message |
| 401 / 403 | a re-pair message |
| 400 / 409 / 422 / 501 / 503 | Desktop's `error` text as-is |
| Connection refused | the existing "KeepKey Vault is not running" message |
| Timeout | a timeout error |

## Required KeepKey Desktop version

You need the first Desktop release that contains `POST /api/v2/tx/build`. It is on branch `feat/rest-tx-build` in keepkey/keepkey-vault, which was not merged when this was written. develop is 1.6.12, so expect **1.6.13 or later**. Desktop 1.6.12 and older answer 404, which BEX turns into the update message above.

## Not fixed here (blocks real sends end to end)

- **Broadcast for cosmos-family and XRP** still posts `signedTx.serializedTx || signedTx`, which is an object. Per gateway handoff §3.3 it must post:
  - cosmos family: `signedTx.serialized` (base64)
  - XRP: `signedTx.value.signatures[0].serializedTx`

  UTXO hex is fine.
- **Tron** is still built server-side by TronGrid (`tronHandler.ts`).

## How to verify

1. Automated:
   - `make test`: `chains/buildViaDesktop.test.ts` covers request mapping and every error row. `chains/no-server-build.test.ts` is a static guard: no `api/v1/buildTx` call, every handler signs `build.signRoute`/`build.signBody`, and no `coin` spread.
   - Then `make type-check`, `make lint`, `make build`.
2. Manual (owner, with Desktop built from `feat/rest-tx-build` running on :1646 and the extension paired):
   - From the side panel, send a small amount of LTC, then ATOM, then XRP with a destination-tag memo.
   - Check the approval card shows Desktop's amount and fee, and that the KeepKey Desktop sign card matches.
   - Against Desktop 1.6.12, a send should show "Update KeepKey Desktop to send Litecoin from the extension".
