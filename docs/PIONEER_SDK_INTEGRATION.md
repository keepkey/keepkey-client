# Pioneer SDK Integration Guide

Critical lessons learned from integrating Pioneer SDK into KeepKey Client browser extension.

---

## Overview

Pioneer SDK is the core library for blockchain interactions in the KeepKey ecosystem. This guide documents the **critical pain points** and **gotchas** encountered during integration.

---

## Critical Issue #1: Type Definitions Don't Match Implementation

### The Problem

**Pioneer SDK has a type definition mismatch** between declared interface and actual implementation.

**Type Definition** (`pioneer-sdk/src/index.ts:154`):
```typescript
public signTx: (unsignedTx: any) => Promise<any>;
```

**Actual Implementation** (`pioneer-sdk/src/index.ts:956`):
```typescript
this.signTx = async function (caip: string, unsignedTx: any) {
  // Implementation expects TWO parameters
  let signedTx = await txManager.sign({ caip, unsignedTx });
  return signedTx;
}
```

### The Impact

1. TypeScript won't catch the error at compile time
2. Calling `signTx({ caip, unsignedTx })` (one object) passes the entire object as the `caip` parameter
3. SDK's internal `classifyCaip(caip)` method tries to call `.startsWith()` on an object
4. Results in: `TypeError: e.startsWith is not a function`

### The Fix

**Always use TWO separate parameters:**

```typescript
// ❌ WRONG - One object parameter
const signedTx = await sdk.signTx({ caip, unsignedTx });

// ✅ CORRECT - Two separate parameters
const signedTx = await sdk.signTx(caip, unsignedTx);
```

### Affected Files

All chain handlers were fixed to use correct signature:
- `ethereumHandler.ts:655`
- `bitcoinHandler.ts:170`
- `litecoinHandler.ts:145`
- `dogecoinHandler.ts:158`
- `dashHandler.ts:158`
- `bitcoinCashHandler.ts:157`
- `rippleHandler.ts:120`
- `thorchainHandler.ts:120`
- `osmosisHandler.ts:128`
- `cosmosHandler.ts:128`
- `mayaHandler.ts:128`

### Prevention

1. **Don't trust type definitions** - always verify against actual implementation
2. **Test at runtime** - type definitions can be wrong
3. **Read the source code** - when in doubt, check the implementation
4. **Submit PR to Pioneer SDK** - fix the type definition upstream

---

## Critical Issue #2: ChainId Format Requirements

### The Problem

Pioneer SDK expects `chainId` as a **hex string**, but many sources provide it as a **number**.

```javascript
// What buildTx returns
{
  chainId: 1,  // ❌ Number
  nonce: '0x01a4',
  gasPrice: '0x06fc23ac00',
  ...
}

// What signTx expects
{
  chainId: '0x1',  // ✅ Hex string
  nonce: '0x01a4',
  gasPrice: '0x06fc23ac00',
  ...
}
```

### The Impact

When `chainId` is passed as a number:
- SDK may derive wrong parameters
- Transaction gets signed with incorrect chain-specific data
- Results in **transaction signed by wrong address**

### The Fix

**Always convert before signing:**

```typescript
const txForSigning = {
  ...unsignedTx,
  chainId: typeof unsignedTx.chainId === 'number'
    ? '0x' + unsignedTx.chainId.toString(16)
    : unsignedTx.chainId
};

const signedTx = await sdk.signTx(caip, txForSigning);
```

### Prevention

1. **Validate chainId format** in all transaction builders
2. **Convert early** - do conversion right after `buildTx`
3. **Add type guards** - validate before passing to SDK
4. **Test with multiple chains** - different chainIds expose the issue

---

## Critical Issue #3: Pubkey Context Must Be Set

### The Problem

Pioneer SDK maintains **two contexts**:
1. **Asset Context** - which blockchain/asset is active
2. **Pubkey Context** - which account/address to use

If pubkey context isn't set, SDK defaults to **account 0**, which may not be the connected dApp account.

### The Impact

```typescript
// Connected dApp account (has balance)
ADDRESS = '0x141D9959cAe3853b035000490C03991eB70Fc4aC';

// But SDK uses account 0 (no balance)
// Transaction signed by: 0xc6Ff068Ca10F9697F665c97af998F51E8c7C2395

// RPC correctly rejects: "insufficient funds"
```

### The Fix

**Always set pubkey context before building transactions:**

