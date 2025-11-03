# KeepKey Client - Popup State Flow & Lifecycle

## Visual State Diagrams

### Complete Request Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                         DApp Request                            │
│                                                                 │
│  window.ethereum.request({ method: 'eth_sendTransaction' })    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Content Script (Injected)                    │
│                                                                 │
│  - Intercepts window.ethereum calls                             │
│  - Forwards to background script via chrome.runtime            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Background Script                          │
│                                                                 │
│  chrome.runtime.onMessage.addListener()                         │
│    ↓                                                            │
│  handleWalletRequest(requestInfo, chain, method, params)        │
│    ↓                                                            │
│  Route to chain handler (ethereumHandler, bitcoinHandler, etc.) │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Chain Handler                              │
│                                                                 │
│  1. Validate parameters                                         │
│  2. Get RPC provider (with failover)                            │
│  3. Build transaction/message                                   │
│  4. Create event object                                         │
│  5. Store in requestStorage                                     │
│  6. Open popup window                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Request Storage (Chrome Storage)             │
│                                                                 │
│  Key: 'keepkey-requests'                                        │
│  Value: Array<Event>                                            │
│                                                                 │
│  Event {                                                        │
│    id: uuid,                                                    │
│    networkId: 'eip155:1',                                       │
│    chain: 'ethereum',                                           │
│    type: 'eth_sendTransaction',                                 │
│    status: 'request',                                           │
│    timestamp: ISO8601,                                          │
│    request: { to, value, data, ... }                            │
│  }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Popup Window Opens                           │
│                                                                 │
│  URL: chrome-extension://[id]/popup/index.html                  │
│  Dimensions: 360x900                                            │
│  Type: 'popup'                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    React Render Tree                            │
│                                                                 │
│  <ErrorBoundary fallback="Error Occur">                         │
│    <Suspense fallback="Loading...">                             │
│      <Popup>                                                    │
│        <EventsViewer>                                           │
│          <Transaction event={currentEvent}>                     │
│            {renderTransaction()}                                │
│              <EvmTransaction />      // For EVM chains          │
│              <UtxoTransaction />     // For Bitcoin-like        │
│              <TendermintTransaction /> // For Cosmos chains     │
│              <OtherTransaction />    // For Ripple, etc.        │
│          </Transaction>                                         │
│        </EventsViewer>                                          │
│      </Popup>                                                   │
│    </Suspense>                                                  │
│  </ErrorBoundary>                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Machine: Transaction Component

```
┌──────────────────────────────────────────────────────────────────┐
│                      INITIAL STATE                               │
│                                                                  │
│  transactionType: null                                           │
│  txHash: null                                                    │
│  awaitingDeviceApproval: false                                   │
│  transactionInProgress: false                                    │
│  errorMessage: null                                              │
│  showTxidPage: false                                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LOADING EVENT DATA                            │
│                                                                  │
│  1. Fetch assetContext from background                           │
│  2. Determine transaction type from event.networkId              │
│     - eip155:* → 'evm'                                           │
│     - bip122:* → 'utxo'                                          │
│     - cosmos:* / thorchain:* / osmosis:* → 'tendermint'          │
│     - ripple → 'other'                                           │
│  3. Render chain-specific UI                                     │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
    ┌─────────────────────┐   ┌─────────────────────┐
    │   USER ACCEPTS      │   │   USER REJECTS      │
    │                     │   │                     │
    │  handleResponse     │   │  handleResponse     │
    │    ('accept')       │   │    ('reject')       │
    └──────────┬──────────┘   └──────────┬──────────┘
               │                         │
               │                         ▼
               │              ┌─────────────────────────┐
               │              │ Remove event from       │
               │              │ requestStorage          │
               │              │                         │
               │              │ Reload events list      │
               │              │                         │
               │              │ Close popup (optional)  │
               │              └─────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                AWAITING DEVICE APPROVAL                          │
│                                                                  │
│  awaitingDeviceApproval: true                                    │
│                                                                  │
│  1. Opens sidebar with KeepKey interface                         │
│  2. Shows spinner/loading state in popup                         │
│  3. Background script calls APP.signTransaction()                │
│  4. User must approve on physical device                         │
│                                                                  │
│  Can cancel → triggers handleCancel() → RESET_APP                │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
    ┌─────────────────────┐   ┌─────────────────────┐
    │ TRANSACTION SUCCESS │   │ TRANSACTION ERROR   │
    │                     │   │                     │
    │ Message:            │   │ Message:            │
    │ 'transaction_       │   │ 'transaction_error' │
    │  complete'          │   │                     │
    │                     │   │ Payload:            │
    │ Payload:            │   │  { error: string }  │
    │  { txHash: string } │   │                     │
    └──────────┬──────────┘   └──────────┬──────────┘
               │                         │
               ▼                         ▼
    ┌─────────────────────┐   ┌─────────────────────┐
    │   SHOW TXID PAGE    │   │   SHOW ERROR        │
    │                     │   │                     │
    │ showTxidPage: true  │   │ errorMessage: set   │
    │ txHash: set         │   │                     │
    │ explorerUrl: built  │   │ Displays:           │
    │                     │   │ - Alert with icon   │
    │ Components:         │   │ - Error message     │
    │ <TxidPage />        │   │ - Retry button      │
    │                     │   │                     │
    │ Actions:            │   │ Retry → handleCancel│
    │ - View on explorer  │   │       → RESET_APP   │
    │ - Close (moves to   │   │                     │
    │   approvalStorage)  │   │                     │
    └─────────────────────┘   └─────────────────────┘
```

