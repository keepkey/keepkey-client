# KeepKey Client - Error Handling & Popup System Architecture

## Overview

The KeepKey Chrome Extension uses a complex multi-layered architecture for handling wallet requests, signing transactions, and displaying errors. This document provides a comprehensive understanding of how errors flow through the system and when popups are shown.

---

## System Architecture

### High-Level Flow

```
DApp Request → Content Script → Background Script → Chain Handler → Popup
                                     ↓
                              Event Storage
                                     ↓
                              Popup UI → User Decision → KeepKey Device
                                     ↓
                          Transaction Complete/Error
```

---

## Component Breakdown

### 1. **Background Script** (`chrome-extension/src/background/index.ts`)

**Purpose**: Central orchestrator for all wallet operations

**Key Responsibilities**:
- KeepKey device connection monitoring (polls `http://localhost:1646` every 5s)
- Manages global `KEEPKEY_STATE` (unknown, disconnected, connected, busy, errored, paired)
- Routes wallet requests to chain-specific handlers
- Maintains APP instance (Pioneer SDK)
- Handles storage operations for balances, pubkeys, and asset context

**Error Handling**:
```typescript
// State changes trigger icon updates and push events
KEEPKEY_STATE = 4; // errored
updateIcon();
pushStateChangeEvent();
```

**Message Types**:
- `WALLET_REQUEST` → Routes to `handleWalletRequest()`
- `ON_START` → Initializes APP and fetches balances
- `RESET_APP` → Reloads extension (`chrome.runtime.reload()`)
- `GET_KEEPKEY_STATE` → Returns current device state

---

### 2. **Request Handler** (`chrome-extension/src/background/methods.ts`)

**Purpose**: Main request router and error transformer

**Flow**:
```javascript
handleWalletRequest(requestInfo, chain, method, params, APP, ADDRESS)
  ↓
  Chain-specific handler (ethereumHandler, bitcoinHandler, etc.)
  ↓
  Result or Error
```

**Error Transformation**:
```typescript
catch (error) {
  let errorMessage = JSON.stringify(error)
  if(errorMessage.indexOf('unrecognized address') >= 0){
      errorMessage = 'KeepKey State Invalid, please restart device!'
  }

  // Push error to popup
  chrome.runtime.sendMessage({
    action: 'transaction_error',
    error: errorMessage,
  });

  throw createProviderRpcError(4000, `Unexpected error processing method ${method}`, error);
}
```

**Provider RPC Errors**:
```typescript
createProviderRpcError(code: number, message: string, data?: unknown)
// 4200: Unsupported chain
// 4000: Unexpected error
// 4900: Provider not configured
```

---

### 3. **Chain Handlers** (e.g., `ethereumHandler.ts`)

**Purpose**: Chain-specific request processing and transaction building

**Key Features**:
- RPC failover mechanism with 5s timeout per RPC
- Failed RPC tracking with 1-minute cooldown
- Automatic provider rotation
- Event storage for approval flow

**Error Scenarios**:
1. **RPC Failures**: Tries all available RPCs, falls back gracefully
2. **Invalid Parameters**: Validates addresses, chain IDs, transaction data
3. **Insufficient Balance**: Checks before transaction
4. **Device Communication**: Handles KeepKey device errors

**Event Storage Flow**:
```typescript
// Create event for approval
const event = {
  id: requestInfo.id || uuidv4(),
  networkId,
  chain,
  type: method,
  request: params,
  status: 'request',
  timestamp: new Date().toISOString(),
};

await requestStorage.addEvent(event);
```

---

### 4. **Request Storage** (`packages/storage/lib/customStorage.ts`)

**Purpose**: Persistent event queue with lifecycle management

**Storage Structure**:
```typescript
type Event = {
  id: string;
  type: string; // e.g., 'eth_sendTransaction', 'personal_sign'
  request: any; // Original request params
  status: 'request' | 'approval' | 'completed';
  timestamp: string;
  networkId: string;
  chain: string;
  // ... additional metadata
};
```

**Event Lifecycle**:
1. **Request** → Stored in `requestStorage` (keepkey-requests)
2. **Approval** → Moved to `approvalStorage` (keepkey-approvals)
3. **Completed** → Moved to `completedStorage` (keepkey-completed)

**Storage Operations**:
- `addEvent(event)` - Adds new request
- `getEvents()` - Retrieves all events
- `updateEventById(id, updatedEvent)` - Updates status
- `removeEventById(id)` - Removes event
- `clearEvents()` - Clears all events

