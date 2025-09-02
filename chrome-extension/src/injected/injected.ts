import type {
  WalletRequestInfo,
  WalletMessage,
  ProviderInfo,
  WalletCallback,
  InjectionState,
  ChainType,
  WalletProvider,
  KeepKeyWindow,
} from './types';

(function () {
  const TAG = ' | KeepKeyInjected | ';
  const VERSION = '2.0.0';
  const MAX_RETRY_COUNT = 3;
  const RETRY_DELAY = 100; // ms
  const CALLBACK_TIMEOUT = 30000; // 30 seconds
  const MESSAGE_QUEUE_MAX = 100;

  const kWindow = window as KeepKeyWindow;

  // Enhanced injection state tracking
  const injectionState: InjectionState = {
    isInjected: false,
    version: VERSION,
    injectedAt: Date.now(),
    retryCount: 0,
  };

  // Check for existing injection with version comparison
  if (kWindow.keepkeyInjectionState) {
    const existing = kWindow.keepkeyInjectionState;
    console.warn(TAG, `Existing injection detected v${existing.version}, current v${VERSION}`);

    // Only skip if same or newer version
    if (existing.version >= VERSION) {
      console.log(TAG, 'Skipping injection, newer or same version already present');
      return;
    }
    console.log(TAG, 'Upgrading injection to newer version');
  }

  // Set injection state
  kWindow.keepkeyInjectionState = injectionState;

  console.log(TAG, `Initializing KeepKey Injection v${VERSION}`);

  // Enhanced source information
  const SOURCE_INFO = {
    siteUrl: window.location.href,
    scriptSource: 'KeepKey Extension',
    version: VERSION,
    injectedTime: new Date().toISOString(),
    origin: window.location.origin,
    protocol: window.location.protocol,
  };

  let messageId = 0;
  const callbacks = new Map<number, WalletCallback>();
  const messageQueue: WalletMessage[] = [];
  let isContentScriptReady = false;

  // Cleanup old callbacks periodically
  const cleanupCallbacks = () => {
    const now = Date.now();
    callbacks.forEach((callback, id) => {
      if (now - callback.timestamp > CALLBACK_TIMEOUT) {
        console.warn(TAG, `Callback timeout for request ${id} (${callback.method})`);
        callback.callback(new Error('Request timeout'));
        callbacks.delete(id);
      }
    });
  };

  setInterval(cleanupCallbacks, 5000);

  // Manage message queue size
  const addToQueue = (message: WalletMessage) => {
    if (messageQueue.length >= MESSAGE_QUEUE_MAX) {
      console.warn(TAG, 'Message queue full, removing oldest message');
      messageQueue.shift();
    }
    messageQueue.push(message);
  };

  // Process queued messages when content script becomes ready
  const processQueue = () => {
    if (!isContentScriptReady) return;

    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      if (message) {
        window.postMessage(message, window.location.origin);
      }
    }
  };

  // Verify injection with content script
  const verifyInjection = (retryCount = 0): Promise<boolean> => {
    return new Promise(resolve => {
      const verifyId = ++messageId;
      const timeout = setTimeout(() => {
        if (retryCount < MAX_RETRY_COUNT) {
          console.log(TAG, `Verification attempt ${retryCount + 1} failed, retrying...`);
          setTimeout(
            () => {
              verifyInjection(retryCount + 1).then(resolve);
            },
            RETRY_DELAY * Math.pow(2, retryCount),
          ); // Exponential backoff
        } else {
          console.error(TAG, 'Failed to verify injection after max retries');
          injectionState.lastError = 'Failed to verify injection';
          resolve(false);
        }
      }, 1000);

      const handleVerification = (event: MessageEvent) => {
        if (
          event.source === window &&
          event.data?.source === 'keepkey-content' &&
          event.data?.type === 'INJECTION_CONFIRMED' &&
          event.data?.requestId === verifyId
        ) {
          clearTimeout(timeout);
          window.removeEventListener('message', handleVerification);
          isContentScriptReady = true;
          injectionState.isInjected = true;
          console.log(TAG, 'Injection verified successfully');
          processQueue();
          resolve(true);
        }
      };

      window.addEventListener('message', handleVerification);

      // Send verification request
      window.postMessage(
        {
          source: 'keepkey-injected',
          type: 'INJECTION_VERIFY',
          requestId: verifyId,
          version: VERSION,
          timestamp: Date.now(),
        } as WalletMessage,
        window.location.origin,
      );
    });
  };

  // Enhanced wallet request with validation
  function walletRequest(
    method: string,
    params: any[] = [],
    chain: ChainType,
    callback: (error: any, result?: any) => void,
  ) {
    const tag = TAG + ' | walletRequest | ';

    // Validate inputs
    if (!method || typeof method !== 'string') {
      console.error(tag, 'Invalid method:', method);
      callback(new Error('Invalid method'));
      return;
    }

    if (!Array.isArray(params)) {
      console.warn(tag, 'Params not an array, wrapping:', params);
      params = [params];
    }

    try {
      const requestId = ++messageId;
      const requestInfo: WalletRequestInfo = {
        id: requestId,
        method,
        params,
        chain,
        siteUrl: SOURCE_INFO.siteUrl,
        scriptSource: SOURCE_INFO.scriptSource,
        version: SOURCE_INFO.version,
        requestTime: new Date().toISOString(),
        referrer: document.referrer,
        href: window.location.href,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      };

      // Store callback with metadata
      callbacks.set(requestId, {
        callback,
        timestamp: Date.now(),
        method,
      });

      const message: WalletMessage = {
        source: 'keepkey-injected',
        type: 'WALLET_REQUEST',
        requestId,
        requestInfo,
        timestamp: Date.now(),
      };

      if (isContentScriptReady) {
        window.postMessage(message, window.location.origin);
      } else {
        console.log(tag, 'Content script not ready, queueing request');
        addToQueue(message);
      }
    } catch (error) {
      console.error(tag, 'Error in walletRequest:', error);
      callback(error);
    }
  }

  // Listen for responses with enhanced validation
  window.addEventListener('message', (event: MessageEvent) => {
    const tag = TAG + ' | message | ';

    // Security: Validate origin
    if (event.source !== window) return;

    const data = event.data as WalletMessage;
    if (!data || typeof data !== 'object') return;

    // Handle injection confirmation
    if (data.source === 'keepkey-content' && data.type === 'INJECTION_CONFIRMED') {
      isContentScriptReady = true;
      processQueue();
      return;
    }

    // Handle wallet responses
    if (data.source === 'keepkey-content' && data.type === 'WALLET_RESPONSE' && data.requestId) {
      const callback = callbacks.get(data.requestId);
      if (callback) {
        if (data.error) {
          callback.callback(data.error);
        } else {
          callback.callback(null, data.result);
        }
        callbacks.delete(data.requestId);
      } else {
        console.warn(tag, 'No callback found for requestId:', data.requestId);
      }
    }
  });

  // Create wallet provider with proper typing
  function createWalletObject(chain: ChainType): WalletProvider {
    console.log(TAG, 'Creating wallet object for chain:', chain);

    const wallet: WalletProvider = {
      network: 'mainnet',
      isKeepKey: true,
      isMetaMask: true,
      isConnected: isContentScriptReady,

      request: ({ method, params = [] }) => {
        return new Promise((resolve, reject) => {
          walletRequest(method, params, chain, (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          });
        });
      },

      send: (payload: any, param1?: any, callback?: any) => {
        if (!payload.chain) {
          payload.chain = chain;
        }

        if (typeof callback === 'function') {
          // Async send
          walletRequest(payload.method, payload.params || param1, chain, (error, result) => {
            if (error) {
              callback(error);
            } else {
              callback(null, { id: payload.id, jsonrpc: '2.0', result });
            }
          });
        } else {
          // Sync send (deprecated, but required for compatibility)
          console.warn(TAG, 'Synchronous send is deprecated and may not work properly');
          return { id: payload.id, jsonrpc: '2.0', result: null };
        }
      },

      sendAsync: (payload: any, param1?: any, callback?: any) => {
        if (!payload.chain) {
          payload.chain = chain;
        }

        const cb = callback || param1;
        if (typeof cb !== 'function') {
          console.error(TAG, 'sendAsync requires a callback function');
          return;
        }

        walletRequest(payload.method, payload.params || param1, chain, (error, result) => {
          if (error) {
            cb(error);
          } else {
            cb(null, { id: payload.id, jsonrpc: '2.0', result });
          }
        });
      },

      on: (event: string, handler: Function) => {
        window.addEventListener(event, handler as EventListener);
      },

      removeListener: (event: string, handler: Function) => {
        window.removeEventListener(event, handler as EventListener);
      },

      removeAllListeners: () => {
        // This would require tracking all listeners
        console.warn(TAG, 'removeAllListeners not fully implemented');
      },
    };

    // Add chain-specific properties
    if (chain === 'ethereum') {
      wallet.chainId = '0x1';
      wallet.networkVersion = '1';
    }

    return wallet;
  }

  // EIP-6963 Provider Announcement
  function announceProvider(ethereumProvider: WalletProvider) {
    const info: ProviderInfo = {
      uuid: '350670db-19fa-4704-a166-e52e178b59d4',
      name: 'KeepKey Client',
      icon: 'https://pioneers.dev/coins/keepkey.png',
      rdns: 'com.keepkey',
    };

    const announceEvent = new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider: ethereumProvider }),
    });

    console.log(TAG, 'Announcing EIP-6963 provider');
    window.dispatchEvent(announceEvent);
  }

  // Mount wallet with proper state management
  async function mountWallet() {
    const tag = TAG + ' | mountWallet | ';
    console.log(tag, 'Starting wallet mount process');

    // Wait for injection verification
    const verified = await verifyInjection();
    if (!verified) {
      console.error(tag, 'Failed to verify injection, wallet features may not work');
      // Continue anyway for compatibility, but flag the issue
      injectionState.lastError = 'Injection not verified';
    }

    // Create wallet objects
    const ethereum = createWalletObject('ethereum');
    const xfi: Record<string, WalletProvider> = {
      binance: createWalletObject('binance'),
      bitcoin: createWalletObject('bitcoin'),
      bitcoincash: createWalletObject('bitcoincash'),
      dogecoin: createWalletObject('dogecoin'),
      dash: createWalletObject('dash'),
      ethereum: ethereum,
      keplr: createWalletObject('keplr'),
      litecoin: createWalletObject('litecoin'),
      thorchain: createWalletObject('thorchain'),
      mayachain: createWalletObject('mayachain'),
    };

    const keepkey: Record<string, WalletProvider> = {
      binance: createWalletObject('binance'),
      bitcoin: createWalletObject('bitcoin'),
      bitcoincash: createWalletObject('bitcoincash'),
      dogecoin: createWalletObject('dogecoin'),
      dash: createWalletObject('dash'),
      ethereum: ethereum,
      osmosis: createWalletObject('osmosis'),
      cosmos: createWalletObject('cosmos'),
      litecoin: createWalletObject('litecoin'),
      thorchain: createWalletObject('thorchain'),
      mayachain: createWalletObject('mayachain'),
      ripple: createWalletObject('ripple'),
    };

    // Mount providers with conflict detection
    const mountProvider = (name: string, provider: any) => {
      if ((kWindow as any)[name]) {
        console.warn(tag, `${name} already exists, checking if override is allowed`);
        // TODO: Add user preference check here
      }

      try {
        Object.defineProperty(kWindow, name, {
          value: provider,
          writable: false,
          configurable: true, // Allow reconfiguration for updates
        });
        console.log(tag, `Successfully mounted window.${name}`);
      } catch (e) {
        console.error(tag, `Failed to mount window.${name}:`, e);
        injectionState.lastError = `Failed to mount ${name}`;
      }
    };

    // Mount providers
    mountProvider('ethereum', ethereum);
    mountProvider('xfi', xfi);
    mountProvider('keepkey', keepkey);

    // Announce EIP-6963 provider
    announceProvider(ethereum);

    // Listen for re-announcement requests
    window.addEventListener('eip6963:requestProvider', () => {
      console.log(tag, 'Re-announcing provider on request');
      announceProvider(ethereum);
    });

    // Handle chain changes and other events
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'CHAIN_CHANGED' && ethereum.emit) {
        console.log(tag, 'Chain changed:', event.data);
        ethereum.emit('chainChanged', event.data.provider?.chainId);
      }
    });

    console.log(tag, 'Wallet mount complete');
  }

  // Initialize based on document state
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWallet);
  } else {
    // Document already loaded, mount immediately
    mountWallet();
  }

  console.log(TAG, 'Injection script loaded and initialized');
})();
