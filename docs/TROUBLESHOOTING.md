# KeepKey Client Troubleshooting Guide

This document captures critical pain points, debugging strategies, and solutions for common issues encountered during development.

---

## Critical Issue: Transaction Signed with Wrong Address

### Symptom
- Transactions fail with "insufficient funds" error
- RPC returns "balance 0" even though wallet shows balance
- Error message: `Error: Insufficient funds for the transaction amount and gas fees`
- Generic error from Pioneer SDK: "didn't sign right"

### Root Cause
**Malformed data being sent to Pioneer SDK's `signTx` method:**

1. **Wrong function signature** - Calling `signTx({ caip, unsignedTx })` (one object) instead of `signTx(caip, unsignedTx)` (two parameters)
2. **Wrong chainId format** - Passing `chainId: 1` (number) instead of `chainId: '0x1'` (hex string)

### How It Manifests
When malformed data is sent to Pioneer SDK:
- SDK silently signs with a **different address** than the connected account
- Example: Connected account `0x141D9959cAe3853b035000490C03991eB70Fc4aC` has 0.026 ETH
- But transaction signed by `0xc6Ff068Ca10F9697F665c97af998F51E8c7C2395` which has 0 ETH
- RPC correctly rejects with "insufficient funds" for the **actual signer**

### Debugging Steps

#### 1. Verify Transaction Sender
Create a script to decode the signed transaction:

```javascript
import { ethers, Transaction } from 'ethers';

const signedTx = '0xf86d...'; // From logs
const tx = Transaction.from(signedTx);

console.log('Actual sender:', tx.from);
console.log('Expected sender:', '0x141D9959...');
console.log('Match:', tx.from === expectedSender ? '✅' : '❌');
```

#### 2. Check Pioneer SDK Call Signature
```typescript
// ❌ WRONG - One object parameter
await KEEPKEY_WALLET.signTx({ caip, unsignedTx });

// ✅ CORRECT - Two separate parameters
await KEEPKEY_WALLET.signTx(caip, unsignedTx);
```

#### 3. Verify chainId Format
```typescript
// ❌ WRONG - Number
const unsignedTx = { chainId: 1, ... };

// ✅ CORRECT - Hex string
const unsignedTx = { chainId: '0x1', ... };

// Fix before signing:
const txForSigning = {
  ...unsignedTx,
  chainId: typeof unsignedTx.chainId === 'number'
    ? '0x' + unsignedTx.chainId.toString(16)
    : unsignedTx.chainId
};
```

#### 4. Check Logs for Malformed Data
Look for these telltale signs in console logs:

```javascript
// Good - Parameters are separate
console.log('caip:', 'eip155:1/slip44:60');
console.log('unsignedTx:', { chainId: '0x1', ... });

// Bad - Parameters are nested in object
console.log('signTx params:', { caip: '...', unsignedTx: {...} });
```

### Solution
**File:** `chrome-extension/src/background/chains/ethereumHandler.ts:640-657`

```typescript
if (result.success && response.unsignedTx) {
  console.log(tag, 'FINAL: unsignedTx: ', response.unsignedTx);

  // Convert chainId from number to hex string if needed
  const txForSigning = {
    ...response.unsignedTx,
    chainId: typeof response.unsignedTx.chainId === 'number'
      ? '0x' + response.unsignedTx.chainId.toString(16)
      : response.unsignedTx.chainId
  };

  console.log(tag, 'txForSigning (chainId converted to hex):', txForSigning);

  // CRITICAL: signTx expects TWO separate parameters (caip, unsignedTx)
  // NOT an object { caip, unsignedTx }
  const signedTx = await KEEPKEY_WALLET.signTx(caip, txForSigning);
  console.log(tag, 'signedTx:', signedTx);
}
```

### Prevention
1. **Always check Pioneer SDK type definitions** before calling methods
2. **Never assume** the signature - the type definition CAN be wrong (it was in this case)
3. **Always decode signed transactions** during debugging to verify sender address
4. **Use TypeScript strict mode** to catch signature mismatches at compile time
5. **Add integration tests** that verify signed transaction sender matches expected address

### Related Documentation
- **Pioneer SDK Type Fix**: See `projects/pioneer/modules/pioneer/pioneer-sdk/src/index.ts:154`
- **Comprehensive API Guide**: See `projects/pioneer/e2e/transfers/e2e-transfer-suite/SIGNING_API_DOCUMENTATION.md`
- **All Chain Handlers Fixed**: `chrome-extension/src/background/chains/*.ts`

