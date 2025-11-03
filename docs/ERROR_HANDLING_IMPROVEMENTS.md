# KeepKey Client - Error Handling Improvements

## Executive Summary

This document proposes concrete improvements to the KeepKey extension's error handling and popup system to address critical issues identified in the current architecture.

---

## Critical Issues & Solutions

### Issue 1: Generic Error Boundary Fallback

**Current State**:
```typescript
// Popup.tsx
export default withErrorBoundary(
  withSuspense(Popup, <div>Loading...</div>),
  <div>Error Occur</div>  // ❌ No details, no recovery
);
```

**Problems**:
- Users see "Error Occur" with no context
- No way to recover without closing popup
- No error details logged for debugging
- Forces full extension reload

**Proposed Solution**:

Create `ErrorFallback.tsx`:
```typescript
import { Alert, AlertIcon, AlertTitle, AlertDescription, Button, VStack, Code, Box } from '@chakra-ui/react';

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, resetError }) => {
  const [showDetails, setShowDetails] = useState(false);

  const handleRefreshExtension = () => {
    chrome.runtime.sendMessage({ type: 'RESET_APP' });
  };

  const handleReloadPopup = () => {
    window.location.reload();
  };

  const handleClearStorage = async () => {
    await requestStorage.clearEvents();
    resetError();
  };

  return (
    <Box p={4}>
      <Alert status="error" variant="subtle" flexDirection="column" alignItems="center" textAlign="center">
        <AlertIcon boxSize="40px" mr={0} />
        <AlertTitle mt={4} mb={1} fontSize="lg">
          Something went wrong
        </AlertTitle>
        <AlertDescription maxWidth="sm">
          {getUserFriendlyMessage(error)}
        </AlertDescription>

        <VStack mt={4} spacing={2} width="100%">
          <Button colorScheme="red" onClick={handleReloadPopup} size="sm">
            Reload Popup
          </Button>
          <Button colorScheme="orange" onClick={handleClearStorage} size="sm">
            Clear Pending Requests
          </Button>
          <Button colorScheme="gray" onClick={handleRefreshExtension} size="sm">
            Restart Extension
          </Button>
          <Button variant="link" size="sm" onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? 'Hide' : 'Show'} Technical Details
          </Button>
        </VStack>

        {showDetails && (
          <Code mt={4} p={2} fontSize="xs" width="100%" maxHeight="200px" overflowY="auto">
            {error.stack || error.message}
          </Code>
        )}
      </Alert>
    </Box>
  );
};

// Helper function
const getUserFriendlyMessage = (error: Error): string => {
  const message = error.message.toLowerCase();

  if (message.includes('unrecognized address')) {
    return 'Your KeepKey device is not paired correctly. Please restart your device.';
  }
  if (message.includes('device not found') || message.includes('disconnected')) {
    return 'KeepKey device not detected. Please check your connection.';
  }
  if (message.includes('timeout')) {
    return 'Request timed out. Please check your network connection and try again.';
  }
  if (message.includes('insufficient funds')) {
    return 'Insufficient balance to complete this transaction.';
  }
  if (message.includes('user rejected')) {
    return 'Transaction was rejected on your device.';
  }
  if (message.includes('nonce')) {
    return 'Transaction nonce conflict. Please try again.';
  }
  if (message.includes('gas')) {
    return 'Gas estimation failed. Network may be congested.';
  }

  return 'An unexpected error occurred. You can try reloading the popup or restarting the extension.';
};

export default ErrorFallback;
```

**Update Error Boundary**:
```typescript
// withErrorBoundary.tsx
export function withErrorBoundary<T extends Record<string, unknown>>(
  Component: ComponentType<T>,
  ErrorComponent?: ReactElement,
) {
  return function WithErrorBoundary(props: T) {
    const [error, setError] = useState<Error | null>(null);

    const resetError = () => {
      setError(null);
    };

    return (
      <ErrorBoundary
        fallback={ErrorComponent || <ErrorFallback error={error!} resetError={resetError} />}
        onError={setError}
      >
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
```