**Auto-Cleanup**: Events older than 10 minutes are automatically removed in `EventsViewer`

---

### 5. **Popup Window** (`pages/popup/src/`)

#### 5.1 **Entry Point** (`index.tsx`)

Simple wrapper with error boundary:
```typescript
<ChakraProvider theme={theme}>
  <ForceDarkMode>
    <Popup />
  </ForceDarkMode>
</ChakraProvider>

// Popup.tsx wrapped with:
withErrorBoundary(withSuspense(Popup, <div>Loading...</div>), <div>Error Occur</div>)
```

#### 5.2 **Error Boundary** (`packages/shared/lib/hoc/withErrorBoundary.tsx`)

**Issues Identified**:
- Generic error fallback: `<div>Error Occur</div>` with no details
- No error recovery mechanism
- No user-friendly error messages
- Logs to console but doesn't display to user

```typescript
componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  console.error(error, errorInfo);
  // ❌ Only logs, doesn't show user-friendly message
}
```

#### 5.3 **Events Viewer** (`components/Events.tsx`)

**Purpose**: Main popup controller that manages event queue

**Responsibilities**:
- Fetches events from `requestStorage` on mount
- Auto-removes events older than 10 minutes
- Shows spinner during loading
- Renders `<Transaction>` component for current event

**Issues**:
- No error state handling if `fetchEvents()` fails
- Silent failures when storage operations fail
- No retry mechanism for failed event fetches

```typescript
const fetchEvents = useCallback(async () => {
  setLoading(true);
  const storedEvents = await requestStorage.getEvents();
  // ❌ No try/catch - errors bubble up to error boundary

  const validEvents = [];
  for (const event of storedEvents) {
    const ageInMinutes = getEventAgeInMinutes(event.timestamp);
    if (ageInMinutes <= 10) {
      validEvents.push(event);
    } else {
      await requestStorage.removeEventById(event.id);
    }
  }

  setEvents(validEvents.reverse());
  setLoading(false);
}, []);
```

#### 5.4 **Transaction Component** (`components/Transaction.tsx`)

**Purpose**: Renders chain-specific transaction UI and manages approval flow

**State Management**:
```typescript
const [errorMessage, setErrorMessage] = useState<string | null>(null);
const [awaitingDeviceApproval, setAwaitingDeviceApproval] = useState<boolean>(false);
const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
const [showTxidPage, setShowTxidPage] = useState<boolean>(false);
```

**Message Listener**:
```typescript
useEffect(() => {
  const handleMessage = (message: any) => {
    if (message.action === 'transaction_complete') {
      setShowTxidPage(true);
      setTxHash(message.txHash);
      setAwaitingDeviceApproval(false);
    } else if (message.action === 'transaction_error') {
      const errorDetails = message.error || message.e?.message || JSON.stringify(message.e);
      setErrorMessage('Transaction failed: ' + errorDetails);
      setTransactionInProgress(false);
    }
  };

  chrome.runtime.onMessage.addListener(handleMessage);
  return () => chrome.runtime.onMessage.removeListener(handleMessage);
}, []);
```

**Error Display**:
```typescript
if (errorMessage) {
  return (
    <Alert status="error">
      <AlertIcon />
      <Flex height="100vh" alignItems="center" justifyContent="center">
        <div>
          <h3>Error Occurred</h3>
          <p>{errorMessage}</p>
          <Icon as={WarningIcon} color="red.500" />
          <Button onClick={handleCancel}>Retry</Button>
        </div>
      </Flex>
    </Alert>
  );
}
```

**Issues**:
- "Retry" button just calls `RESET_APP` (full extension reload)
- No granular error recovery
- Error messages can be cryptic JSON strings
- No error categorization (recoverable vs fatal)

---

## Error Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ DApp sends request via injected script                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Background Script: handleWalletRequest()                    │
│  - Validates chain and method                               │
│  - Routes to chain handler                                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Chain Handler (e.g., ethereumHandler)                      │
│  - Gets RPC provider with failover                          │
│  - Builds transaction                                       │
│  - Creates event in requestStorage                          │
│  - Opens popup window                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
           ┌──────────┴──────────┐
           │                     │
           ▼                     ▼
    ┌───────────┐         ┌───────────┐
    │  SUCCESS  │         │   ERROR   │
    └─────┬─────┘         └─────┬─────┘
          │                     │
          │                     ▼
          │           ┌────────────────────────────┐
          │           │ Error caught in            │
          │           │ handleWalletRequest()      │
          │           │                            │
          │           │ 1. Transform error message │
          │           │ 2. Send to popup:          │
          │           │    action: 'transaction_   │
          │           │            error'          │
          │           │ 3. Throw RPC error to DApp │
          │           └──────────┬─────────────────┘
          │                      │
          ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Popup Window Opens                                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ EventsViewer → Fetches from requestStorage          │   │