```typescript
// Set asset context
await KEEPKEY_WALLET.setAssetContext({ caip: 'eip155:1/slip44:60' });

// CRITICAL: Set pubkey context to match connected dApp account
if (ADDRESS && KEEPKEY_WALLET.pubkeys) {
  const matchingPubkey = KEEPKEY_WALLET.pubkeys.find(
    pk => pk.address?.toLowerCase() === ADDRESS.toLowerCase()
  );

  if (matchingPubkey) {
    console.log('Setting pubkey context to:', matchingPubkey.address);
    await KEEPKEY_WALLET.setPubkeyContext(matchingPubkey);
  } else {
    console.warn('No matching pubkey found for:', ADDRESS);
    // Transaction will likely fail with wrong address
  }
}

// Now buildTx and signTx will use correct account
const unsignedTx = await KEEPKEY_WALLET.buildTx({...});
```

### Prevention

1. **Always set pubkey context** before transaction operations
2. **Verify context** - log the address being used
3. **Handle missing pubkey** - warn if no match found
4. **Restore context** - re-set after context switches

---

## Critical Issue #4: Silent Failures with Generic Errors

### The Problem

Pioneer SDK often returns **generic error messages** that don't indicate the actual problem:

- `"didn't sign right"` - could mean wrong parameters, wrong format, wrong context, etc.
- `TypeError: e.startsWith is not a function` - actually means wrong function signature
- `"Insufficient funds"` - could mean wrong address is signing

### The Impact

**Debugging takes hours** because error messages don't point to root cause.

### The Fix

**Add comprehensive logging around SDK calls:**

```typescript
console.log('=== BEFORE SIGNING ===');
console.log('caip:', caip, '(type:', typeof caip, ')');
console.log('unsignedTx:', unsignedTx);
console.log('chainId type:', typeof unsignedTx.chainId);
console.log('pubkeyContext:', KEEPKEY_WALLET.pubkeyContext?.address);
console.log('assetContext:', KEEPKEY_WALLET.assetContext?.address);

// Log all field types
for (const [key, value] of Object.entries(unsignedTx)) {
  console.log(`  ${key}:`, typeof value, Array.isArray(value) ? '(array)' : '', value);
}

try {
  const signedTx = await KEEPKEY_WALLET.signTx(caip, unsignedTx);

  // Decode to verify sender
  const tx = Transaction.from(signedTx);
  console.log('=== AFTER SIGNING ===');
  console.log('Signed by:', tx.from);
  console.log('Expected:', ADDRESS);
  console.log('Match:', tx.from === ADDRESS ? '✅' : '❌');

  return signedTx;
} catch (error) {
  console.error('=== SIGNING FAILED ===');
  console.error('Error:', error);
  console.error('Check parameters above for type mismatches');
  throw error;
}
```

### Prevention

1. **Log everything** before and after SDK calls
2. **Validate inputs** manually before calling SDK
3. **Decode outputs** to verify correctness
4. **Create wrapper functions** that add validation and logging

---

## Best Practices for Pioneer SDK Integration

### 1. Always Set Context First

```typescript
// Set asset context
await sdk.setAssetContext({ caip: 'eip155:1/slip44:60' });

// Set pubkey context
const pubkey = sdk.pubkeys.find(pk => pk.address === ADDRESS);
await sdk.setPubkeyContext(pubkey);
```

### 2. Validate Before Calling

```typescript
function validateBeforeSign(caip: any, unsignedTx: any) {
  if (typeof caip !== 'string') {
    throw Error(`caip must be string, got ${typeof caip}`);
  }

  if (!caip.startsWith('eip155:') && !caip.startsWith('bip122:') && !caip.startsWith('cosmos:')) {
    throw Error(`Invalid caip format: ${caip}`);
  }

  if (typeof unsignedTx !== 'object') {
    throw Error(`unsignedTx must be object, got ${typeof unsignedTx}`);
  }

  if (typeof unsignedTx.chainId === 'number') {
    throw Error('chainId must be hex string, not number');
  }
}

validateBeforeSign(caip, txForSigning);
const signedTx = await sdk.signTx(caip, txForSigning);
```

### 3. Verify After Signing

```typescript
const signedTx = await sdk.signTx(caip, txForSigning);

// Decode and verify
const tx = Transaction.from(signedTx);

if (tx.from.toLowerCase() !== expectedAddress.toLowerCase()) {
  throw Error(
    `Transaction signed by wrong address!\n` +
    `Expected: ${expectedAddress}\n` +
    `Actual: ${tx.from}\n` +
    `Check pubkey context and unsignedTx parameters`
  );
}

return signedTx;
```

### 4. Use Wrapper Functions

