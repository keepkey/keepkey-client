# Handoff → Pioneer: user-submitted custom EVM network discovery

**From:** keepkey-client (browser extension)
**Date:** 2026-06-22
**Goal:** Let users add an arbitrary EVM network (e.g. Base Sepolia, eip155:84532) and have Pioneer *learn* it, so portfolio/price/token data works for everyone instead of every client carrying its own RPC.

## Why

Today keepkey-client supports custom networks **client-side only**:

- Add Network modal (`pages/side-panel/src/components/header/AddNetworkModal.tsx`) → user types chainId, name, RPC, symbol, explorer.
- Stored locally via `ADD_CUSTOM_EVM_NETWORK` (`chrome-extension/src/background/index.ts:1489`) into `customEvmNetworksStorage` + `blockchainDataStorage`.
- Pioneer's `/api/v1/portfolio` doesn't know the chain, so balances are filled by a **direct RPC enrichment fallback** (`index.ts:497-539`) using the user's entered RPC.

Limitations of client-only:
- No USD pricing (Pioneer is the price/token-metadata source; custom chains get `valueUsd: '0'`).
- No token discovery (only native balance via `eth_getBalance`).
- Every client re-enters the same chain; failures are silent ($0.00).

We want **belt-and-suspenders**: keep the local fallback, AND push the chain to Pioneer so it becomes first-class.

## Ask from Pioneer

A submission endpoint + discovery pipeline:

### 1. `POST /api/v1/networks/submit`
Body (matches what the client already collects):
```json
{
  "networkId": "eip155:84532",
  "chainId": 84532,
  "name": "Base Sepolia Testnet",
  "symbol": "ETH",
  "rpc": "https://sepolia.base.org",
  "explorerUrl": "https://sepolia.basescan.org",
  "caip": "eip155:84532/slip44:60",
  "submittedBy": "<optional device pubkey / anon id>"
}
```

Pioneer should:
1. **Validate**: dial the RPC, call `eth_chainId`, assert it equals the claimed `chainId`. Reject mismatch.
2. **De-dupe** by `networkId`. If known, no-op (optionally merge a healthier RPC).
3. **Enrich server-side**: probe for native decimals/symbol, attach a price feed if one exists (CoinGecko platform id lookup by chainId), enqueue token-list discovery.
4. **Persist** into the same registry that backs `/api/v1/portfolio` so the chain returns natively on next fetch.

### 2. Registry read path
Once accepted, `/api/v1/portfolio` should return the native (and tokens, when discovered) for that chain for any user holding it — no client RPC needed. The client's RPC fallback then only runs for not-yet-accepted chains.

### 3. Testnets
Base Sepolia is a **testnet** — value is $0 but balance is real. Pioneer should support a `testnet: true` flag so these are returned with `priceUsd: 0` but a correct native balance, not dropped.

## Client side (already done / to do)

Done:
- Local add + RPC enrichment fallback (`index.ts:497`).

To do (small, this repo):
- On `ADD_CUSTOM_EVM_NETWORK`, also fire `POST /networks/submit` to Pioneer (fire-and-forget; local fallback covers the gap until accepted).
- Surface RPC-failure on the native row instead of silent $0.00 (don't render a fake zero for an unreachable RPC).

## Validation snippet (server-side chainId check)

```bash
curl -s -X POST "$RPC" -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# result must == "0x" + claimedChainId.toString(16)
```