│  │   ↓                                                  │   │
│  │ Transaction Component                                │   │
│  │   ↓                                                  │   │
│  │ Chain-specific UI (EVM/UTXO/Tendermint/Other)       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Message Listener:                                          │
│   - 'transaction_complete' → Show success                   │
│   - 'transaction_error' → Show error alert                  │
└─────────────────────────────────────────────────────────────┘
```

---

## When Popups Are Shown

### 1. **Automatic Popup Opening**

Triggered by `openPopup()` in chain handlers:

```typescript
chrome.windows.create({
  url: chrome.runtime.getURL('popup/index.html'),
  type: 'popup',
  width: 360,
  height: 900,
});
```

**Triggered By**:
- Any transaction requiring user approval
- Sign message requests (`personal_sign`, `eth_signTypedData`, etc.)
- Permission requests (e.g., `eth_requestAccounts`)

### 2. **Popup Lifecycle**

1. **Open**: Chain handler calls `openPopup()`
2. **Load**: EventsViewer fetches pending events from `requestStorage`
3. **Display**: Transaction component renders chain-specific UI
4. **User Action**: Accept or Reject
5. **Device Interaction**: If accepted, awaits KeepKey device approval
6. **Result**: Shows success (txid page) or error
7. **Close**: User manually closes or auto-closes after completion

### 3. **Multiple Events**

If multiple requests are pending:
- All stored in `requestStorage` as array
- Popup shows first event
- Navigation buttons allow switching between events
- Each event has independent state

---

## Critical Issues Identified

### 1. **Error Boundary Recovery**

**Problem**: Generic error fallback with no recovery
```typescript
// Current:
<div>Error Occur</div>

// Should be:
<ErrorFallback error={error} resetError={reset} />
```

**Impact**: Users see "Error Occur" and must manually close popup

### 2. **Message Passing Race Conditions**

**Problem**: Transaction component may mount after error message sent

```typescript
// Background sends error immediately
chrome.runtime.sendMessage({ action: 'transaction_error', error: ... });

// But Transaction component listener may not be registered yet
useEffect(() => {
  chrome.runtime.onMessage.addListener(handleMessage);
}, []); // Runs after mount
```

**Impact**: Errors can be missed, popup shows wrong state

### 3. **Event Storage Corruption**

**Problem**: No validation on event structure, can crash popup

```typescript
// If event missing required fields:
const event = { id: '123' }; // Missing chain, networkId, etc.

