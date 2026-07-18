// Enhanced content script with injection verification and security improvements

import type { WalletMessage } from '../../../chrome-extension/src/injected/types';
import { installAgentDom } from './agentDom';

const INJECTION_TIMEOUT = 5000; // 5 seconds
const MAX_INJECTION_RETRIES = 3;

// Track injection state
let injectionAttempts = 0;
let isInjected = false;

/**
 * Masking settings snapshot, read once before injection. The injected
 * script lives in the page's main world and has no chrome.storage access,
 * so we have to hand the settings off via a DOM attribute on the script
 * tag — it reads them synchronously at startup via
 * `document.getElementById('keepkey-injected-script')?.dataset.masking`.
 *
 * Note: this snapshot is read-once per page load. Toggling a setting in
 * the extension UI requires a page refresh to take effect — there's no
 * live wire from the sidebar to an already-injected provider.
 */
interface MaskingSettings {
  enableMetaMaskMasking: boolean;
  enableXfiMasking: boolean;
  enableKeplrMasking: boolean;
  enablePhantomMasking: boolean;
}

// ponytail: must stay in sync with maskingSettingsStorage defaults in
// packages/storage/lib/customStorage.ts. The Settings UI reads masking
// through that storage (so unset keys show the storage defaults), but this
// content script reads chrome.storage.local raw — and createStorage never
// persists its defaults. If a user never toggles a switch the key is absent,
// so these MUST match or the UI shows masking ON while the injected provider
// silently runs all-off (no window.ethereum for legacy dApps).
const MASKING_DEFAULTS: MaskingSettings = {
  enableMetaMaskMasking: true,
  enableXfiMasking: false,
  enableKeplrMasking: false,
  enablePhantomMasking: true,
};

async function readMaskingSettings(): Promise<MaskingSettings> {
  try {
    const result = await chrome.storage.local.get('masking-settings');
    const raw = result?.['masking-settings'];
    if (!raw || typeof raw !== 'object') return MASKING_DEFAULTS;
    // `?? default` (not `=== true`) so a present-but-partial object keeps the
    // storage defaults for missing fields instead of forcing them false. A
    // stored boolean (incl. an explicit false) is always respected.
    return {
      enableMetaMaskMasking: raw.enableMetaMaskMasking ?? MASKING_DEFAULTS.enableMetaMaskMasking,
      enableXfiMasking: raw.enableXfiMasking ?? MASKING_DEFAULTS.enableXfiMasking,
      enableKeplrMasking: raw.enableKeplrMasking ?? MASKING_DEFAULTS.enableKeplrMasking,
      enablePhantomMasking: raw.enablePhantomMasking ?? MASKING_DEFAULTS.enablePhantomMasking,
    };
  } catch {
    return MASKING_DEFAULTS;
  }
}

// Kick off the storage read at content-script load so it parallelises
// with `waitForInjectionTarget()` — by the time we're ready to create
// the <script> tag, the settings Promise is usually already resolved.
// Avoids adding a serial round-trip that would widen the race against
// sites doing synchronous `window.ethereum` detection on document_start.
const maskingReady = readMaskingSettings();

