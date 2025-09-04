// Enhanced content script with injection verification and security improvements

import type { WalletMessage } from '../../../chrome-extension/src/injected/types';

const TAG = ' | KeepKeyContent | ';
const ALLOWED_ORIGINS = ['http://localhost', 'https://localhost']; // Add allowed origins
const INJECTION_TIMEOUT = 5000; // 5 seconds
const MAX_INJECTION_RETRIES = 3;

console.log(TAG, 'Content script initializing');

// Track injection state
let injectionAttempts = 0;
let isInjected = false;

// Validate message origin (configurable)
function isAllowedOrigin(origin: string): boolean {
  // In production, this should check against user settings
  // For now, allow all origins but log them
  console.log(TAG, 'Message from origin:', origin);
  return true; // TODO: Implement proper origin validation
}

// Validate message structure
function isValidWalletMessage(data: any): data is WalletMessage {
  if (!data || typeof data !== 'object') return false;
  if (!data.source || !data.type) return false;
  if (data.source !== 'keepkey-injected') return false;
  if (!['WALLET_REQUEST', 'INJECTION_VERIFY'].includes(data.type)) return false;
  return true;
}

// Message handler with validation
window.addEventListener('message', (event: MessageEvent) => {
  // Security: Check origin
  if (event.source !== window) return;
  if (!isAllowedOrigin(event.origin)) {
    console.warn(TAG, 'Rejected message from untrusted origin:', event.origin);
    return;
  }

  const data = event.data as WalletMessage;

  // Handle injection verification
  if (data?.source === 'keepkey-injected' && data.type === 'INJECTION_VERIFY') {
    console.log(TAG, 'Received injection verification request');
    window.postMessage(
      {
        source: 'keepkey-content',
        type: 'INJECTION_CONFIRMED',
        requestId: data.requestId,
        version: data.version,
        timestamp: Date.now(),
      } as WalletMessage,
      '*',
    );
    isInjected = true;
    return;
  }

  // Validate wallet request
  if (!isValidWalletMessage(data)) {
    if (data?.source === 'keepkey-injected') {
      console.warn(TAG, 'Invalid message structure:', data);
    }
    return;
  }

  if (data.type === 'WALLET_REQUEST' && data.requestInfo) {
    const { requestId, requestInfo } = data;
    console.log(TAG, `Processing ${requestInfo.method} request from ${requestInfo.siteUrl}`);

    // Add request timestamp for tracking
    const requestWithMetadata = {
      ...requestInfo,
      receivedAt: Date.now(),
      contentScriptVersion: '2.0.0',
    };

    // Forward to background script with timeout
    const timeout = setTimeout(() => {
      console.error(TAG, 'Background script timeout for request:', requestId);
      window.postMessage(
        {
          source: 'keepkey-content',
          type: 'WALLET_RESPONSE',
          requestId,
          error: { code: -32603, message: 'Internal error: Request timeout' },
        } as WalletMessage,
        '*',
      );
    }, 30000); // 30 second timeout

    // Check if extension context is still valid before sending message
    if (!chrome.runtime?.id) {
      console.error(TAG, 'Extension context invalidated, reloading page...');
      window.postMessage(
        {
          source: 'keepkey-content',
          type: 'WALLET_RESPONSE',
          requestId,
          error: {
            code: -32603,
            message: 'Extension reloaded. Please refresh the page.',
          },
        } as WalletMessage,
        '*',
      );
      // Optionally reload the page
      setTimeout(() => window.location.reload(), 1000);
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'WALLET_REQUEST', requestInfo: requestWithMetadata }, response => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          console.error(TAG, 'Background communication error:', chrome.runtime.lastError);

          // Check if it's a context invalidation error
          if (chrome.runtime.lastError.message?.includes('context invalidated')) {
            window.postMessage(
              {
                source: 'keepkey-content',
                type: 'WALLET_RESPONSE',
                requestId,
                error: {
                  code: -32603,
                  message: 'Extension was reloaded. Please refresh the page.',
                },
              } as WalletMessage,
              '*',
            );
            // Trigger page reload after a short delay
            setTimeout(() => window.location.reload(), 1000);
          } else {
            window.postMessage(
              {
                source: 'keepkey-content',
                type: 'WALLET_RESPONSE',
                requestId,
                error: {
                  code: -32603,
                  message: `Internal error: ${chrome.runtime.lastError.message}`,
                },
              } as WalletMessage,
              '*',
            );
          }
          return;
        }

        console.log(TAG, 'Received response from background:', response);

        // Send response back to injected script
        window.postMessage(
          {
            source: 'keepkey-content',
            type: 'WALLET_RESPONSE',
            requestId,
            result: response?.result || null,
            error: response?.error || null,
          } as WalletMessage,
          '*',
        );
      });
    } catch (error) {
      console.error(TAG, 'Failed to send message to background:', error);
      window.postMessage(
        {
          source: 'keepkey-content',
          type: 'WALLET_RESPONSE',
          requestId,
          error: {
            code: -32603,
            message: 'Failed to communicate with extension. Please refresh the page.',
          },
        } as WalletMessage,
        '*',
      );
    }
  }
});