---

## Error Propagation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     ERROR ORIGIN POINTS                          │
└──────────────────────────────────────────────────────────────────┘
         │                │               │              │
         │ 1. Chain       │ 2. Device     │ 3. Network   │ 4. Storage
         │    Handler     │    Comm       │    Failure   │    Corruption
         │                │               │              │
         ▼                ▼               ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│              Background Script Error Handler                     │
│                                                                  │
│  try {                                                           │
│    await handleChainRequest(...)                                 │
│  } catch (error) {                                               │
│    // Transform error message                                    │
│    let errorMessage = JSON.stringify(error)                      │
│    if (errorMessage.includes('unrecognized address')) {          │
│      errorMessage = 'KeepKey State Invalid, restart device!'     │
│    }                                                             │
│                                                                  │
│    // Push to popup                                              │
│    chrome.runtime.sendMessage({                                  │
│      action: 'transaction_error',                                │
│      error: errorMessage                                         │
│    });                                                           │
│                                                                  │
│    // Throw to DApp                                              │
│    throw createProviderRpcError(4000, error);                    │
│  }                                                               │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Message Passing (Async)                         │
│                                                                  │
│  chrome.runtime.sendMessage({                                    │
│    action: 'transaction_error',                                  │
│    error: errorMessage                                           │
│  });                                                             │
│                                                                  │
│  ⚠️  RACE CONDITION RISK:                                        │
│      Message may arrive before Transaction.tsx listener is ready │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│               Transaction Component Listener                     │
│                                                                  │
│  useEffect(() => {                                               │
│    const handleMessage = (message: any) => {                     │
│      if (message.action === 'transaction_error') {               │
│        const errorDetails =                                      │
│          message.error ||                                        │
│          message.e?.message ||                                   │
│          JSON.stringify(message.e);                              │
│                                                                  │
│        setErrorMessage('Transaction failed: ' + errorDetails);   │
│        setTransactionInProgress(false);                          │
│      }                                                           │
│    };                                                            │
│                                                                  │
│    chrome.runtime.onMessage.addListener(handleMessage);          │
│    return () => {                                                │
│      chrome.runtime.onMessage.removeListener(handleMessage);     │
│    };                                                            │
│  }, []);                                                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Render Error State                            │
│                                                                  │
│  if (errorMessage) {                                             │
│    return (                                                      │
│      <Alert status="error">                                      │
│        <AlertIcon />                                             │
│        <div>                                                     │
│          <h3>Error Occurred</h3>                                 │
│          <p>{errorMessage}</p>                                   │
│          <Button onClick={handleCancel}>Retry</Button>           │
│        </div>                                                    │
│      </Alert>                                                    │
│    );                                                            │
│  }                                                               │
│                                                                  │
│  handleCancel() {                                                │
│    chrome.runtime.sendMessage({ type: 'RESET_APP' });           │
│    // ⚠️  This reloads the ENTIRE extension                     │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Event Storage State Transitions

```
┌──────────────────────────────────────────────────────────────────┐
│                    Storage Lifecycle                             │
│                                                                  │
│  Phase 1: REQUEST                                                │
│  ┌────────────────────────────────────────────────────┐          │
│  │ keepkey-requests                                   │          │
│  │                                                    │          │
│  │ [                                                  │          │
│  │   {                                                │          │
│  │     id: "abc-123",                                 │          │
│  │     status: "request",                             │          │
│  │     type: "eth_sendTransaction",                   │          │
│  │     networkId: "eip155:1",                         │          │
│  │     request: { to, value, data },                  │          │
│  │     timestamp: "2025-01-03T12:00:00Z"              │          │
│  │   }                                                │          │
│  │ ]                                                  │          │
│  └────────────────────────────────────────────────────┘          │
│                            │                                     │
│                            │ User accepts in popup               │
│                            │ Device approves                     │
│                            ▼                                     │
│  Phase 2: APPROVAL                                               │
│  ┌────────────────────────────────────────────────────┐          │
│  │ keepkey-approvals                                  │          │
│  │                                                    │          │
│  │ [                                                  │          │
│  │   {                                                │          │
│  │     id: "abc-123",                                 │          │
│  │     status: "approval",                            │          │
│  │     txHash: "0xdef456...",                         │          │
│  │     ...                                            │          │
│  │   }                                                │          │
│  │ ]                                                  │          │
│  └────────────────────────────────────────────────────┘          │
│                            │                                     │
│                            │ Transaction confirms                │
│                            ▼                                     │
│  Phase 3: COMPLETED                                              │
│  ┌────────────────────────────────────────────────────┐          │
│  │ keepkey-completed                                  │          │
│  │                                                    │          │
│  │ [                                                  │          │
│  │   {                                                │          │
│  │     id: "abc-123",                                 │          │
│  │     status: "completed",                           │          │
│  │     txHash: "0xdef456...",                         │          │
│  │     confirmations: 12,                             │          │
│  │     ...                                            │          │
│  │   }                                                │          │
│  │ ]                                                  │          │
│  └────────────────────────────────────────────────────┘          │
│                            │                                     │
│                            │ Auto-cleanup after 10 minutes       │
│                            ▼                                     │
│                       [Removed]                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Popup Window Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                       Popup Created                              │
│                                                                  │
│  chrome.windows.create({                                         │
│    url: 'popup/index.html',                                      │
│    type: 'popup',                                                │
│    width: 360,                                                   │
│    height: 900                                                   │
│  });                                                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      React Mount                                 │
│                                                                  │
│  1. index.tsx renders                                            │
│  2. ChakraProvider initializes                                   │
│  3. ForceDarkMode sets theme                                     │
│  4. ErrorBoundary wraps                                          │
│  5. Suspense handles async                                       │
│  6. Popup component mounts                                       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  EventsViewer Mount                              │
│                                                                  │
│  useEffect(() => {                                               │
│    fetchEvents();  // Runs immediately                           │
│  }, []);                                                         │
│                                                                  │
│  Fetches from requestStorage:                                    │
│  - Gets all events                                               │
│  - Filters out events > 10 minutes old                           │
│  - Removes stale events                                          │
│  - Reverses array (latest first)                                 │
│  - Sets state: setEvents(validEvents)                            │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Transaction Mount                                │
│                                                                  │
│  Multiple useEffect hooks:                                       │
│                                                                  │
│  1. Fetch assetContext                                           │
│     useEffect(() => {                                            │
│       requestAssetContext().then(setAssetContext);               │
│     }, []);                                                      │
│                                                                  │
│  2. Register message listener                                    │
│     useEffect(() => {                                            │
│       chrome.runtime.onMessage.addListener(handleMessage);       │
│       return cleanup;                                            │
│     }, []);                                                      │
│                                                                  │
│  3. Determine transaction type                                   │
│     useEffect(() => {                                            │
│       if (event?.networkId) {                                    │
│         setTransactionType(...);                                 │
│       }                                                          │
│     }, [event]);                                                 │
│                                                                  │
│  4. Build explorer URL                                           │
│     useEffect(() => {                                            │
│       if (assetContext && txHash) {                              │
│         setExplorerUrl(...);                                     │
│       }                                                          │
│     }, [assetContext, txHash]);                                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Active State                                  │
│                                                                  │
│  Popup window is interactive:                                    │
│  - Displays transaction details                                  │
│  - Awaits user decision                                          │
│  - Listens for background messages                               │
│  - Updates UI based on state changes                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
    ┌─────────────────────┐   ┌─────────────────────┐
    │   USER CLOSES       │   │   AUTO CLOSE        │
    │                     │   │                     │
    │ - Manual X button   │   │ - After success     │
    │ - ESC key           │   │ - After error       │
    │ - Click outside     │   │   (optional)        │
    └──────────┬──────────┘   └──────────┬──────────┘
               │                         │
               └────────────┬────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Popup Unmount                               │
│                                                                  │
│  1. All useEffect cleanup functions run                          │
│  2. Message listeners removed                                    │
│  3. Component state cleared                                      │
│  4. Window destroyed                                             │
│                                                                  │
│  ⚠️  If transaction was in progress:                             │
│     - State lost                                                 │
│     - Event may remain in storage                                │
│     - Background still processing                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Message Passing Timing Issues

```
SCENARIO 1: Normal Flow (No Issues)
─────────────────────────────────────────────────────────────────

Time  │ Background Script          │ Popup
──────┼────────────────────────────┼─────────────────────────────
  0   │ Receives request          │
  1   │ Creates event             │
  2   │ Opens popup               │
  3   │                           │ Window created
  4   │                           │ React mounting...
  5   │                           │ EventsViewer mounted
  6   │                           │ Transaction mounted
  7   │                           │ Message listener registered ✅
  8   │ Calls device              │
  9   │ Device approves           │
 10   │ Broadcasts tx             │
 11   │ Sends 'transaction_       │
      │   complete' message ──────┼─→ Listener catches ✅
 12   │                           │ Shows success


SCENARIO 2: Race Condition (Current Issue)
─────────────────────────────────────────────────────────────────

Time  │ Background Script          │ Popup
──────┼────────────────────────────┼─────────────────────────────
  0   │ Receives request          │
  1   │ Calls device immediately  │ (Popup not open yet)
  2   │ Device fast approval      │
  3   │ Broadcasts tx             │
  4   │ Sends 'transaction_       │
      │   complete' message ──────┼─→ ❌ No listener yet!
  5   │                           │ Window created
  6   │                           │ React mounting...
  7   │                           │ Transaction mounted
  8   │                           │ Message listener registered
  9   │                           │ ❌ Message already passed!
 10   │                           │ Stuck in "awaiting" state


SCENARIO 3: With Proposed Fix (Message Queue)
─────────────────────────────────────────────────────────────────

Time  │ Background Script          │ Popup
──────┼────────────────────────────┼─────────────────────────────
  0   │ Receives request          │
  1   │ Calls device immediately  │
  2   │ Device fast approval      │
  3   │ Broadcasts tx             │
  4   │ Sends 'transaction_       │
      │   complete' message ──────┼─→ Global listener catches
      │                           │    Adds to messageQueue ✅
  5   │                           │ Window created
  6   │                           │ React mounting...
  7   │                           │ Transaction mounted
  8   │                           │ useBackgroundMessage hook:
      │                           │   1. Checks messageQueue
      │                           │   2. Processes queued message ✅
      │                           │   3. Registers for new messages
  9   │                           │ Shows success ✅
```

---

## Component Re-render Triggers

```
EventsViewer Component
├─ Initial Mount
│  └─ fetchEvents() called
│     └─ Triggers: setEvents(), setLoading()
│
├─ User navigates between events
│  └─ nextEvent() or previousEvent()
│     └─ Triggers: setCurrentIndex()
│        └─ Transaction component receives new event prop
│           └─ All Transaction useEffect hooks re-run
│
└─ After transaction completes
   └─ reloadEvents() called
      └─ fetchEvents() runs again
         └─ Triggers: setEvents(), setLoading()


Transaction Component
├─ Prop Change: event
│  └─ useEffect([event]) runs
│     └─ Determines transaction type
│        └─ Triggers: setTransactionType()
│           └─ renderTransaction() re-runs
│              └─ Chain-specific component renders
│
├─ Asset Context Loaded
│  └─ useEffect([]) on mount
│     └─ requestAssetContext()
│        └─ Triggers: setAssetContext()
│           └─ useEffect([assetContext, txHash]) runs
│              └─ Triggers: setExplorerUrl()
│
├─ User Accepts
│  └─ handleResponse('accept')
│     └─ Triggers: setAwaitingDeviceApproval(true)
│        └─ Conditional render: <AwaitingApproval />
│
├─ Background Message: 'transaction_complete'
│  └─ handleMessage()
│     └─ Triggers: setShowTxidPage(true), setTxHash()
│        └─ Conditional render: <TxidPage />
│
└─ Background Message: 'transaction_error'
   └─ handleMessage()
      └─ Triggers: setErrorMessage()
         └─ Conditional render: <Alert status="error" />
```

---

## Multiple Pending Requests

```
Scenario: User has 3 pending transactions

┌─────────────────────────────────────────────────────────────┐
│                     requestStorage                          │
│                                                             │
│  [                                                          │
│    { id: "tx1", type: "eth_sendTransaction", ... },        │
│    { id: "tx2", type: "personal_sign", ... },              │
│    { id: "tx3", type: "eth_signTypedData", ... }           │
│  ]                                                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          │ fetchEvents() called
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     EventsViewer                            │
│                                                             │
│  events: [tx3, tx2, tx1]  (reversed, latest first)         │
│  currentIndex: 0                                            │
│                                                             │
│  Currently showing: tx3                                     │
│                                                             │
│  ┌────────────────────────────────────────────────┐         │
│  │ <Transaction event={events[0]} />               │         │
│  │   Shows: Sign Typed Data request                │         │
│  │                                                  │         │
│  │   [Previous] [1/3] [Next]                        │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ User clicks [Next]
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     EventsViewer                            │
│                                                             │
│  currentIndex: 1                                            │
│                                                             │
│  Currently showing: tx2                                     │
│                                                             │
│  ┌────────────────────────────────────────────────┐         │
│  │ <Transaction event={events[1]} />               │         │
│  │   Shows: Personal Sign request                  │         │
│  │                                                  │         │
│  │   [Previous] [2/3] [Next]                        │         │
│  └────────────────────────────────────────────────┘         │
│                                                             │
│  ⚠️  ISSUE: Each event's state is independent              │
│     User might accept tx2 while tx3 is pending              │
│     This can cause confusion and state issues               │
└─────────────────────────────────────────────────────────────┘
```

---

## Crash & Recovery Scenarios

### Scenario 1: Popup Crashes Due to Malformed Event

```
1. Background stores event with missing networkId
   └─ Event: { id: "x", type: "eth_send", request: {...} }
      ❌ Missing: networkId, chain

2. Popup opens and fetches events
   └─ EventsViewer renders Transaction

3. Transaction tries to determine type
   └─ Code: event.networkId.includes('eip155')
      ❌ TypeError: Cannot read property 'includes' of undefined

4. Error Boundary catches
   └─ Shows: "Error Occur"
      ❌ Generic, no details

5. User must close popup manually
   └─ Malformed event still in storage
      ❌ Will crash again on reopen
```

**Fix**: Add event validation before storage (see improvements doc)

### Scenario 2: Background Script Error During Processing

```
1. User accepts transaction in popup
   └─ Popup: awaitingDeviceApproval = true

2. Background calls signTransaction()
   └─ Device communication fails
      Error: "Device timeout"

3. Background catches error
   └─ Sends: { action: 'transaction_error', error: "..." }

4. Popup receives message
   └─ Shows error alert
   └─ "Retry" button → handleCancel() → RESET_APP

5. Extension reloads
   └─ ❌ All state lost
   └─ ❌ Events cleared
   └─ ❌ User must reconnect device
```

**Fix**: Granular recovery strategies (see improvements doc)

---

## State Persistence Issues

```
ISSUE: No state persistence between popup closes

Time  │ Action                        │ State
──────┼───────────────────────────────┼──────────────────────────
  0   │ User accepts transaction      │ awaitingDeviceApproval=true
  1   │ Device interaction in sidebar │ Processing...
  2   │ User closes popup (accidental)│ Popup unmounted
  3   │ All state lost                │ ❌ State gone
  4   │ Transaction completes in BG   │ Sends 'transaction_complete'
  5   │ No popup to receive message   │ ❌ Message lost
  6   │ User reopens popup            │ Shows same request again
  7   │ User confused                 │ Double submission risk

SOLUTION: Persist transaction state in storage

  requestStorage event:
  {
    id: "abc-123",
    status: "awaiting_device",  ← Track detailed status
    txHash: null,
    deviceApprovalStarted: "2025-01-03T12:00:00Z",
    ...
  }

  Popup reopens:
  - Checks event status
  - Resumes from correct state
  - No duplicate submissions
```

---

**Last Updated**: 2025-01-03
**For**: Error handling system review