// Validate message origin. Defence-in-depth on top of the
// `event.source === window` check below: that guard already blocks
// cross-frame injection, and this one rejects anything whose origin
// doesn't match the frame we're installed in. The content script is
// injected per-frame, so window.location.origin is the "right" origin
// for every message we legitimately handle. `null` origins (sandboxed
// iframes, data: URLs) are allowed for same-window messages — they're
// common in test harnesses and can't forge arbitrary origins.
function isAllowedOrigin(origin: string): boolean {
  if (origin === window.location.origin) return true;
  if (origin === 'null') return true;
  return false;
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
    return;
  }

  const data = event.data;

  // Handle injection verification
  if (data?.source === 'keepkey-injected' && data.type === 'INJECTION_VERIFY') {
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
    return;
  }

  // Type is now narrowed to WalletMessage by the guard

  if (data.type === 'WALLET_REQUEST' && data.requestInfo) {
    const { requestId, requestInfo } = data;

    // Add request timestamp for tracking
    const requestWithMetadata = {
      ...requestInfo,
      receivedAt: Date.now(),
      contentScriptVersion: '2.0.0',
    };

    // Forward to background script with timeout
    const timeout = setTimeout(() => {
      window.postMessage(
        {
          source: 'keepkey-content',
          type: 'WALLET_RESPONSE',
          requestId,
          error: { code: -32603, message: 'Internal error: Request timeout' },
        } as WalletMessage,
        '*',
      );
    }, 300000); // 5 minute timeout (hardware wallet needs time)

    // Check if extension context is still valid before sending message
    if (!chrome.runtime?.id) {
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

        // Send response back to injected script. `|| null` would collapse
        // legitimate `false` / `0` / `''` results into null — wrong for any
        // JSON-RPC method with a falsy success value (e.g. a boolean
        // negative). Use explicit undefined checks.
        window.postMessage(
          {
            source: 'keepkey-content',
            type: 'WALLET_RESPONSE',
            requestId,
            result: response?.result !== undefined ? response.result : null,
            error: response?.error ?? null,
          } as WalletMessage,
          '*',
        );
      });
    } catch (_error) {
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
  // Masking read was kicked off at module load — should already be
  // settled by now, so this await is effectively sync.
  const masking = await maskingReady;

  return new Promise(resolve => {
    try {
      // Check if already injected
      if (isInjected) {
        resolve(true);
        return;
      }

      injectionAttempts++;

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.id = 'keepkey-injected-script';

      // Set script attributes for security
      script.setAttribute('data-version', '2.0.0');
      script.setAttribute('data-timestamp', Date.now().toString());
      script.setAttribute('data-masking', JSON.stringify(masking));

      const timeout = setTimeout(() => {
        script.remove();
        resolve(false);
      }, INJECTION_TIMEOUT);

      // Wait for script to load and verify injection
      script.onload = () => {
        // Listen for verification
        const verifyHandler = (event: MessageEvent) => {
          if (
            event.source === window &&
            event.data?.source === 'keepkey-injected' &&
            event.data?.type === 'INJECTION_VERIFY'
          ) {
            clearTimeout(timeout);
            window.removeEventListener('message', verifyHandler);
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

      script.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };

      // Inject the script
      const target = document.head || document.documentElement;
      if (!target) {
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
    } catch (_error) {
      resolve(false);
    }
  });
}

// Retry injection with exponential backoff
async function injectWithRetry(): Promise<boolean> {
  for (let i = 0; i < MAX_INJECTION_RETRIES; i++) {
    const success = await injectProviderScript();
    if (success) {
      return true;
    }

    if (i < MAX_INJECTION_RETRIES - 1) {
      const delay = Math.pow(2, i) * 100; // Exponential backoff: 100ms, 200ms, 400ms
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

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
  // Wait for injection target to be available
  await waitForInjectionTarget();

  // Attempt injection
  const injected = await injectWithRetry();

  if (!injected) {
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
initialize().catch(() => {
  // swallow initialization errors silently
});

// Handle page visibility changes (for single-page apps)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !isInjected) {
    injectWithRetry();
  }
});

// Re-inject on navigation for single-page applications
let lastUrl = window.location.href;
const checkForUrlChange = () => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    if (!isInjected) {
      injectWithRetry();
    }
  }
};

// Check for URL changes periodically (for SPAs)
setInterval(checkForUrlChange, 1000);

// Listen for background → content script messages and relay to injected script
// This enables EIP-1193 accountsChanged / chainChanged events for dApps
chrome.runtime.onMessage.addListener((message: any) => {
  if (message.type === 'ACCOUNTS_CHANGED') {
    window.postMessage({ type: 'ACCOUNTS_CHANGED', accounts: message.accounts }, '*');
  }
  if (message.type === 'CHAIN_CHANGED') {
    window.postMessage({ type: 'CHAIN_CHANGED', provider: message.provider }, '*');
  }
});

// Browser-driving MCP tools (bex_snapshot / bex_click / …) run their DOM work here.
installAgentDom();