---

### Issue 2: Race Condition in Message Passing

**Current State**:
```typescript
// Transaction.tsx
useEffect(() => {
  const handleMessage = (message: any) => {
    if (message.action === 'transaction_error') {
      setErrorMessage('Transaction failed: ' + message.error);
    }
  };
  chrome.runtime.onMessage.addListener(handleMessage);
}, []);
```

**Problem**: Background script may send error before listener is registered

**Proposed Solution**:

Create `useBackgroundMessage` hook:
```typescript
// hooks/useBackgroundMessage.ts
import { useEffect, useRef, useState } from 'react';

interface MessageQueue {
  [key: string]: any[];
}

const messageQueue: MessageQueue = {};

// Global listener to catch early messages
chrome.runtime.onMessage.addListener((message) => {
  if (!messageQueue[message.action]) {
    messageQueue[message.action] = [];
  }
  messageQueue[message.action].push(message);

  // Keep only last 10 messages per action
  if (messageQueue[message.action].length > 10) {
    messageQueue[message.action].shift();
  }

  return false;
});

export const useBackgroundMessage = (
  action: string,
  handler: (message: any) => void
) => {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    // Process queued messages first
    if (messageQueue[action]) {
      messageQueue[action].forEach(msg => handlerRef.current(msg));
      messageQueue[action] = [];
    }

    // Listen for new messages
    const listener = (message: any) => {
      if (message.action === action) {
        handlerRef.current(message);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [action]);
};
```

**Usage**:
```typescript
// Transaction.tsx
useBackgroundMessage('transaction_error', (message) => {
  setErrorMessage('Transaction failed: ' + message.error);
  setTransactionInProgress(false);
});

useBackgroundMessage('transaction_complete', (message) => {
  setTxHash(message.txHash);
  setShowTxidPage(true);
  setAwaitingDeviceApproval(false);
});
```

---

### Issue 3: Event Storage Validation

**Current State**: No validation on event structure, crashes on access

**Proposed Solution**:

Add Zod validation:
```typescript
// packages/storage/lib/validation.ts
import { z } from 'zod';

export const EventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  networkId: z.string().min(1),
  chain: z.string().min(1),
  request: z.any(),
  status: z.enum(['request', 'approval', 'completed']),
  timestamp: z.string().datetime(),
  requestInfo: z.object({
    method: z.string(),
    params: z.array(z.any()),
    siteUrl: z.string().url().optional(),
  }).optional(),
});

export type ValidatedEvent = z.infer<typeof EventSchema>;

export const validateEvent = (event: unknown): ValidatedEvent | null => {
  try {
    return EventSchema.parse(event);
  } catch (error) {
    console.error('Invalid event structure:', error);
    return null;
  }
};
```

**Update Storage**:
```typescript
// customStorage.ts
export const createEventStorage = (storageKey: string) => {
  // ... existing code ...

  return {
    addEvent: async (event: any) => {
      const validatedEvent = validateEvent(event);
      if (!validatedEvent) {
        throw new Error('Invalid event structure');
      }

      const events = await storage.get();
      const updatedEvents = events ? [...events, validatedEvent] : [validatedEvent];
      await storage.set(() => updatedEvents);
    },

    getEvents: async () => {
      const events = await storage.get();
      if (!events) return [];

      // Filter out invalid events
      return events
        .map(validateEvent)
        .filter((e): e is ValidatedEvent => e !== null);
    },
  };
};
```

---

### Issue 4: Cryptic Error Messages

**Current State**:
```typescript
let errorMessage = JSON.stringify(error)
// Shows: {"code":4000,"message":"...","stack":"..."}
```

**Proposed Solution**:

