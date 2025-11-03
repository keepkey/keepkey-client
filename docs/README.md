# KeepKey Client Documentation

Comprehensive documentation for the KeepKey Chrome Extension error handling and popup system.

---

## 📚 Documentation Index

### Core Architecture Documents

1. **[ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md)**
   - Complete system architecture overview
   - Component breakdown and responsibilities
   - Error flow diagrams
   - Message passing events
   - Storage keys and lifecycle
   - Critical issues identified
   - Testing strategies
   - Debugging tips

2. **[ERROR_HANDLING_IMPROVEMENTS.md](./ERROR_HANDLING_IMPROVEMENTS.md)**
   - Concrete improvement proposals
   - Issue-by-issue solutions with code examples
   - Implementation priority (3-phase rollout)
   - Testing strategy
   - Success criteria
   - Monitoring and metrics

3. **[POPUP_STATE_FLOW.md](./POPUP_STATE_FLOW.md)**
   - Visual state diagrams
   - Complete request lifecycle flow
   - Transaction component state machine
   - Event storage state transitions
   - Message passing timing issues
   - Component re-render triggers
   - Crash and recovery scenarios

---

## 🚨 Critical Issues Summary

### Issue #1: Generic Error Boundary
**Impact**: Users see "Error Occur" with no context or recovery options

**Current**:
```typescript
<div>Error Occur</div>
```

**Solution**: Enhanced error fallback with multiple recovery options
- Reload popup
- Clear pending requests
- Restart extension
- Technical details toggle

### Issue #2: Message Passing Race Conditions
**Impact**: Errors and success messages can be lost if popup mounts slowly

**Solution**: Global message queue that captures early messages before component listeners are registered

### Issue #3: Event Storage Corruption
**Impact**: Malformed events crash popup on access

**Solution**: Zod validation schema for all events before storage

### Issue #4: Cryptic Error Messages
**Impact**: Users see JSON-stringified error objects

**Solution**: Error transformation utility with user-friendly messages and categorization

### Issue #5: Nuclear Reset Strategy
**Impact**: `RESET_APP` reloads entire extension, losing all state

**Solution**: Granular recovery strategies based on error type
- Reload popup only
- Clear events only
- Reconnect device
- Reset provider
- Full reset (last resort)

### Issue #6: No Error Persistence
**Impact**: Error history lost, debugging difficult

**Solution**: Error log storage with 24-hour retention

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        DApp Layer                           │
│  window.ethereum.request({ method, params })                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Content Script (Injected)                 │
│  Intercepts window.ethereum → chrome.runtime.sendMessage    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Background Script                        │
│  • KeepKey device monitoring (5s poll)                      │
│  • Request routing to chain handlers                        │
│  • Event storage management                                 │
│  • Error transformation and propagation                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
   ┌─────────────────────┐   ┌─────────────────────┐
   │   Chain Handlers    │   │  Request Storage    │
   │                     │   │                     │
   │ • Ethereum          │   │ • keepkey-requests  │
   │ • Bitcoin           │   │ • keepkey-approvals │
   │ • Cosmos            │   │ • keepkey-completed │
   │ • Ripple            │   │                     │
   │ • etc.              │   └─────────────────────┘
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────────────────────────────────┐
   │            Popup Window                         │
   │                                                 │
   │  <ErrorBoundary>                                │
   │    <EventsViewer>                               │
   │      <Transaction>                              │
   │        <EvmTransaction />                       │
   │        <UtxoTransaction />                      │
   │        <TendermintTransaction />                │
   │        <OtherTransaction />                     │
   │      </Transaction>                             │
   │    </EventsViewer>                              │
   │  </ErrorBoundary>                               │
   └─────────────────────────────────────────────────┘
```

---

## 🔄 Transaction Lifecycle

### 1. Request Initiated
```
DApp → Content Script → Background → Chain Handler
```

### 2. Event Storage
```javascript
{
  id: uuid(),
  type: 'eth_sendTransaction',
  networkId: 'eip155:1',
  chain: 'ethereum',
  status: 'request',
  timestamp: ISO8601,
  request: { to, value, data }
}
```

### 3. Popup Opens
```
Background opens popup window (360x900)
→ React mounts
→ EventsViewer fetches events
→ Transaction component renders chain-specific UI
```

### 4. User Decision
```
Accept → awaitingDeviceApproval → Device interaction
Reject → Remove event → Close popup
```

### 5. Transaction Execution
```
Success: transaction_complete → Show TxidPage
Error: transaction_error → Show error alert
```

### 6. Completion
```
Move event: requests → approvals → completed
Auto-cleanup after 10 minutes
```

---

## ⚠️ Error Flow

### Error Origin Points
1. **Chain Handler**: Invalid params, RPC failure, insufficient balance
2. **Device Communication**: Disconnected, timeout, user rejection
3. **Network**: RPC failure, timeout, network congestion
4. **Storage**: Corruption, malformed events

### Error Propagation
```
Origin → Background catch block
       → Transform error message
       → chrome.runtime.sendMessage({ action: 'transaction_error' })
       → Popup listener catches
       → Display to user
