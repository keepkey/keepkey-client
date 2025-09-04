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
      icon: 'data:image/png;base64,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',
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