Create error transformation utility:
```typescript
// utils/errorTransformer.ts
export enum ErrorCategory {
  DEVICE = 'device',
  NETWORK = 'network',
  USER = 'user',
  TRANSACTION = 'transaction',
  SYSTEM = 'system',
}

export interface TransformedError {
  category: ErrorCategory;
  title: string;
  message: string;
  recoverable: boolean;
  suggestions: string[];
  technicalDetails?: string;
}

export const transformError = (error: any): TransformedError => {
  const errorString = typeof error === 'string'
    ? error
    : error.message || JSON.stringify(error);

  // Device errors
  if (errorString.includes('unrecognized address') ||
      errorString.includes('device not initialized')) {
    return {
      category: ErrorCategory.DEVICE,
      title: 'Device Connection Issue',
      message: 'Your KeepKey device is not properly connected or paired.',
      recoverable: true,
      suggestions: [
        'Disconnect and reconnect your KeepKey',
        'Restart the KeepKey device',
        'Try a different USB port or cable',
        'Restart the extension'
      ],
      technicalDetails: errorString,
    };
  }

  if (errorString.includes('device not found') ||
      errorString.includes('disconnected')) {
    return {
      category: ErrorCategory.DEVICE,
      title: 'Device Not Found',
      message: 'KeepKey device is not connected.',
      recoverable: true,
      suggestions: [
        'Connect your KeepKey device',
        'Ensure the device is unlocked',
        'Check USB connection'
      ],
      technicalDetails: errorString,
    };
  }

  if (errorString.includes('user rejected') ||
      errorString.includes('cancelled')) {
    return {
      category: ErrorCategory.USER,
      title: 'Transaction Rejected',
      message: 'You rejected the transaction on your device.',
      recoverable: true,
      suggestions: [
        'Try again if this was a mistake',
        'Review transaction details carefully'
      ],
      technicalDetails: errorString,
    };
  }

  // Network errors
  if (errorString.includes('timeout') ||
      errorString.includes('network') ||
      errorString.includes('fetch failed')) {
    return {
      category: ErrorCategory.NETWORK,
      title: 'Network Error',
      message: 'Unable to connect to the blockchain network.',
      recoverable: true,
      suggestions: [
        'Check your internet connection',
        'Try again in a few moments',
        'The network may be experiencing high congestion'
      ],
      technicalDetails: errorString,
    };
  }

  if (errorString.includes('insufficient funds') ||
      errorString.includes('insufficient balance')) {
    return {
      category: ErrorCategory.TRANSACTION,
      title: 'Insufficient Balance',
      message: 'You don\'t have enough funds to complete this transaction.',
      recoverable: false,
      suggestions: [
        'Check your wallet balance',
        'Ensure you have enough for gas fees',
        'Try sending a smaller amount'
      ],
      technicalDetails: errorString,
    };
  }

  if (errorString.includes('nonce') ||
      errorString.includes('transaction already imported')) {
    return {
      category: ErrorCategory.TRANSACTION,
      title: 'Transaction Conflict',
      message: 'This transaction conflicts with a pending transaction.',
      recoverable: true,
      suggestions: [
        'Wait for pending transactions to complete',
        'Try again in a few moments',
        'Check your transaction history'
      ],
      technicalDetails: errorString,
    };
  }

  if (errorString.includes('gas') ||
      errorString.includes('fee')) {
    return {
      category: ErrorCategory.TRANSACTION,
      title: 'Gas Estimation Failed',
      message: 'Unable to estimate gas fees for this transaction.',
      recoverable: true,
      suggestions: [
        'Network may be congested',
        'Try again with a higher gas limit',
        'Check if the contract is valid'
      ],
      technicalDetails: errorString,
    };
  }

  // Chain unsupported
  if (errorString.includes('not supported') ||
      errorString.includes('unsupported chain')) {
    return {
      category: ErrorCategory.SYSTEM,
      title: 'Chain Not Supported',
      message: 'This blockchain is not supported by KeepKey.',
      recoverable: false,
      suggestions: [
        'Use a supported blockchain',
        'Check KeepKey documentation for supported chains'
      ],
      technicalDetails: errorString,
    };
  }

  // Generic fallback
  return {
    category: ErrorCategory.SYSTEM,
    title: 'Unexpected Error',
    message: 'An unexpected error occurred.',
    recoverable: true,
    suggestions: [
      'Try reloading the popup',
      'Check the browser console for details',
      'Restart the extension if the problem persists'
    ],
    technicalDetails: errorString,
  };
};
```