---

## Pain Point: Build Cache Issues

### Symptom
- Code changes don't appear in logs after rebuild
- Extension shows old behavior after `pnpm build`
- Console logs show old version numbers

### Root Cause
Turborepo cache can be stale, or dist folder not fully cleaned

### Solution

#### Quick Fix
```bash
rm -rf dist && pnpm build
```

#### Full Clean Rebuild
```bash
pnpm clean:bundle  # Removes dist, dist-zip, and clears Turbo cache
pnpm build
```

#### Verify Changes Deployed
Use version bumping strategy:

1. Bump version in `package.json`: `0.0.19` → `0.0.20`
2. Add obvious console log with emoji: `console.log('🚨 VERSION 0.0.20 FIX ACTIVE 🚨')`
3. Rebuild and check logs for new version/emoji
4. If not present, repeat clean rebuild

### Prevention
- Always run `rm -rf dist` before critical builds
- Use version numbers in console logs for verification
- Check `dist/manifest.json` version matches `package.json`

---

## Pain Point: Hardcoded Derivation Paths

### Symptom
- Transaction signed with account 0 instead of connected account
- Balance shown for one account, but transaction uses different account

### Example Issue
```typescript
// ❌ WRONG - Hardcoded to account 0
const input = {
  addressNList: [2147483692, 2147483708, 2147483648, 0, 0], // m/44'/60'/0'/0/0
  ...
};
```

### When This Is OK
If **ALL** your addresses use the same path (e.g., all at `m/44'/60'/0'/0/0`), hardcoding is fine.

### When This Is NOT OK
If you support multiple accounts with different derivation paths.

### Solution (If Needed)
```typescript
// Get addressNList from pubkey context
const pubkeyContext = KEEPKEY_WALLET.pubkeyContext;
if (!pubkeyContext?.addressNList) {
  throw Error('No pubkey context set');
}

const input = {
  addressNList: pubkeyContext.addressNList,  // ✅ Use dynamic path
  ...
};
```

---

## Pain Point: Generic SDK Error Messages

### Symptom
- Pioneer SDK returns vague errors: "didn't sign right"
- Errors like `TypeError: e.startsWith is not a function`
- No clear indication of what's wrong with the input

### Root Cause
Pioneer SDK doesn't validate input parameters thoroughly before processing

### Solution Strategy

1. **Log everything before SDK calls:**
```typescript
console.log('About to call signTx');
console.log('  caip:', caip, '(type:', typeof caip, ')');
console.log('  unsignedTx:', unsignedTx);
console.log('  unsignedTx field types:');
for (const [key, value] of Object.entries(unsignedTx)) {
  console.log(`    ${key}:`, typeof value, Array.isArray(value) ? '(array)' : '', value);
}
```

2. **Validate inputs manually:**
```typescript
// Validate caip is a string
if (typeof caip !== 'string') {
  throw Error(`caip must be string, got ${typeof caip}`);
}

// Validate chainId is hex string
if (typeof unsignedTx.chainId === 'number') {
  console.warn('chainId is number, converting to hex');
  unsignedTx.chainId = '0x' + unsignedTx.chainId.toString(16);
}
```

3. **Decode signed transactions to verify:**
```typescript
const tx = Transaction.from(signedTx);
if (tx.from !== expectedAddress) {
  throw Error(`Transaction signed by wrong address: ${tx.from} !== ${expectedAddress}`);
}
```

### Prevention
- Always validate inputs before calling SDK methods
- Add type guards for critical parameters
- Consider creating wrapper functions that validate before calling SDK

---

## Pain Point: Data Structure Mismatches

### Symptom
- Fields are swapped (e.g., `to` contains amount, `amount` contains address)
- SDK receives wrong data types (string vs number vs hex string)

### Example from UX Layer
```javascript
// ❌ WRONG - Data swapped in UI layer
params[0] = {
  amount: { amount: '0x7d1bb46c...', denom: 'ETH' },  // Address in amount!
  recipient: '0.00762669'  // Amount in recipient!
}
```

### Solution
1. **Trace data flow from UI to background:**
   - Check what popup sends: `chrome.runtime.sendMessage({ method: 'transfer', params: [...] })`
   - Check what background receives: `console.log('params:', params)`
   - Verify field mapping at each step

