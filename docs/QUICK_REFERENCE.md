# KeepKey Client - Quick Reference Card

## 🚀 Quick Start

### When Popup Shows Errors

1. **Check Device State**
   ```javascript
   chrome.runtime.sendMessage({ type: 'GET_KEEPKEY_STATE' }, console.log);
   // 0: unknown, 1: disconnected, 2: connected, 3: busy, 4: errored, 5: paired
   ```

2. **Check Pending Events**
   ```javascript
   chrome.storage.local.get('keepkey-requests', console.log);
   ```

3. **Check Last Error**
   ```javascript
   // After error logging implemented:
   chrome.storage.local.get('keepkey-error-logs', (logs) => {
     console.log(logs['keepkey-error-logs'][0]); // Most recent
   });
   ```

---

## 📋 Common Error Messages

| Message | Meaning | Solution |
|---------|---------|----------|
| `unrecognized address` | Device not paired | Restart device, reconnect |
| `device not found` | Device disconnected | Check USB connection |
| `timeout` | Network/RPC timeout | Check internet, try again |
| `insufficient funds` | Not enough balance | Check balance, reduce amount |
| `user rejected` | Rejected on device | Try again if mistake |
| `nonce` | Transaction conflict | Wait for pending txs |

---

## 🔧 Debug Commands

### Background Script Console
```javascript
// Force device check
await checkKeepKey();

// Get APP state
console.log(APP);

// Check balances
console.log(APP?.balances);

// Check pubkeys
console.log(APP?.pubkeys);

// Reinitialize
await onStart();
```

### Popup Console
```javascript
// Get current events
const events = await requestStorage.getEvents();
console.log(events);

// Clear all events
await requestStorage.clearEvents();

// Reload popup
window.location.reload();

// Restart extension
chrome.runtime.sendMessage({ type: 'RESET_APP' });
```

---

## 🏗️ File Locations

### Core Files
```
chrome-extension/src/background/
├── index.ts              # Main background script
├── methods.ts            # Request handler
├── keepkey.ts            # Device initialization
└── chains/
    ├── ethereumHandler.ts
    ├── bitcoinHandler.ts
    └── ...

pages/popup/src/
├── index.tsx             # Entry point
├── Popup.tsx             # Main component
└── components/
    ├── Events.tsx        # Event queue viewer
    ├── Transaction.tsx   # Transaction handler
    └── evm/              # EVM-specific UI
    └── utxo/             # UTXO-specific UI
    └── tendermint/       # Cosmos-specific UI

packages/storage/lib/
├── customStorage.ts      # Event storage
├── types.ts              # Type definitions
└── index.ts              # Exports

packages/shared/lib/hoc/
└── withErrorBoundary.tsx # Error boundary HOC
```

### Where to Add Improvements
```
Phase 1 (Critical):
  packages/shared/lib/components/ErrorFallback.tsx     [NEW]
  packages/shared/lib/utils/errorTransformer.ts        [NEW]
  packages/storage/lib/validation.ts                   [NEW]
  packages/shared/lib/hoc/withErrorBoundary.tsx        [MODIFY]

Phase 2 (Important):
  packages/shared/lib/hooks/useBackgroundMessage.ts    [NEW]
  chrome-extension/src/background/recovery.ts          [NEW]
  pages/popup/src/components/ErrorDisplay.tsx          [NEW]

Phase 3 (Enhancement):
  packages/storage/lib/errorStorage.ts                 [NEW]
  pages/popup/src/components/ErrorHistory.tsx          [NEW]
```

---

## 💬 Message Types

### Background → Popup
```typescript
// Transaction complete
{ action: 'transaction_complete', txHash: string }

// Transaction error
{ action: 'transaction_error', error: string }

// Device state changed
{ type: 'KEEPKEY_STATE_CHANGED', state: number }

// Asset context updated
{ type: 'ASSET_CONTEXT_UPDATED', assetContext: object }
```

### Popup → Background
```typescript
// User decision
{ action: 'eth_sign_response', response: { decision: 'accept'|'reject', eventId: string } }

// Get device state
{ type: 'GET_KEEPKEY_STATE' }

// Reset extension
{ type: 'RESET_APP' }

// Update event
{ type: 'UPDATE_EVENT_BY_ID', payload: { id: string, updatedEvent: object } }

// Execute recovery (proposed)
{ type: 'EXECUTE_RECOVERY', strategy: RecoveryStrategy }
```

---

## 🔍 Storage Keys