**Update Error Display**:
```typescript
// ErrorDisplay.tsx
import { transformError, TransformedError } from '@/utils/errorTransformer';

const ErrorDisplay: React.FC<{ error: string | Error }> = ({ error }) => {
  const transformedError = transformError(error);
  const [showTechnical, setShowTechnical] = useState(false);

  const getStatusColor = () => {
    switch (transformedError.category) {
      case ErrorCategory.USER: return 'orange';
      case ErrorCategory.NETWORK: return 'yellow';
      case ErrorCategory.DEVICE: return 'red';
      case ErrorCategory.TRANSACTION: return 'orange';
      default: return 'red';
    }
  };

  return (
    <Alert status="error" variant="left-accent" flexDirection="column">
      <AlertIcon />

      <Box width="100%">
        <AlertTitle fontSize="lg" mb={2}>
          {transformedError.title}
        </AlertTitle>

        <AlertDescription mb={3}>
          {transformedError.message}
        </AlertDescription>

        {transformedError.suggestions.length > 0 && (
          <Box mb={3}>
            <Text fontSize="sm" fontWeight="bold" mb={1}>What to try:</Text>
            <UnorderedList fontSize="sm" spacing={1}>
              {transformedError.suggestions.map((suggestion, idx) => (
                <ListItem key={idx}>{suggestion}</ListItem>
              ))}
            </UnorderedList>
          </Box>
        )}

        <HStack spacing={2}>
          {transformedError.recoverable && (
            <Button size="sm" colorScheme="blue" onClick={onRetry}>
              Try Again
            </Button>
          )}

          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>

          {transformedError.technicalDetails && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTechnical(!showTechnical)}
            >
              {showTechnical ? 'Hide' : 'Show'} Details
            </Button>
          )}
        </HStack>

        {showTechnical && transformedError.technicalDetails && (
          <Code mt={3} p={2} fontSize="xs" display="block" maxHeight="150px" overflowY="auto">
            {transformedError.technicalDetails}
          </Code>
        )}
      </Box>
    </Alert>
  );
};
```

---

### Issue 5: State Desync on RESET_APP

**Current State**: Nuclear option that reloads entire extension

**Proposed Solution**:

Add granular recovery strategies:
```typescript
// background/recovery.ts
export enum RecoveryStrategy {
  RELOAD_POPUP = 'reload_popup',
  CLEAR_EVENTS = 'clear_events',
  RESTART_APP = 'restart_app',
  RECONNECT_DEVICE = 'reconnect_device',
  RESET_PROVIDER = 'reset_provider',
  FULL_RESET = 'full_reset',
}

export const executeRecovery = async (strategy: RecoveryStrategy) => {
  const tag = ' | executeRecovery | ';
  console.log(tag, 'Executing recovery strategy:', strategy);

  switch (strategy) {
    case RecoveryStrategy.RELOAD_POPUP:
      // Just notify popup to reload itself
      chrome.runtime.sendMessage({
        action: 'reload_popup_window'
      });
      break;

    case RecoveryStrategy.CLEAR_EVENTS:
      // Clear pending events only
      await requestStorage.clearEvents();
      chrome.runtime.sendMessage({
        action: 'events_cleared'
      });
      break;

    case RecoveryStrategy.RESTART_APP:
      // Reinitialize APP without full reload
      await onStart();
      chrome.runtime.sendMessage({
        action: 'app_restarted',
        state: KEEPKEY_STATE
      });
      break;

    case RecoveryStrategy.RECONNECT_DEVICE:
      // Clear device state and reconnect
      KEEPKEY_STATE = 0;
      APP = null;
      await onStart();
      break;

    case RecoveryStrategy.RESET_PROVIDER:
      // Reset to default provider
      const defaultProvider = {
        chainId: '0x1',
        caip: 'eip155:1/slip44:60',
        name: 'Ethereum',
        providerUrl: 'https://eth.llamarpc.com',
      };
      await web3ProviderStorage.saveWeb3Provider(defaultProvider);
      break;

    case RecoveryStrategy.FULL_RESET:
      // Last resort: full extension reload
      chrome.runtime.reload();
      break;

    default:
      console.error(tag, 'Unknown recovery strategy:', strategy);
  }
};

// Add to message listener
case 'EXECUTE_RECOVERY': {
  const { strategy } = message;
  await executeRecovery(strategy);
  sendResponse({ success: true });
  break;
}
```

