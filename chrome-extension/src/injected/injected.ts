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
import { KeepKeySolanaWallet } from './solana-wallet-standard';
import { registerSolanaWallet } from './solana-wallet-register';
import { KeepKeySolanaProvider } from './solana-provider';
import { KeepKeyTronProvider } from './tron-provider';
import { createHiveKeychainShim } from './hive-provider';

(function () {
  const VERSION = '2.1.0';
  const MAX_RETRY_COUNT = 3;
  const RETRY_DELAY = 100; // ms
  const CALLBACK_TIMEOUT = 300000; // 5 minutes (hardware wallet needs time)
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

    // Only skip if same or newer version
    if (existing.version >= VERSION) {
      return;
    }
  }

  // Set injection state
  kWindow.keepkeyInjectionState = injectionState;

  // Read masking settings from the <script data-masking="{...}"> tag the
  // content script stamped on before injection. Default to all-off (the
  // honest mode — we identify as KeepKey and rely on EIP-6963 for EVM
  // discovery). Any parse failure falls through to defaults so a bad
  // storage write can never disable signing entirely.
  interface Masking {
    enableMetaMaskMasking: boolean;
    enableXfiMasking: boolean;
    enableKeplrMasking: boolean;
    enablePhantomMasking: boolean;
  }
  const masking: Masking = (() => {
    const fallback: Masking = {
      enableMetaMaskMasking: false,
      enableXfiMasking: false,
      enableKeplrMasking: false,
      enablePhantomMasking: false,
    };
    try {
      // currentScript works during script execution; the getElementById
      // path is a fallback in case we're running from a re-injection or
      // the script tag was swapped before we got to it.
      const cs = (document as any).currentScript as HTMLScriptElement | null;
      const byId = document.getElementById('keepkey-injected-script') as HTMLScriptElement | null;
      const el = cs?.dataset?.masking ? cs : byId;
      const raw = el?.dataset.masking;
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        enableMetaMaskMasking: parsed.enableMetaMaskMasking === true,
        enableXfiMasking: parsed.enableXfiMasking === true,
        enableKeplrMasking: parsed.enableKeplrMasking === true,
        enablePhantomMasking: parsed.enablePhantomMasking === true,
      };
    } catch {
      return fallback;
    }
  })();

  // Single diagnostic so the page console always shows the masking
  // state KeepKey was injected with — makes "why isn't Stripe seeing
  // us?" debuggable without toggling verbose logs elsewhere.
  console.log(
    `[KeepKey] masking: metamask=${masking.enableMetaMaskMasking ? 'on' : 'off'} ` +
      `xfi=${masking.enableXfiMasking ? 'on' : 'off'} ` +
      `keplr=${masking.enableKeplrMasking ? 'on' : 'off'} ` +
      `phantom=${masking.enablePhantomMasking ? 'on' : 'off'}`,
  );

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
        callback.callback(new Error('Request timeout'));
        callbacks.delete(id);
      }
    });
  };

  setInterval(cleanupCallbacks, 5000);

  // Manage message queue size
  const addToQueue = (message: WalletMessage) => {
    if (messageQueue.length >= MESSAGE_QUEUE_MAX) {
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
          setTimeout(
            () => {
              verifyInjection(retryCount + 1).then(resolve);
            },
            RETRY_DELAY * Math.pow(2, retryCount),
          ); // Exponential backoff
        } else {
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
    // Validate inputs
    if (!method || typeof method !== 'string') {
      callback(new Error('Invalid method'));
      return;
    }

    if (!Array.isArray(params)) {
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
        addToQueue(message);
      }
    } catch (error) {
      callback(error);
    }
  }

  // Listen for responses with enhanced validation
  window.addEventListener('message', (event: MessageEvent) => {
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
        } catch (_error) {
          // swallow handler errors to avoid breaking other listeners
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
    const eventEmitter = new EventEmitter();

    const wallet: WalletProvider = {
      network: 'mainnet',
      isKeepKey: true,
      // Only claim to be MetaMask when the user explicitly opts in via
      // Settings → Masking. Stripe and other legacy dApps gate on this
      // flag; claiming it by default would misrepresent the wallet and
      // shadow EIP-6963 discovery on dApps that prefer MetaMask.
      isMetaMask: masking.enableMetaMaskMasking,
      isConnected: () => isContentScriptReady,

      request: ({ method, params = [] }) => {
        return new Promise((resolve, reject) => {
          walletRequest(method, params, chain, (error, result) => {
            if (error) {
              console.log(
                `[HANDOFF] dApp ← KeepKey (${chain}/${method}) REJECT\n  params=${JSON.stringify(params)}\n  error=`,
                error,
              );
              reject(error);
            } else {
              const resultType = typeof result;
              const resultPreview =
                resultType === 'string'
                  ? `len=${(result as string).length} value=${result}`
                  : `value=${JSON.stringify(result)}`;
              console.log(
                `[HANDOFF] dApp ← KeepKey (${chain}/${method}) RESOLVE\n  params=${JSON.stringify(params)}\n  type=${resultType} ${resultPreview}`,
              );
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
          return { id: payload.id, jsonrpc: '2.0', result: null };
        }
      },

      sendAsync: (payload: any, param1?: any, callback?: any) => {
        if (!payload.chain) {
          payload.chain = chain;
        }

        const cb = callback || param1;
        if (typeof cb !== 'function') {
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

  const KEEPKEY_ICON =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ22W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==';

  // Simple MetaMask-fox-flavored icon (orange square). The real fox
  // PNG would be ~15KB base64 and not worth the bundle bloat — dApps
  // doing EIP-6963 detection match on rdns, not pixel-compare icons.
  const METAMASK_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#F6851B"/><text x="16" y="21" font-family="Arial,sans-serif" font-weight="bold" font-size="14" fill="#fff" text-anchor="middle">MM</text></svg>',
    );

  // EIP-6963 Provider Announcement. When MetaMask masking is ON we
  // *also* announce with MetaMask's canonical rdns so SDKs that key off
  // `rdns: 'io.metamask'` (MetaMask SDK itself, Dynamic.xyz's
  // MetaMaskConnector, RainbowKit's MetaMask connector, etc.) see us as
  // MetaMask — the `isMetaMask: true` flag alone isn't enough for these,
  // they use EIP-6963 discovery. This is the same trick Rabby uses.
  function announceProvider(ethereumProvider: WalletProvider) {
    const keepkeyInfo: ProviderInfo = {
      uuid: '350670db-19fa-4704-a166-e52e178b59d4',
      name: 'KeepKey',
      icon: KEEPKEY_ICON,
      rdns: 'com.keepkey.client',
    };
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: keepkeyInfo, provider: ethereumProvider }),
      }),
    );

    if (masking.enableMetaMaskMasking) {
      const metaMaskInfo: ProviderInfo = {
        uuid: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        name: 'MetaMask',
        icon: METAMASK_ICON,
        rdns: 'io.metamask',
      };
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({ info: metaMaskInfo, provider: ethereumProvider }),
        }),
      );
    }
  }

  // Mount wallet with proper state management
  async function mountWallet() {
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

    // Mount providers.
    //
    // Modern dApps use EIP-6963 for multi-wallet discovery (announced below),
    // so by default we don't need to own `window.ethereum`. But when a user
    // explicitly turns on a Masking toggle they're saying "be this wallet on
    // this page" — that's a deliberate opt-in, so we force the global and
    // clobber whatever else claimed it (best-effort: a non-configurable
    // global from another wallet can still refuse the redefinition).
    //
    // Policy:
    //   - `window.keepkey`  → always mount (our own namespace, no collision risk)
    //   - `window.ethereum` → when MetaMask masking is ON — forced/clobber
    //   - `window.xfi`      → when XFI masking is ON — forced/clobber
    //   - `window.solana`   → when Phantom masking is ON — forced/clobber
    const mountProvider = (name: string, provider: any, { force = false } = {}) => {
      const existing = (kWindow as any)[name];
      if (existing && !force) {
        return;
      }

      try {
        Object.defineProperty(kWindow, name, {
          value: provider,
          writable: false,
          configurable: true, // Allow reconfiguration for updates
        });
      } catch (_e) {
        injectionState.lastError = `Failed to mount ${name}`;
      }
    };

    // `keepkey` is forced because it's our own namespace. `ethereum` and `xfi`
    // are gated on explicit user opt-in via the Masking toggles; when the
    // toggle is on we force the global so the mask actually takes effect even
    // if another wallet already grabbed it. Without the flag we stay out of
    // those globals entirely.
    if (masking.enableMetaMaskMasking) {
      mountProvider('ethereum', ethereum, { force: true });
    }
    if (masking.enableXfiMasking) {
      mountProvider('xfi', xfi, { force: true });
    }
    mountProvider('keepkey', keepkey, { force: true });

    // CRITICAL: Set up EIP-6963 listener BEFORE announcing
    // This ensures we catch any immediate requests
    window.addEventListener('eip6963:requestProvider', () => {
      announceProvider(ethereum);
    });

    // Announce EIP-6963 provider immediately
    announceProvider(ethereum);

    // Also announce with a slight delay to catch late-loading dApps
    setTimeout(() => {
      announceProvider(ethereum);
    }, 100);

    // Solana Wallet Standard registration (completely separate from Ethereum).
    // This is the modern discovery path and is always active — it relies
    // purely on the wallet-standard registry and never touches window.solana.
    try {
      const solanaWallet = new KeepKeySolanaWallet(walletRequest);
      registerSolanaWallet(solanaWallet);
    } catch (_e) {
      // swallow; Solana registration is best-effort
    }

    // Legacy window.solana shim — the Solana counterpart to MetaMask
    // masking. Gated on the Phantom masking toggle; when on we force the
    // global and clobber whatever claimed it (best-effort — a non-configurable
    // global from a real Phantom/Solflare can refuse the redefinition). Modern
    // dApps keep discovering KeepKey via the Wallet Standard registration above.
    if (masking.enablePhantomMasking) {
      try {
        const solanaProvider = new KeepKeySolanaProvider(walletRequest);
        Object.defineProperty(kWindow, 'solana', {
          value: solanaProvider,
          writable: false,
          configurable: true,
        });
      } catch (_e) {
        // swallow; legacy provider is best-effort
      }
    }

    // TronLink / TronWeb shim — mount only if nothing claims those
    // globals yet. Tron dApps expect `window.tronWeb.defaultAddress.base58`
    // to be populated after `tronLink.request({method:'tron_requestAccounts'})`
    // resolves, so the provider is responsible for its own internal
    // connect state.
    try {
      const tronProvider = new KeepKeyTronProvider(walletRequest);
      if (!(kWindow as any).tronLink) {
        Object.defineProperty(kWindow, 'tronLink', {
          value: tronProvider.tronLink,
          writable: false,
          configurable: true,
        });
      }
      if (!(kWindow as any).tronWeb) {
        Object.defineProperty(kWindow, 'tronWeb', {
          value: tronProvider.tronWeb,
          writable: false,
          configurable: true,
        });
      }
    } catch (_e) {
      // swallow; Tron registration is best-effort
    }

    // Hive Keychain shim — window.hive_keychain is the de-facto discovery
    // API for Hive dApps. Mount only if the real Keychain isn't installed,
    // and keep the property writable: we inject at document_start but the
    // real Keychain injects at document_idle — it must be able to replace
    // our (partial) shim with its full implementation.
    try {
      if (!(kWindow as any).hive_keychain) {
        (kWindow as any).hive_keychain = createHiveKeychainShim(walletRequest);
      }
    } catch (_e) {
      // swallow; Hive registration is best-effort
    }

    // Handle chain changes and other events
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'CHAIN_CHANGED') {
        ethereum.emit('chainChanged', event.data.provider?.chainId);
      }
      if (event.data?.type === 'ACCOUNTS_CHANGED') {
        if (ethereum._handleAccountsChanged) {
          ethereum._handleAccountsChanged(event.data.accounts || []);
        }
      }
    });

    // Now verify injection for content script communication
    // This is non-blocking for EIP-6963
    verifyInjection().then(verified => {
      if (!verified) {
        injectionState.lastError = 'Injection not verified';
      }
    });
  }

  // Initialize immediately for EIP-6963 compliance
  // The spec requires announcement as early as possible
  mountWallet();

  // Also re-run when DOM is ready in case dApp loads later
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Re-announce when DOM is ready
      if (kWindow.ethereum && typeof kWindow.dispatchEvent === 'function') {
        const ethereum = kWindow.ethereum as WalletProvider;
        announceProvider(ethereum);
      }
    });
  }
})();