```javascript
// Pending approval events
'keepkey-requests': Event[]

// Approved, awaiting confirmation
'keepkey-approvals': Event[]

// Historical completed
'keepkey-completed': Event[]

// Current asset context
'keepkey-asset-context': AssetContext

// Current RPC provider
'web3-provider': ProviderInfo

// Enabled blockchains
'blockchains': string[]

// Custom added tokens
'customTokens': CustomToken[]

// Error logs (proposed)
'keepkey-error-logs': ErrorLog[]
```

---

## 🧪 Testing Commands

```bash
# Run all tests
pnpm test

# Run popup tests
pnpm -F @extension/popup test

# Run E2E tests
pnpm e2e

# Type check
pnpm type-check

# Lint
pnpm lint

# Build
pnpm build

# Dev mode
pnpm dev
```

---

## 🐛 Troubleshooting Checklist

### Popup Won't Open
- [ ] Check background script console for errors
- [ ] Verify KeepKey device connected (`GET_KEEPKEY_STATE`)
- [ ] Check pending events in storage
- [ ] Try `RESET_APP`

### Transaction Stuck
- [ ] Check if event in `keepkey-requests`
- [ ] Verify device not busy
- [ ] Check background console for errors
- [ ] Clear events and retry

### Errors Not Showing
- [ ] Check Transaction component mounted
- [ ] Verify message listener registered
- [ ] Look for race condition (message sent before listener)
- [ ] Check error boundary not catching silently

### Device Not Detected
- [ ] Check `http://localhost:1646/docs` responds
- [ ] Verify device unlocked and connected
- [ ] Try different USB port/cable
- [ ] Restart background script

---

## 🎯 Error Categories (Proposed)

```typescript
enum ErrorCategory {
  DEVICE = 'device',        // Hardware connection issues
  NETWORK = 'network',      // RPC/internet issues
  USER = 'user',            // User rejection/cancellation
  TRANSACTION = 'transaction', // Tx-specific errors
  SYSTEM = 'system',        // Extension/app errors
}
```

---

## 🔄 Recovery Strategies (Proposed)

```typescript
enum RecoveryStrategy {
  RELOAD_POPUP,       // Just reload popup window
  CLEAR_EVENTS,       // Clear pending events
  RESTART_APP,        // Reinitialize APP (no full reload)
  RECONNECT_DEVICE,   // Reset device connection
  RESET_PROVIDER,     // Switch to default RPC
  FULL_RESET,         // Nuclear option: chrome.runtime.reload()
}
```

---

## 📊 State Values

### KEEPKEY_STATE
```
0 = unknown       (Initial state)
1 = disconnected  (Device not found)
2 = connected     (Device detected)
3 = busy          (Processing request)
4 = errored       (Error occurred)
5 = paired        (Address available)
```

### Event Status
```
'request'    → Awaiting user approval in popup
'approval'   → User approved, awaiting device/tx
'completed'  → Transaction confirmed
```

### Transaction Type
```
'evm'        → Ethereum-based chains
'utxo'       → Bitcoin-like chains
'tendermint' → Cosmos ecosystem
'other'      → Ripple, etc.
```

---

## 🔗 Useful Links

- [Full Architecture Doc](./ERROR_HANDLING_SYSTEM.md)
- [Improvement Proposals](./ERROR_HANDLING_IMPROVEMENTS.md)
- [State Flow Diagrams](./POPUP_STATE_FLOW.md)
- [Main README](./README.md)
- [Project README](../README.md)

---

## 💡 Pro Tips

1. **Always check background console first** - Most errors originate there
2. **Use `GET_KEEPKEY_STATE` liberally** - Device state is key to debugging
3. **Clear events when stuck** - `requestStorage.clearEvents()`
4. **Check for race conditions** - Enable verbose logging to see message timing
5. **Validate events before storage** - Malformed events crash popup
6. **Use granular recovery** - Don't always `RESET_APP`
7. **Log errors to storage** - Makes debugging much easier

---

## 🚨 Red Flags

Watch out for these patterns in logs:

```javascript
// Race condition
"Message sent" (background) before "Listener registered" (popup)

// Malformed event
TypeError: Cannot read property 'includes' of undefined

// State desync
State = 'completed' but event still in requestStorage

// Message lost
No listener for action 'transaction_error'

// Nuclear reset
RESET_APP called for recoverable error
```

---

**Keep this card handy while developing!**

For detailed explanations, see the full documentation in this folder.