**Smart Recovery Decision**:
```typescript
// utils/recoveryDecision.ts
export const decideRecoveryStrategy = (error: TransformedError): RecoveryStrategy => {
  switch (error.category) {
    case ErrorCategory.USER:
      return RecoveryStrategy.CLEAR_EVENTS;

    case ErrorCategory.NETWORK:
      return RecoveryStrategy.RESET_PROVIDER;

    case ErrorCategory.DEVICE:
      return RecoveryStrategy.RECONNECT_DEVICE;

    case ErrorCategory.TRANSACTION:
      return RecoveryStrategy.CLEAR_EVENTS;

    case ErrorCategory.SYSTEM:
      return RecoveryStrategy.FULL_RESET;

    default:
      return RecoveryStrategy.RELOAD_POPUP;
  }
};
```

---

### Issue 6: No Error Persistence

**Problem**: Errors disappear on popup close, no history

**Proposed Solution**:

Create error log storage:
```typescript
// packages/storage/lib/errorStorage.ts
export interface ErrorLog {
  id: string;
  timestamp: string;
  error: TransformedError;
  context: {
    eventId?: string;
    chain?: string;
    method?: string;
    url?: string;
  };
  resolved: boolean;
}

export const errorLogStorage = createStorage<ErrorLog[]>(
  'keepkey-error-logs',
  [],
  {
    storageType: StorageType.Local,
    liveUpdate: true,
  }
);

export const logError = async (
  error: TransformedError,
  context: ErrorLog['context']
): Promise<void> => {
  const errorLog: ErrorLog = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    error,
    context,
    resolved: false,
  };

  const logs = await errorLogStorage.get();

  // Keep only last 50 errors
  const updatedLogs = [errorLog, ...logs].slice(0, 50);

  await errorLogStorage.set(() => updatedLogs);
};

export const getRecentErrors = async (): Promise<ErrorLog[]> => {
  const logs = await errorLogStorage.get();
  return logs.filter(log => {
    const age = Date.now() - new Date(log.timestamp).getTime();
    return age < 24 * 60 * 60 * 1000; // Last 24 hours
  });
};
```

**Error History View**:
```typescript
// components/ErrorHistory.tsx
const ErrorHistory: React.FC = () => {
  const [errors, setErrors] = useState<ErrorLog[]>([]);

  useEffect(() => {
    getRecentErrors().then(setErrors);
  }, []);

  return (
    <Box>
      <Heading size="md" mb={4}>Recent Errors</Heading>

      {errors.length === 0 ? (
        <Text color="gray.500">No recent errors</Text>
      ) : (
        <VStack spacing={2} align="stretch">
          {errors.map(log => (
            <Box key={log.id} p={3} borderWidth={1} borderRadius="md">
              <HStack justify="space-between">
                <Badge colorScheme={log.resolved ? 'green' : 'red'}>
                  {log.resolved ? 'Resolved' : 'Unresolved'}
                </Badge>
                <Text fontSize="xs" color="gray.500">
                  {new Date(log.timestamp).toLocaleString()}
                </Text>
              </HStack>

              <Text fontWeight="bold" mt={2}>{log.error.title}</Text>
              <Text fontSize="sm">{log.error.message}</Text>

              {log.context.method && (
                <Text fontSize="xs" color="gray.600" mt={1}>
                  Method: {log.context.method}
                </Text>
              )}
            </Box>
          ))}
        </VStack>
      )}
    </Box>
  );
};
```

---

## Implementation Priority