2. **Add validation at boundaries:**
```typescript
function validateTransferParams(params: any) {
  if (!params[0]?.recipient?.startsWith('0x')) {
    throw Error(`Invalid recipient address: ${params[0]?.recipient}`);
  }
  if (typeof params[0]?.amount?.amount !== 'string') {
    throw Error(`Amount must be string, got ${typeof params[0]?.amount?.amount}`);
  }
  // ... more validation
}
```

3. **Use TypeScript interfaces:**
```typescript
interface TransferParams {
  recipient: string;  // Ethereum address (0x...)
  amount: {
    amount: string;   // Hex string (0x...)
    denom: string;    // 'ETH'
  };
  isMax: boolean;
  memo?: string;
}
```

---

## Pain Point: RPC vs SDK Balance Discrepancies

### Symptom
- SDK shows balance: `0.026463430824570919 ETH`
- RPC says balance: `0`
- Both are correct, but for **different addresses**

### Root Cause
- SDK queries balance for connected address
- Transaction signed with different address
- RPC correctly reports balance for **actual signer**

### Debugging Strategy

1. **Check which address SDK is querying:**
```typescript
console.log('SDK querying balance for:', KEEPKEY_WALLET.assetContext?.address);
console.log('Connected dApp address:', ADDRESS);
```

2. **Check which address signed the transaction:**
```typescript
const tx = Transaction.from(signedTx);
console.log('Transaction signed by:', tx.from);
```

3. **Verify all three match:**
```typescript
const sdkAddress = KEEPKEY_WALLET.assetContext?.address;
const connectedAddress = ADDRESS;
const signerAddress = Transaction.from(signedTx).from;

console.log('SDK address:', sdkAddress);
console.log('Connected address:', connectedAddress);
console.log('Signer address:', signerAddress);

if (sdkAddress !== connectedAddress || connectedAddress !== signerAddress) {
  console.error('❌ ADDRESS MISMATCH - Transaction will fail!');
}
```

### Solution
Ensure pubkey context is set before building/signing transactions:

```typescript
if (ADDRESS && KEEPKEY_WALLET.pubkeys) {
  const matchingPubkey = KEEPKEY_WALLET.pubkeys.find(
    pk => pk.address?.toLowerCase() === ADDRESS.toLowerCase()
  );

  if (matchingPubkey) {
    await KEEPKEY_WALLET.setPubkeyContext(matchingPubkey);
  }
}

// Now buildTx and signTx will use correct address
```

---

## Debugging Checklist for Transaction Signing Issues

- [ ] Verify `signTx` called with **TWO parameters**, not one object
- [ ] Verify `chainId` is **hex string** (e.g., `'0x1'`), not number
- [ ] Decode signed transaction and verify sender address matches expected
- [ ] Check SDK balance query address matches connected dApp address
- [ ] Check pubkey context is set before building transaction
- [ ] Verify no hardcoded derivation paths (if using multiple accounts)
- [ ] Clean rebuild (`rm -rf dist && pnpm build`) to eliminate cache issues
- [ ] Add version bump and emoji log to confirm new code deployed
- [ ] Trace data flow from UI → background → SDK for field mapping issues
- [ ] Log all parameter types before SDK calls to catch type mismatches

---

## Quick Reference: Pioneer SDK Transaction Flow

```typescript
// 1. Set asset context
await KEEPKEY_WALLET.setAssetContext({ caip: 'eip155:1/slip44:60' });

// 2. Set pubkey context (critical for correct address)
const matchingPubkey = KEEPKEY_WALLET.pubkeys.find(
  pk => pk.address?.toLowerCase() === ADDRESS.toLowerCase()
);
await KEEPKEY_WALLET.setPubkeyContext(matchingPubkey);

// 3. Build transaction
const unsignedTx = await KEEPKEY_WALLET.buildTx({
  caip: 'eip155:1/slip44:60',
  to: '0x7D1bb46c5D7453356d853565f68e62eE3CD0294F',
  amount: 0.001,
  feeLevel: 5
});

// 4. Convert chainId to hex if needed
const txForSigning = {
  ...unsignedTx,
  chainId: typeof unsignedTx.chainId === 'number'
    ? '0x' + unsignedTx.chainId.toString(16)
    : unsignedTx.chainId
};

// 5. Sign transaction (TWO parameters!)
const signedTx = await KEEPKEY_WALLET.signTx(caip, txForSigning);

// 6. Broadcast
const txHash = await KEEPKEY_WALLET.broadcastTx(caip, signedTx);
```

---

**Last Updated:** 2025-01-25
**Related Issues:** Transaction signing with wrong address, insufficient funds errors
**Status:** Resolved in commit a815786