```typescript
async function safeSignTx(
  sdk: any,
  caip: string,
  unsignedTx: any,
  expectedAddress: string
): Promise<string> {
  // Validate inputs
  if (typeof caip !== 'string') {
    throw Error(`caip must be string, got ${typeof caip}`);
  }

  // Convert chainId if needed
  const txForSigning = {
    ...unsignedTx,
    chainId: typeof unsignedTx.chainId === 'number'
      ? '0x' + unsignedTx.chainId.toString(16)
      : unsignedTx.chainId
  };

  // Log for debugging
  console.log('Signing with:', { caip, txForSigning });

  // Sign
  const signedTx = await sdk.signTx(caip, txForSigning);

  // Verify
  const tx = Transaction.from(signedTx);
  if (tx.from.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw Error(`Wrong signer: ${tx.from} !== ${expectedAddress}`);
  }

  return signedTx;
}
```

### 5. Handle Context Switches

```typescript
// Save current context
const previousContext = {
  asset: sdk.assetContext,
  pubkey: sdk.pubkeyContext
};

// Switch to new chain
await sdk.setAssetContext({ caip: newCaip });
await sdk.setPubkeyContext(newPubkey);

// Do work...

// Restore previous context
await sdk.setAssetContext(previousContext.asset);
await sdk.setPubkeyContext(previousContext.pubkey);
```

---

## Common Pitfalls

### ❌ Pitfall #1: Trusting Type Definitions
```typescript
// Type says one parameter, but implementation needs two!
public signTx: (unsignedTx: any) => Promise<any>;
```

**Solution:** Always verify against implementation, not types.

### ❌ Pitfall #2: Assuming Number/String Interchangeable
```typescript
// SDK expects hex strings, not numbers
chainId: 1  // ❌ Wrong
chainId: '0x1'  // ✅ Correct
```

**Solution:** Always use hex strings for chain-related values.

### ❌ Pitfall #3: Forgetting Pubkey Context
```typescript
// Without setPubkeyContext, SDK uses default (account 0)
await sdk.buildTx({...});  // ❌ Might use wrong account
```

**Solution:** Always set pubkey context before transactions.

### ❌ Pitfall #4: Not Verifying Signed Transactions
```typescript
const signedTx = await sdk.signTx(caip, unsignedTx);
// ❌ Didn't check if it was signed by correct address
```

**Solution:** Decode and verify sender matches expected address.

### ❌ Pitfall #5: Insufficient Logging
```typescript
try {
  return await sdk.signTx(caip, unsignedTx);
} catch (e) {
  console.error('Signing failed');  // ❌ Not enough info
}
```

**Solution:** Log inputs, outputs, contexts, and detailed errors.

---

## Testing Strategy

### Unit Tests
```typescript
describe('signTx', () => {
  it('should call with two parameters', async () => {
    const spy = jest.spyOn(sdk, 'signTx');
    await safeSignTx(sdk, caip, unsignedTx, ADDRESS);

    expect(spy).toHaveBeenCalledWith(caip, expect.any(Object));
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ caip }));
  });

  it('should convert chainId to hex', async () => {
    const unsignedTx = { chainId: 1, ... };
    await safeSignTx(sdk, caip, unsignedTx, ADDRESS);

    const callArgs = spy.mock.calls[0][1];
    expect(callArgs.chainId).toBe('0x1');
  });

  it('should verify signer matches expected address', async () => {
    const signedTx = await safeSignTx(sdk, caip, unsignedTx, ADDRESS);
    const tx = Transaction.from(signedTx);

    expect(tx.from.toLowerCase()).toBe(ADDRESS.toLowerCase());
  });
});
```

### Integration Tests
```typescript
describe('Full transaction flow', () => {
  it('should sign and broadcast successfully', async () => {
    // Set contexts
    await sdk.setAssetContext({ caip });
    const pubkey = sdk.pubkeys.find(pk => pk.address === ADDRESS);
    await sdk.setPubkeyContext(pubkey);

    // Build
    const unsignedTx = await sdk.buildTx({ caip, to, amount, feeLevel: 5 });

    // Convert chainId
    const txForSigning = {
      ...unsignedTx,
      chainId: typeof unsignedTx.chainId === 'number'
        ? '0x' + unsignedTx.chainId.toString(16)
        : unsignedTx.chainId
    };

    // Sign
    const signedTx = await sdk.signTx(caip, txForSigning);

    // Verify signer
    const tx = Transaction.from(signedTx);
    expect(tx.from).toBe(ADDRESS);

    // Broadcast
    const txHash = await sdk.broadcastTx(caip, signedTx);
    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
```

---

## Related Documentation

- **Comprehensive API Guide**: `projects/pioneer/e2e/transfers/e2e-transfer-suite/SIGNING_API_DOCUMENTATION.md`
- **Troubleshooting Guide**: `docs/TROUBLESHOOTING.md`
- **Pioneer SDK Source**: `projects/pioneer/modules/pioneer/pioneer-sdk/src/index.ts`

---

**Last Updated:** 2025-01-25
**Status:** Production-ready after fixes in commit a815786
