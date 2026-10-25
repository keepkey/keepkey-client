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
import { toProviderError } from './provider-error';
import { installConsoleCapture } from './consoleCapture';
import { installPageObserver } from './pageObserver';

(function () {
  // Capture the page's console/errors from the MAIN world for the bex_console
  // MCP tool. Runs first so it hooks console before the wallet logs anything.
  installConsoleCapture();
  // Network + performance collectors (bex_network / bex_perf). Also first, so the
  // fetch/XHR wrappers and PerformanceObservers see as much as possible.
  installPageObserver();

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
              reject(toProviderError(error, `${method} failed`));
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

  // Brand icon family v1, Browser Extension tile (96px). Sites list wallets at ~20-40px; the old
  // 32px status icon blurred there.
  const KEEPKEY_ICON =
    'data:image/png;base64,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';

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
