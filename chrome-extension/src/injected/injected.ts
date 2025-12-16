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

  // Event emitter implementation for EIP-1193 compatibility
  class EventEmitter {
    private events: Map<string, Set<Function>> = new Map();

    on(event: string, handler: Function) {
      if (!this.events.has(event)) {
        this.events.set(event, new Set());
      }
      this.events.get(event)!.add(handler);
    }

    off(event: string, handler: Function) {
      this.events.get(event)?.delete(handler);
    }

    removeListener(event: string, handler: Function) {
      this.off(event, handler);
    }

    removeAllListeners(event?: string) {
      if (event) {
        this.events.delete(event);
      } else {
        this.events.clear();
      }
    }

    emit(event: string, ...args: any[]) {
      this.events.get(event)?.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error(TAG, `Error in event handler for ${event}:`, error);
        }
      });
    }

    once(event: string, handler: Function) {
      const onceHandler = (...args: any[]) => {
        handler(...args);
        this.off(event, onceHandler);
      };
      this.on(event, onceHandler);
    }
  }

  // Create wallet provider with proper typing
  function createWalletObject(chain: ChainType): WalletProvider {
    console.log(TAG, 'Creating wallet object for chain:', chain);

    const eventEmitter = new EventEmitter();

    const wallet: WalletProvider = {
      network: 'mainnet',
      isKeepKey: true,
      isMetaMask: true,
      isConnected: () => isContentScriptReady,

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

      send: (payload: any, param1?: any, callback?: any): any => {
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
          return undefined;
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
        eventEmitter.on(event, handler);
        return wallet; // Return this for chaining
      },

      off: (event: string, handler: Function) => {
        eventEmitter.off(event, handler);
        return wallet; // Return this for chaining
      },

      removeListener: (event: string, handler: Function) => {
        eventEmitter.removeListener(event, handler);
        return wallet; // Return this for chaining
      },

      removeAllListeners: (event?: string) => {
        eventEmitter.removeAllListeners(event);
        return wallet; // Return this for chaining
      },

      emit: (event: string, ...args: any[]) => {
        eventEmitter.emit(event, ...args);
        return wallet; // Return this for chaining
      },

      once: (event: string, handler: Function) => {
        eventEmitter.once(event, handler);
        return wallet; // Return this for chaining
      },

      // Additional methods for compatibility
      enable: () => {
        // Legacy method for backward compatibility
        return wallet.request({ method: 'eth_requestAccounts' });
      },

      _metamask: {
        isUnlocked: () => Promise.resolve(true),
      },
    };

    // Add chain-specific properties
    if (chain === 'ethereum') {
      wallet.chainId = '0x1';
      wallet.networkVersion = '1';
      wallet.selectedAddress = null; // Will be populated after connection

      // Auto-connect handler
      wallet._handleAccountsChanged = (accounts: string[]) => {
        wallet.selectedAddress = accounts[0] || null;
        eventEmitter.emit('accountsChanged', accounts);
      };

      wallet._handleChainChanged = (chainId: string) => {
        wallet.chainId = chainId;
        eventEmitter.emit('chainChanged', chainId);
      };

      wallet._handleConnect = (info: { chainId: string }) => {
        eventEmitter.emit('connect', info);
      };

      wallet._handleDisconnect = (error: { code: number; message: string }) => {
        wallet.selectedAddress = null;
        eventEmitter.emit('disconnect', error);
      };
    }

    return wallet;
  }

  // EIP-6963 Provider Announcement
  function announceProvider(ethereumProvider: WalletProvider) {
    const info: ProviderInfo = {
      uuid: '350670db-19fa-4704-a166-e52e178b59d4',
      name: 'KeepKey',
      icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==',
      rdns: 'com.keepkey.client',
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

    // Create wallet objects immediately - don't wait for verification
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

    // CRITICAL: Set up EIP-6963 listener BEFORE announcing
    // This ensures we catch any immediate requests
    window.addEventListener('eip6963:requestProvider', () => {
      console.log(tag, 'Re-announcing provider on request');
      announceProvider(ethereum);
    });

    // Announce EIP-6963 provider immediately
    announceProvider(ethereum);

    // Also announce with a slight delay to catch late-loading dApps
    setTimeout(() => {
      console.log(tag, 'Delayed EIP-6963 announcement for late-loading dApps');
      announceProvider(ethereum);
    }, 100);

    // Handle chain changes and other events
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'CHAIN_CHANGED') {
        console.log(tag, 'Chain changed:', event.data);
        ethereum.emit('chainChanged', event.data.provider?.chainId);
      }
      if (event.data?.type === 'ACCOUNTS_CHANGED') {
        console.log(tag, 'Accounts changed:', event.data);
        if (ethereum._handleAccountsChanged) {
          ethereum._handleAccountsChanged(event.data.accounts || []);
        }
      }
    });

    // Now verify injection for content script communication
    // This is non-blocking for EIP-6963
    verifyInjection().then(verified => {
      if (!verified) {
        console.error(tag, 'Failed to verify injection, wallet features may not work');
        injectionState.lastError = 'Injection not verified';
      } else {
        console.log(tag, 'Injection verified successfully');
      }
    });

    console.log(tag, 'Wallet mount complete');
  }

  // Initialize immediately for EIP-6963 compliance
  // The spec requires announcement as early as possible
  mountWallet();

  // Also re-run when DOM is ready in case dApp loads later
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log(TAG, 'DOM loaded, re-announcing provider for late-loading dApps');
      // Re-announce when DOM is ready
      if (kWindow.ethereum && typeof kWindow.dispatchEvent === 'function') {
        const ethereum = kWindow.ethereum as WalletProvider;
        announceProvider(ethereum);
      }
    });
  }

  console.log(TAG, 'Injection script loaded and initialized');
})();