### Phase 1: Critical (Week 1)
1. ✅ Enhanced Error Boundary with recovery options
2. ✅ Error message transformation utility
3. ✅ Event validation with Zod

### Phase 2: Important (Week 2)
4. ✅ Message passing race condition fix
5. ✅ Granular recovery strategies
6. ✅ Error display component

### Phase 3: Enhancement (Week 3)
7. ✅ Error logging and persistence
8. ✅ Error history view
9. ✅ Recovery strategy decision logic

---

## Testing Strategy

### Unit Tests
```typescript
// errorTransformer.test.ts
describe('transformError', () => {
  it('should identify device errors', () => {
    const error = new Error('unrecognized address');
    const transformed = transformError(error);
    expect(transformed.category).toBe(ErrorCategory.DEVICE);
    expect(transformed.recoverable).toBe(true);
  });

  it('should identify user rejection', () => {
    const error = new Error('user rejected transaction');
    const transformed = transformError(error);
    expect(transformed.category).toBe(ErrorCategory.USER);
  });
});
```

### Integration Tests
```typescript
// Transaction.test.tsx
describe('Transaction Error Handling', () => {
  it('should display user-friendly error on transaction failure', async () => {
    // Mock background message
    chrome.runtime.onMessage.callListeners({
      action: 'transaction_error',
      error: 'insufficient funds'
    });

    await waitFor(() => {
      expect(screen.getByText('Insufficient Balance')).toBeInTheDocument();
    });
  });
});
```

### E2E Tests
```typescript
// e2e/errorScenarios.spec.ts
test('should handle device disconnection gracefully', async ({ page }) => {
  // Disconnect device (mock)
  await mockDeviceDisconnect();

  // Attempt transaction
  await page.click('[data-testid="send-button"]');

  // Verify error shown
  await expect(page.locator('[data-testid="error-alert"]')).toContainText('Device Not Found');

  // Verify recovery options
  await expect(page.locator('[data-testid="recovery-button"]')).toBeVisible();
});
```

---

## Rollout Plan

### Step 1: Add Error Utilities (No Breaking Changes)
- Add `errorTransformer.ts`
- Add `validation.ts`
- Add unit tests

### Step 2: Update Error Boundary
- Replace generic fallback
- Add `ErrorFallback` component
- Test in isolation

### Step 3: Update Transaction Component
- Add `useBackgroundMessage` hook
- Integrate error transformation
- Add error display component

### Step 4: Add Recovery Strategies
- Implement recovery functions in background
- Add recovery decision logic
- Update message handlers

### Step 5: Add Error Logging
- Create error log storage
- Add logging to all error paths
- Create error history view

---

## Monitoring & Metrics

### Error Metrics to Track
- Error frequency by category
- Recovery success rate by strategy
- Time to error resolution
- Repeat error patterns
- User abandonment after error

### Logging Strategy
```typescript
// analytics/errorTracking.ts
export const trackError = async (error: TransformedError, context: any) => {
  // Log to console
  console.error('[KeepKey Error]', {
    category: error.category,
    title: error.title,
    context,
  });

  // Store locally
  await logError(error, context);

  // Optional: Send to analytics (privacy-respecting)
  // Only track error categories, not sensitive data
  if (ANALYTICS_ENABLED) {
    sendAnalytics('error_occurred', {
      category: error.category,
      recoverable: error.recoverable,
      timestamp: Date.now(),
    });
  }
};
```

---

## Documentation Updates

### User-Facing
- Update README with common error solutions
- Add troubleshooting guide
- Create error code reference

### Developer-Facing
- Document error transformation API
- Add recovery strategy guide
- Update architecture docs

---

## Success Criteria

- ✅ Zero "Error Occur" messages shown to users
- ✅ 90%+ of errors show user-friendly messages
- ✅ 80%+ of recoverable errors successfully recovered
- ✅ Zero popup crashes from malformed events
- ✅ All message passing race conditions eliminated
- ✅ Error logs available for debugging

---

**Last Updated**: 2025-01-03
**Status**: Proposed