// Enhanced injection function with verification
async function injectProviderScript(): Promise<boolean> {
  const tag = TAG + ' | inject | ';

  return new Promise(resolve => {
    try {
      // Check if already injected
      if (isInjected) {
        console.log(tag, 'Script already injected');
        resolve(true);
        return;
      }

      console.log(tag, `Injection attempt ${injectionAttempts + 1}`);
      injectionAttempts++;

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.id = 'keepkey-injected-script';

      // Set script attributes for security
      script.setAttribute('data-version', '2.0.0');
      script.setAttribute('data-timestamp', Date.now().toString());

      const timeout = setTimeout(() => {
        console.warn(tag, 'Injection verification timeout');
        script.remove();
        resolve(false);
      }, INJECTION_TIMEOUT);

      // Wait for script to load and verify injection
      script.onload = () => {
        console.log(tag, 'Script loaded, waiting for verification...');

        // Listen for verification
        const verifyHandler = (event: MessageEvent) => {
          if (
            event.source === window &&
            event.data?.source === 'keepkey-injected' &&
            event.data?.type === 'INJECTION_VERIFY'
          ) {
            clearTimeout(timeout);
            window.removeEventListener('message', verifyHandler);
            console.log(tag, 'Injection verified successfully');
            isInjected = true;

            // Send confirmation
            window.postMessage(
              {
                source: 'keepkey-content',
                type: 'INJECTION_CONFIRMED',
                requestId: event.data.requestId,
                version: event.data.version,
                timestamp: Date.now(),
              } as WalletMessage,
              '*',
            );

            resolve(true);
          }
        };

        window.addEventListener('message', verifyHandler);
      };

      script.onerror = error => {
        console.error(tag, 'Script load error:', error);
        clearTimeout(timeout);
        resolve(false);
      };

      // Inject the script
      const target = document.head || document.documentElement;
      if (!target) {
        console.error(tag, 'No suitable injection target found');
        resolve(false);
        return;
      }

      target.appendChild(script);

      // Remove script tag after injection (cleanup)
      setTimeout(() => {
        if (script.parentNode) {
          script.remove();
        }
      }, 100);
    } catch (error) {
      console.error(tag, 'Injection error:', error);
      resolve(false);
    }
  });
}

// Retry injection with exponential backoff
async function injectWithRetry(): Promise<boolean> {
  for (let i = 0; i < MAX_INJECTION_RETRIES; i++) {
    const success = await injectProviderScript();
    if (success) {
      console.log(TAG, 'Injection successful');
      return true;
    }

    if (i < MAX_INJECTION_RETRIES - 1) {
      const delay = Math.pow(2, i) * 100; // Exponential backoff: 100ms, 200ms, 400ms
      console.log(TAG, `Retrying injection in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error(TAG, 'Failed to inject after maximum retries');
  return false;
}

// Use MutationObserver for better injection timing
function waitForInjectionTarget(): Promise<void> {
  return new Promise(resolve => {
    // If document is ready, resolve immediately
    if (document.head || document.documentElement) {
      resolve();
      return;
    }

    // Otherwise, wait for it
    const observer = new MutationObserver(() => {
      if (document.head || document.documentElement) {
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document, {
      childList: true,
      subtree: true,
    });

    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 5000);
  });
}

// Initialize injection based on document state
async function initialize() {
  console.log(TAG, 'Initializing content script');

  // Wait for injection target to be available
  await waitForInjectionTarget();

  // Attempt injection
  const injected = await injectWithRetry();

  if (!injected) {
    console.error(TAG, 'Failed to inject provider script');
    // Notify background script of failure
    chrome.runtime.sendMessage({
      type: 'INJECTION_FAILED',
      error: 'Failed to inject provider script after retries',
      url: window.location.href,
    });
  } else {
    // Notify background script of success
    chrome.runtime.sendMessage({
      type: 'INJECTION_SUCCESS',
      url: window.location.href,
      timestamp: Date.now(),
    });
  }
}

// Start initialization
initialize().catch(error => {
  console.error(TAG, 'Initialization error:', error);
});

// Handle page visibility changes (for single-page apps)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !isInjected) {
    console.log(TAG, 'Page became visible, checking injection status');
    injectWithRetry();
  }
});

// Re-inject on navigation for single-page applications
let lastUrl = window.location.href;
const checkForUrlChange = () => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log(TAG, 'URL changed, checking injection status');
    if (!isInjected) {
      injectWithRetry();
    }
  }
};

// Check for URL changes periodically (for SPAs)
setInterval(checkForUrlChange, 1000);

console.log(TAG, 'Content script loaded');
