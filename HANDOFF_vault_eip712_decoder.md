# HANDOFF → vault: EIP-712 decoder shows values the hasher does not sign

**From:** keepkey-client, branch `feat/permit-clear-sign` (permit clear-sign in the side-panel, 2026-09-17)
**Vault tree:** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/projects/keepkey-vault`
**Files:** `src/bun/eip712-decoder.ts`, its caller in `src/bun/rest-api.ts` (the `/eth/sign-typed-data` preview, `decodeEIP712(preview.typedData)`), `src/shared/types.ts` (`EIP712DecodedInfo`), `src/mainview/components/device/SigningApproval.tsx` (`typedDataDecoded`)
**Reference implementation (client):** `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-client/chrome-extension/src/background/chains/evmTypedData.ts` and its tests, `evmTypedData.test.ts`, in the same folder. It is a pure module with no imports, so it can be copied as-is.

No vault code was changed. This doc is the request.

## Why it matters

`ethSignTypedData` in hdwallet-keepkey
(`/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/hdwallet/packages/hdwallet-keepkey/src/ethereum.ts`)
sends `EthereumSignTypedHash` for everything except x402 EIP-3009. The device
shows two hashes. The vault's SigningApproval card and the client's side-panel
card are the only places a user can read a Permit / Permit2 before approving it.
If a decoder shows a friendlier value than the one that gets hashed, the user
reads one thing and signs another.

## What `eip712-decoder.ts` does today

1. **It classifies by field names, not by type definitions.** ERC-2612 matches
   any `Permit` whose type contains `owner`, `spender`, `value` and `deadline`.
   DAI matches on `holder` and `allowed`. Permit2 matches on address +
   `primaryType` without checking `types` at all. A `Permit` with an extra
   field, a different field type, or a different order has a different typehash
   from the token's. It still gets `isKnownType: true`, and SigningApproval
   turns that into `trustLevel = 'verified'` (around SigningApproval.tsx:818).
2. **It does not scale amounts.** `formatValue(..., 'amount')` returns the raw
   integer string. `1234560000` USDC reads as 1.2 billion, not 1,234.56. Nothing
   flags `2^160-1` / `2^256-1` as unlimited.
3. **It reads values with `String()` / `Number()`, not the way the hasher
   does.** For example, `' 0x10 '` is hashed as 16 but shown as-is. DAI
   `allowed: 'false'` is shown as "false", but the hasher throws on it (see
   below). An `expiry` of 0 means "no deadline" for DAI and "this block only"
   for a Permit2 allowance, yet it renders as a bare `0`.
4. **It reads domain values from JSON keys, not hashed fields.**
   `domain.chainId` is shown (and copied into `signingInfo.chainId` in
   rest-api.ts) even when `types.EIP712Domain` doesn't include it, so it isn't
   hashed and binds nothing. The same applies to `verifyingContract`.
5. **Generic rendering looks at the top level only.** `genericExtract` walks
   `types[primaryType]` one level deep and `JSON.stringify`s nested structs. It
   never lists JSON keys that aren't in `types`. Those keys are not signed, and
   they are exactly where a decoy goes (`recipientName: "Your wallet"`).
6. **The labels imply the wrong expiry.** "Deadline" on an ERC-2612 / DAI
   permit is when the *signature* stops being usable. The allowance it creates
   never expires; it lasts until revoked.

## Hasher semantics the decoder must mirror

Probed against the vault's installed `eip-712` 1.0.0 + `@findeth/abi` 0.3.1
(`node_modules/eip-712/lib/cjs/eip-712.js`,
`node_modules/@findeth/abi/lib/cjs/parsers/{array,number,address}.js`):

- **Integers:** `BigInt(value)`, then a range check for the declared width. So
  `' 12 '`, `'+12'`, `'0xc'`, `'0X0C'`, `'0o14'`, `'0b1100'` and `12` all hash
  as 12. `''` and `[]` hash as 0. `'1e3'`, `1.5` and negative uints throw.
- **bool:** goes through the **same integer path**. `getParser` returns the
  number parser for `type === 'bool'`, and `encodeBoolean` is never reached.
  `true`/`1`/`'1'` → 1. `false`/`0`/`'0'`/`''` → 0. `2` → 2, which no
  contract's bool can equal. `'true'`/`'false'` throw. **This is not JS
  truthiness**, so DAI `allowed: '0'` is a revoke, not an unlimited approval.
- **address:** only `value.length === 42` is checked. After that, the 40 hex
  chars after *any* two-character prefix are written, stopping at the first
  non-hex char. `'ab' + 40 hex` hashes like `'0x' + 40 hex`. The client accepts
  only `/^0[xX][0-9a-fA-F]{40}$/` and treats anything else as undecodable.
- **bytesN / bytes:** bytesN strips a lowercase `0x`, decodes hex with
  `Buffer.from(s, 'hex')` (which stops at the first non-hex char and drops an
  odd nibble), right-pads, and throws past N bytes. So `'Only to my own wallet'`,
  `'0X' + 64 hex` and `' 0x' + 64 hex` all hash as `bytes32(0)`, and `'0xabc'`
  as `0xab00…`. Dynamic `bytes` strips a lowercase `0x` and throws on anything
  but even-length hex. The client accepts only `/^(0x)?([0-9a-fA-F]{2})*$/`
  (at most N bytes for bytesN), shows bytesN right-padded as encoded, and
  marks everything else invalid (undecodable inside a permit or its witness).
- **Type resolution:** `T[..]` is an array. Otherwise, if `types[T]` exists, T
  is a struct, even when it is named `uint256`. Otherwise it's elementary.
- **Type names:** the typehash (`getDependencies`) follows only the types
  that fields refer to, and looks each struct up by its name minus one
  trailing `[..]`. That is hdwallet's `patches/eip-712+1.0.0.patch` (53096450,
  for Hyperliquid's `HyperliquidTransaction:ApproveAgent`). Vaults built
  before it use the leading `\w+` of the name. The values are encoded with the
  fields of the *full* name (`encodeData`: `types[type]`). So a definition
  nothing refers to, such as `types.bool = []`, changes nothing, and
  `primaryType: 'PermitSingle[]'` (`getStructHash` has no array handling), or
  on an older vault `'PermitSingle:Claim'`, signs as the canonical
  `PermitSingle` while its own fields can be called `rewardToken` /
  `rewardAmount`.
- **Nested arrays (a bug in that patch, see requested change 5):** stripping
  *one* trailing `[..]` turns `OrderComponents[2][2]` into
  `OrderComponents[2]`, which `types` doesn't define, so `getDependencies`
  treats it as elementary and leaves `OrderComponents`, `OfferItem` and
  `ConsiderationItem` out of the typehash. Seaport's `BulkOrder{tree:
  OrderComponents[2][2]}` (a bulk listing, tree height 1 to 24) then hashes
  as `d1e5e4b9…` with typehash text `BulkOrder(OrderComponents[2][2] tree)`.
  ethers' `TypedDataEncoder` and the unpatched eip-712 (leading `\w+`) both
  give `df5d241b…`. So the signature covers the wrong digest and Seaport
  rejects it. The values that get encoded are still right, and so is the
  client card. Only the typehash is wrong.
- **Field names are free text:** the typehash text is `type name` pairs
  joined by `,` inside `Name(...)`, so a `,`, `(` or `)` in a name lets one set
  of fields spell another's typehash. Permit2 takes the witness part of that
  text from the caller at submit time, so
  `PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,uint256 witness,bytes32 extra)`
  hashes the same with fields `permitted`, `spender`, `nonce,uint256 deadline`,
  `witness` and `extra` as it does with the canonical six. Values then land one
  slot over (the "witness" value is Permit2's deadline), and the signature is a
  valid unlimited transfer to whatever sits in `spender`.
- **What the client refuses** (-32602, before any approval): whitespace, `,`,
  `(`, `)`, `[` or `]` in a `primaryType` or `types` key (field types may add
  `[n]` suffixes). It also refuses a type name whose leading `\w+` is another
  `types` key, a `,`, `(` or `)` in a field name, and any name over 256
  characters. Keep the regexes start-anchored and linear: a
  strip-the-suffix-then-test regex is quadratic, and the page picks the string.
- **Domain:** hashed with `types.EIP712Domain` when that is an array. Otherwise
  it uses the canonical keys present in `domain` (`withEip712DomainType`).
  Unknown domain keys fail the strict superstruct check, so signing throws.

The bool and address behaviour could be treated as a hasher bug (eth-sig-util
would not sign `'0'`-as-false). Changing it would change signatures, though, so
the decoder should mirror the hasher as it is today.

## Requested changes

1. **Strict type matching.** Classify a permit only when `types[primaryType]`
   and its nested structs *exactly* match the canonical lists (same names, types
   and order), and none of the elementary types the canonical fields use is
   redefined as a struct. A definition no field refers to is not hashed, so it
   must not turn detection off (`types.bool = []` beside a real permit is
   still that permit). Refuse the names listed above:
   - ERC-2612 `Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)`, token = hashed `verifyingContract`
   - DAI `Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)`
   - Permit2 `PermitSingle` / `PermitBatch` with `PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)`
   - Permit2 `PermitTransferFrom` / `PermitBatchTransferFrom` with `TokenPermissions(address token,uint256 amount)`, plus the `*WitnessTransferFrom` variants (the canonical four fields plus exactly one witness field)

   Permit2 kinds also require the hashed `verifyingContract` to be
   `0x000000000022D473030F116dDEE9F6B43aC78BA3`. If the payload claims Permit2
   (by name or primaryType) at another well-formed address, show the raw
   fields with a caution. zkSync Era deploys Permit2 elsewhere, so only add
   that address once it's verified against Uniswap's official deployment list.
   If the types are canonical but a value can't be read, **don't fall back
   quietly**. Show "Token approval KeepKey could not decode — treat as
   UNLIMITED". Do the same for anything that claims Permit2 at the canonical
   address, or with no readable hashed address, and doesn't decode, whatever
   its types look like: the witness suffix is the caller's.
   `isKnownType` / `trustLevel: 'verified'` should mean only this strict match.
2. **Decimals scaling.** Resolve `decimals()` (and a sanitized `symbol()`: strip
   `\p{Cc}\p{Cf}`, trim, cap at 16 chars) from the chain the permit is bound to.
   Format with exact BigInt math and thousands separators. Show `UNLIMITED` for
   amounts ≥ 2^128−1 (and DAI `allowed` = 1). **Never default to 18.** If
   decimals are unknown or > 36, show the raw integer and say "decimals unknown".
   Always show the full token address and the raw integer under the amount.
3. **Type-walked rendering.** Build the field list from `types` (recursing into
   structs and arrays), for the message *and* for the effective
   `EIP712Domain`. List JSON keys that aren't in `types` separately as "Not
   signed (ignored)". Read chain binding and `verifyingContract` from hashed
   fields only. Warn "no chain binding" when `chainId` isn't hashed, and warn
   when the hashed chain differs from the connected one (compare as BigInt, so
   `'0x89'` equals `137`).
   Bound the walk: the hasher accepts a struct that repeats a field name, and
   walking every copy lets a ~250-byte payload grow to k^depth nodes. Mark a
   repeated name instead of walking it again, and cap the total nodes and
   ignored keys (the client uses 2,000 and 200) with a visible "cut off"
   caution. Read each struct's def list once per walk, not on every visit: a
   huge list of non-field entries is cheap to send and costly to re-filter. A permit that hits the node budget or the depth cap is
   undecodable, because part of what is signed is not shown. The ignored-key
   cap only adds the caution: ignored keys are not signed.
   Tell "not hashed" apart from "hashed but unreadable". A `verifyingContract`
   the domain hashes that is not a clean address is still signed:
   `'0x…5678zz'` passes the strict domain schema (`/^0x[0-9a-z]{40}$/i`) and
   hashes as `'0x…567800'`, a real contract and trivial to grind with
   CREATE2. Show it as "Unreadable: <value as sent>", never "Not signed", and
   raise a danger whenever any hashed domain field can't be read. The same
   goes for a `salt` like `'0x' + 'gg'×32`, which hashes as `bytes32(0)`.
   For the Permit2 `*WitnessTransferFrom` kinds, point at the witness (the
   fifth field, whose type the caller picks). It holds the terms the spender
   acts on, such as a UniswapX order's outputs and recipients, and no summary
   row shows them. The client adds a caution naming the witness type and opens
   the field tree by default.
4. **Honest time labels.** ERC-2612 / DAI: "Allowance: until revoked" plus "Must
   be submitted by <deadline>" (DAI `expiry` 0 = no deadline). Permit2
   allowance: per-token "Allowance expires" (0 = only in the submitting block)
   plus "Must be submitted by <sigDeadline>". SignatureTransfer: "Transfer
   deadline".
5. **Fix nested-array typehashes in hdwallet's eip-712 patch** (the signer,
   not the decoder):
   `/Users/highlander/WebstormProjects/keepkey-stack/projects/keepkey-vault-v11/modules/hdwallet/patches/eip-712+1.0.0.patch`,
   `getDependencies` in both `lib/cjs/eip-712.js` and `lib/es/eip-712.js`.
   Strip *every* trailing `[..]`, not one. The patch's `isValidType` already
   recurses, so it handles nested arrays. Use a linear form such as
   `const i = type.indexOf('['); const actualType = i === -1 ? type : type.slice(0, i);`.
   Don't use `type.replace(/(\[[0-9]*\])+$/, '')`: it backtracks
   quadratically on a page-chosen type string (`'[1]'.repeat(20000) + 'x'`,
   60 KB, took 1.6 s in node). This changes signatures only for types with
   nested arrays, which sign a non-standard digest today. Repro:
   `types: { BulkOrder: [{ name: 'tree', type: 'Item[2][2]' }], Item: [{ name: 'a', type: 'uint256' }] }`.
   `encodeType(td, 'BulkOrder')` must return
   `BulkOrder(Item[2][2] tree)Item(uint256 a)`. Today the `Item(...)` part is
   missing. Once the fix ships, update the "name minus one trailing [..]"
   note in the header of the client's `evmTypedData.ts`.

## Verify

- The test vectors in `evmTypedData.test.ts` (path above) are the acceptance
  set. The "hashes identically" cases were confirmed against the vault's own
  `getStructHash`. Key cases:
  - Uniswap-style unlimited PermitSingle → UNLIMITED, danger
  - `'1234560000'` at 6 decimals → `1,234.56`
  - `0X`-prefixed / whitespace-padded / `0x` / `0o` / `+` spellings → same summary as the canonical payload
  - Permit2 lookalike at another address → generic + caution
  - `allowed: '0'` → revoke; `allowed: 'false'` → undecodable
  - `domain.chainId` present but not in `EIP712Domain` → "no chain binding", no mismatch
  - decoy JSON keys → listed as not signed
  - `2^128-2` → finite; `2^128-1` → UNLIMITED
  - a real permit plus an unused `types.bool = []` → still that permit
  - `primaryType: 'PermitSingle-Claim'` / `'Permit Reward'` / `'Permit:Reward'`
    (beside `Permit`) / `'Permit[]'` / `'PermitSingle[]'` → refused
  - Hyperliquid `HyperliquidTransaction:ApproveAgent` / `:UsdSend` → accepted, generic
  - a witness transfer with a field named `nonce,uint256 deadline` or
    `permitted,address spender` → refused by the extractor, and undecodable
    (danger) in the summary even without that check
  - text, `0X…` or odd-length hex in a bytes32 witness field → undecodable
  - a SafeTx whose hashed `verifyingContract` ends in `zz` → contract shown
    as unreadable (not "Not signed"), danger
  - a witness transfer → decoded, plus a caution naming the witness type
- In the vault UI, a `Permit` with one extra field must no longer show as
  "verified".
- After change 5: Seaport `BulkOrder` (`OrderComponents[2][2]`) hashes as
  ethers' `TypedDataEncoder` does (`df5d241b…`), not `d1e5e4b9…`.
