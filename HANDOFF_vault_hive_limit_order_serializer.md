# HANDOFF — vault: Hive `limit_order_create` / `limit_order_cancel` serializer

**Status:** firmware side DONE and merged-pending (PR #315). Vault side NOT started.
Until the vault change lands, Hive internal-market swaps still fail.

## The bug this closes

A dApp swap on the Hive internal market fails in the browser extension:

```
| handleWalletRequest | Error processing method hive_broadcast:
Error: Operation not in the KeepKey clear-sign table (got limit_order_create)
```

Three layers had to know the op. Two are now done:

| layer | file | state |
|---|---|---|
| Client gate | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/hiveHandler.ts` (`SUPPORTED_OPS`) | ❌ still missing |
| Vault serializer | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault/src/bun/txbuilder/hive-ops.ts` | ❌ **this handoff** |
| Firmware clear-sign | `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-firmware-consolidated/lib/firmware/hive.c` | ✅ PR #315 |

## What the firmware now accepts

The parser is authoritative — match it byte-for-byte or the device rejects.

### `limit_order_create` (op id 5), **active** tier

```
varint(5)
str(owner)                       1..16 bytes
u32le(orderid)
asset(amount_to_sell)            HIVE or HBD, must be > 0
asset(min_to_receive)            HIVE or HBD, must be > 0, symbol MUST differ from amount_to_sell
u8(fill_or_kill)                 exactly 0 or 1 — any other byte is rejected
u32le(expiration)                unix seconds
```

### `limit_order_cancel` (op id 6), **active** tier

```
varint(6)
str(owner)                       1..16 bytes
u32le(orderid)
```

### Asset encoding (already implemented — reuse `asset()` in `hive-ops.ts`)

16 bytes: `int64le(amount)` + `u8(precision)` + 7-byte NUL-padded symbol.
HIVE/HBD precision 3, VESTS precision 6. Firmware rejects a symbol/precision
mismatch and rejects negative amounts.

## Firmware-side rejections to mirror host-side (fail fast with a better message)

- same symbol on both sides of the order → `"Hive tx: order symbols must differ"`
- either amount zero → `"Hive tx: amount must be greater than zero"`
- `fill_or_kill` not 0/1 → `"Hive tx: malformed operation"`
- mixing these (active tier) with posting-tier ops in one tx → `"Hive tx: mixed posting/active ops"`

## Suggested implementation

In `hive-ops.ts`, add to the `serializeOp` switch alongside the existing ops:

```ts
const OP_LIMIT_ORDER_CREATE = 5
const OP_LIMIT_ORDER_CANCEL = 6

case 'limit_order_create': {
  const sell = positiveAsset(p.amount_to_sell, ['HIVE', 'HBD'], 'limit_order_create amount_to_sell')
  const recv = positiveAsset(p.min_to_receive, ['HIVE', 'HBD'], 'limit_order_create min_to_receive')
  // firmware refuses a same-symbol pair; reject here for a clearer error
  if (sell.subarray(9, 16).equals(recv.subarray(9, 16))) {
    throw new Error('limit_order_create: sell and receive symbols must differ')
  }
  return {
    bytes: Buffer.concat([
      varint(OP_LIMIT_ORDER_CREATE),
      str(p.owner),
      u32(Number(p.orderid), 'limit_order_create orderid'),
      sell, recv,
      boolByte(p.fill_or_kill, 'limit_order_create fill_or_kill'),
      u32(Number(p.expiration), 'limit_order_create expiration'),
    ]),
    tier: 'active',
  }
}

case 'limit_order_cancel':
  return {
    bytes: Buffer.concat([
      varint(OP_LIMIT_ORDER_CANCEL),
      str(p.owner),
      u32(Number(p.orderid), 'limit_order_cancel orderid'),
    ]),
    tier: 'active',
  }
```

Then add both names to `SUPPORTED_OPS` in `hiveHandler.ts` and give each an
`opSummary()` line for the side-panel approval.

## Gotchas

- `expiration` is a unix timestamp. The device has **no RTC** and cannot
  sanity-check it — the host is the only place this can be bounded. hived
  requires `expiration > now` and `<= now + 28 days`; enforce that host-side
  or users will sign orders that the chain rejects.
- `orderid` is caller-chosen and must be unique per account among open orders.
  Reusing a live id is rejected on-chain.
- These are **active**-tier ops. They cannot share a transaction with
  posting-tier ops (vote, comment, comment_options, claim_reward_balance) —
  one signature can't satisfy both post-HF28. Firmware enforces this too.

## Verification

Firmware unit tests covering this exact wire format are in
`/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-firmware-consolidated/unittests/firmware/hive.cpp`
(`Hive.LimitOrderCreateRetainsEveryDisplayedField`,
`Hive.LimitOrderRejectsDegenerateOrders`, `Hive.LimitOrderCancelParses`).
Mirror those vectors in the vault's `hive-ops.test.ts` to confirm the two
serializers agree before touching a device.

Requires firmware >= the release cut from PR #315.