```

### Current Issues
- ❌ Race conditions in message passing
- ❌ Generic "Error Occur" boundary
- ❌ Cryptic JSON error messages
- ❌ Nuclear reset on any error
- ❌ No error history

---

## 🔧 Key Components

### Background Script
**Location**: `chrome-extension/src/background/index.ts`

**Responsibilities**:
- Device state management (5s polling)
- Request routing and validation
- Event storage orchestration
- Error handling and propagation

### Chain Handlers
**Location**: `chrome-extension/src/background/chains/*.ts`

**Responsibilities**:
- Chain-specific transaction building
- RPC provider failover
- Event creation and storage
- Popup window opening

### Request Storage
**Location**: `packages/storage/lib/customStorage.ts`

**API**:
```typescript
requestStorage.addEvent(event)
requestStorage.getEvents()
requestStorage.updateEventById(id, updatedEvent)
requestStorage.removeEventById(id)
requestStorage.clearEvents()
```

### Events Viewer
**Location**: `pages/popup/src/components/Events.tsx`

**Responsibilities**:
- Fetch pending events on mount
- Auto-remove events >10 minutes old
- Navigation between multiple events
- Event lifecycle management

### Transaction Component
**Location**: `pages/popup/src/components/Transaction.tsx`

**Responsibilities**:
- Determine transaction type (EVM/UTXO/Tendermint/Other)
- Render chain-specific UI
- Handle user approval/rejection
- Listen for background messages
- Display success/error states

---

## 📋 Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
- [ ] Enhanced error boundary with recovery options
- [ ] Error message transformation utility
- [ ] Event validation with Zod schema
- [ ] Add to `ErrorFallback.tsx`, `errorTransformer.ts`, `validation.ts`

### Phase 2: Important Improvements (Week 2)
- [ ] Message passing race condition fix
- [ ] Granular recovery strategies
- [ ] User-friendly error display component
- [ ] Add `useBackgroundMessage` hook, recovery functions

### Phase 3: Enhancements (Week 3)
- [ ] Error logging and persistence
- [ ] Error history view in popup
- [ ] Recovery strategy decision logic
- [ ] Add `errorStorage.ts`, `ErrorHistory.tsx`

---

## 🧪 Testing Strategy

### Unit Tests
```bash
# Test error transformation
packages/shared/__tests__/errorTransformer.test.ts

# Test event validation
packages/storage/__tests__/validation.test.ts

# Test recovery strategies
chrome-extension/src/background/__tests__/recovery.test.ts
```

### Integration Tests
```bash
# Test popup error handling
pages/popup/src/components/__tests__/Transaction.test.tsx

# Test message passing
pages/popup/src/components/__tests__/Events.test.tsx
```

### E2E Tests
```bash
# Test error scenarios
pnpm -F @extension/e2e e2e:errorScenarios

# Test recovery flows
pnpm -F @extension/e2e e2e:recovery
```

---

## 🐛 Debugging

### Enable Verbose Logging
```typescript
// chrome-extension/src/background/index.ts
const DEBUG = true;
```

### Inspect Storage
```javascript
// Browser console
chrome.storage.local.get(null, console.log);
```

### Monitor Messages
```javascript
// Add to popup console
chrome.runtime.onMessage.addListener((msg) => {
  console.log('🔔 Message:', msg);
  return false;
});
```

### Check Device State
```javascript
// Popup console
chrome.runtime.sendMessage(
  { type: 'GET_KEEPKEY_STATE' },
  console.log
);
```

### View Error Logs
```javascript
// After implementing error storage
chrome.storage.local.get('keepkey-error-logs', console.log);
```

---

## 📊 Success Metrics

### User Experience
- Zero "Error Occur" messages (target: 0%)
- User-friendly error messages (target: 90%+)
- Successful error recovery (target: 80%+)

### System Reliability
- Zero popup crashes from malformed events (target: 0)
- Zero message passing race conditions (target: 0)
- Reduced extension reloads (target: -70%)

### Developer Experience
- Error logs available for debugging (target: 100%)
- Clear error categorization (target: 100%)
- Comprehensive test coverage (target: 80%+)

---

## 🔗 Related Resources

### External Documentation
- [Chrome Extension Developer Guide](https://developer.chrome.com/docs/extensions/)
- [KeepKey API Documentation](https://github.com/keepkey/keepkey-client)
- [Pioneer SDK](https://github.com/BitHighlander/pioneer-sdk)

### Internal Documentation
- [Project README](../README.md)
- [CLAUDE.md](../CLAUDE.md) - Development guidelines
- [Architecture Overview](./ERROR_HANDLING_SYSTEM.md#architecture--structure)

---

## 🤝 Contributing

When working on error handling improvements:

1. **Read All Three Docs First**: Understand the full system before making changes
2. **Follow Phase Priority**: Implement Phase 1 items before Phase 2, etc.
3. **Add Tests**: Every fix should have corresponding tests
4. **Update Docs**: Keep these docs in sync with code changes
5. **Test Manually**: Use the debugging tips to verify fixes work

---

## 📞 Getting Help

### Common Issues

**Q: Popup shows "Error Occur"**
A: See [ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md#issue-1-error-boundary-recovery)

**Q: Transaction stuck in "Awaiting" state**
A: See [POPUP_STATE_FLOW.md](./POPUP_STATE_FLOW.md#message-passing-timing-issues)

**Q: Events not appearing in popup**
A: Check storage: `chrome.storage.local.get('keepkey-requests', console.log)`

**Q: Extension crashes on certain transactions**
A: See [ERROR_HANDLING_SYSTEM.md](./ERROR_HANDLING_SYSTEM.md#issue-3-event-storage-corruption)

### Support Channels
- GitHub Issues: [keepkey-client/issues](https://github.com/keepkey/keepkey-client/issues)
- Discord: [KeepKey Community](https://discord.gg/keepkey)

---

## 📝 Changelog

### 2025-01-03: Initial Documentation
- Created comprehensive error handling system docs
- Identified 6 critical issues with solutions
- Designed 3-phase implementation roadmap
- Added visual state flow diagrams

---

**Version**: 0.0.22
**Last Updated**: 2025-01-03
**Maintainer**: KeepKey Development Team
