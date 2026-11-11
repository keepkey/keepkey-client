# KeepKey Client 0.0.39

## Highlights

- ClearSign reports and clearer approval details for supported EVM typed data.
- Solana dApp transactions decoded before approval; improved EVM transaction review.
- Sign-In with Ethereum domain-binding checks and clearer origin info on approvals.
- More reliable account sync, device detection, and long-running signing flows
  (10-minute approval and signing budgets, queued approvals, Safe multi-sign).
- BEX stays connected while the device is locked and requests unlock on demand.
- Bitcoin honors the vault's script type, so dApps get the native SegWit address.
- Agent-facing BEX request/UI controls with shared approval safeguards.
- Password-bank autofill (Vault MVP).
- EIP-5792 `wallet_getCapabilities` per final spec; Robinhood Chain (eip155:4663).
- Sharp KeepKey and site logos on approval cards and wallet pickers.
- Dependency maintenance: `@scure/base`, Rollup, `ts-loader`.

## Included PRs

#135, #140, #141, #143, #144, #152, #154, #155, #156, #157, #158, #159
(eslint-plugin-react-hooks 7 held back), #160, #161, #162, #163, #164.