// Popup crashes trying to access:
event.networkId.includes('eip155') // ❌ undefined.includes()
```

**Impact**: Popup crashes, requires extension reload

### 4. **Cryptic Error Messages**

**Problem**: JSON stringified errors shown to users

```typescript
errorMessage = JSON.stringify(error)
// Shows: {"code":4000,"message":"...","stack":"..."}
```

**Impact**: Users see developer error objects, not user-friendly messages

### 5. **State Desync on RESET_APP**

**Problem**: `chrome.runtime.reload()` clears ALL state including pending events

```typescript
case 'RESET_APP': {
  chrome.runtime.reload(); // ❌ Nuclear option
  break;
}
```

**Impact**: User loses context, must reconnect device, events lost

### 6. **No Error Recovery Strategies**

**Problem**: All errors result in same action: reload extension

```typescript
<Button onClick={handleCancel}>Retry</Button>
// handleCancel() → RESET_APP → reload extension
```

**Impact**: Transient errors (network issues) require full reset

---

## Error Categories

### Recoverable Errors
- RPC timeout/failure → Try different RPC
- Network congestion → Retry with higher gas
- User rejection → Close popup, allow retry
- Invalid nonce → Fetch latest nonce
- Insufficient balance → Show balance, allow adjustment

### Fatal Errors
- Device disconnected → Prompt reconnection
- Unsupported chain → Inform user
- Invalid transaction data → Show details, reject
- Extension corruption → Force reload

### Device Errors
- User rejected on device → Clear event, close popup
- Device timeout → Prompt user to check device
- Firmware incompatibility → Show upgrade instructions

---

## Message Passing Events

### From Background → Popup

| Action | Purpose | Payload |
|--------|---------|---------|
| `transaction_complete` | Tx broadcast success | `{ txHash }` |
| `transaction_error` | Tx/signing failed | `{ error }` |
| `KEEPKEY_STATE_CHANGED` | Device state update | `{ state }` |
| `ASSET_CONTEXT_UPDATED` | Asset context changed | `{ assetContext }` |
| `ASSET_CONTEXT_CLEARED` | Asset context reset | `{}` |

### From Popup → Background

| Type | Purpose | Payload |
|------|---------|---------|
| `WALLET_REQUEST` | Execute wallet method | `{ requestInfo, chain, method, params }` |
| `GET_KEEPKEY_STATE` | Check device status | `{}` |
| `RESET_APP` | Reload extension | `{}` |
| `UPDATE_EVENT_BY_ID` | Update event status | `{ id, updatedEvent }` |
| `eth_sign_response` | User approval decision | `{ decision, eventId }` |

---

## Storage Keys

| Key | Purpose | Type |
|-----|---------|------|
| `keepkey-requests` | Pending approval events | Event[] |
| `keepkey-approvals` | Approved, pending tx | Event[] |
| `keepkey-completed` | Historical txs | Event[] |
| `keepkey-asset-context` | Current asset context | AssetContext |
| `web3-provider` | Current RPC provider | ProviderInfo |
| `blockchains` | Enabled chains | string[] |

---

## Recommendations for Improvement

See `ERROR_HANDLING_IMPROVEMENTS.md` for detailed proposals on:
1. Enhanced error boundary with recovery
2. User-friendly error messages
3. Granular retry mechanisms
4. Error state persistence
5. Better message passing
6. Event validation
7. State recovery strategies

---

## Testing Error Scenarios

### Manual Testing

1. **Device Disconnected**
   - Disconnect KeepKey
   - Attempt transaction
   - Verify error shown in popup

2. **RPC Failure**
   - Use network with failing RPCs
   - Verify automatic failover
   - Check error if all fail

3. **Invalid Transaction**
   - Send tx with insufficient balance
   - Verify helpful error message
   - Check recovery options

4. **User Rejection**
   - Reject on device
   - Verify popup closes cleanly
   - Check event removed from storage

5. **Popup Crash**
   - Inject malformed event
   - Verify error boundary catches
   - Check recovery path

### Automated Testing

```bash
# E2E tests location
pages/popup/src/__tests__/

# Run tests
pnpm -F @extension/popup test
```

---

## Debugging Tips

### Enable Verbose Logging

```typescript
// In background/index.ts
const DEBUG = true;
if (DEBUG) console.log(tag, 'Detailed message', data);
```

### Inspect Storage

```javascript
// In browser console
chrome.storage.local.get(null, console.log);
```

### Monitor Message Passing

```typescript
// Add global listener
chrome.runtime.onMessage.addListener((msg) => {
  console.log('🔔 Message:', msg);
  return false;
});
```

### Check Device State

```javascript
// Send from popup console
chrome.runtime.sendMessage({ type: 'GET_KEEPKEY_STATE' }, console.log);
```

---

## Related Files

- Background Script: `chrome-extension/src/background/index.ts`
- Request Handler: `chrome-extension/src/background/methods.ts`
- Ethereum Handler: `chrome-extension/src/background/chains/ethereumHandler.ts`
- Popup Entry: `pages/popup/src/index.tsx`
- Transaction Component: `pages/popup/src/components/Transaction.tsx`
- Events Viewer: `pages/popup/src/components/Events.tsx`
- Error Boundary: `packages/shared/lib/hoc/withErrorBoundary.tsx`
- Storage: `packages/storage/lib/customStorage.ts`

---

## Glossary

- **Event**: Stored wallet request requiring user approval
- **CAIP**: Chain Agnostic Improvement Proposal (e.g., `eip155:1/slip44:60`)
- **Network ID**: Chain identifier (e.g., `eip155:1` for Ethereum mainnet)
- **Provider**: RPC node URL for blockchain communication
- **Asset Context**: Currently selected asset/token for operations
- **Request Storage**: Chrome storage area for pending approval events
- **Background Script**: Service worker managing extension state
- **Content Script**: Injected script enabling DApp communication

---

**Last Updated**: 2025-01-03
**Version**: 0.0.22
