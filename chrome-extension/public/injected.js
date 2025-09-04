'use strict';
(() => {
  // src/injected/injected.ts
  (function () {
    const TAG = ' | KeepKeyInjected | ';
    const VERSION = '2.0.0';
    const MAX_RETRY_COUNT = 3;
    const RETRY_DELAY = 100;
    const CALLBACK_TIMEOUT = 3e4;
    const MESSAGE_QUEUE_MAX = 100;
    const kWindow = window;
    const injectionState = {
      isInjected: false,
      version: VERSION,
      injectedAt: Date.now(),
      retryCount: 0,
    };
    if (kWindow.keepkeyInjectionState) {
      const existing = kWindow.keepkeyInjectionState;
      console.warn(TAG, `Existing injection detected v${existing.version}, current v${VERSION}`);
      if (existing.version >= VERSION) {
        console.log(TAG, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(TAG, 'Upgrading injection to newer version');
    }
    kWindow.keepkeyInjectionState = injectionState;
    console.log(TAG, `Initializing KeepKey Injection v${VERSION}`);
    const SOURCE_INFO = {
      siteUrl: window.location.href,
      scriptSource: 'KeepKey Extension',
      version: VERSION,
      injectedTime: /* @__PURE__ */ new Date().toISOString(),
      origin: window.location.origin,
      protocol: window.location.protocol,
    };
    let messageId = 0;
    const callbacks = /* @__PURE__ */ new Map();
    const messageQueue = [];
    let isContentScriptReady = false;
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
    setInterval(cleanupCallbacks, 5e3);
    const addToQueue = message => {
      if (messageQueue.length >= MESSAGE_QUEUE_MAX) {
        console.warn(TAG, 'Message queue full, removing oldest message');
        messageQueue.shift();
      }
      messageQueue.push(message);
    };
    const processQueue = () => {
      if (!isContentScriptReady) return;
      while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        if (message) {
          window.postMessage(message, window.location.origin);
        }
      }
    };
    const verifyInjection = (retryCount = 0) => {
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
            );
          } else {
            console.error(TAG, 'Failed to verify injection after max retries');
            injectionState.lastError = 'Failed to verify injection';
            resolve(false);
          }
        }, 1e3);
        const handleVerification = event => {
          var _a, _b, _c;
          if (
            event.source === window &&
            ((_a = event.data) == null ? void 0 : _a.source) === 'keepkey-content' &&
            ((_b = event.data) == null ? void 0 : _b.type) === 'INJECTION_CONFIRMED' &&
            ((_c = event.data) == null ? void 0 : _c.requestId) === verifyId
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
        window.postMessage(
          {
            source: 'keepkey-injected',
            type: 'INJECTION_VERIFY',
            requestId: verifyId,
            version: VERSION,
            timestamp: Date.now(),
          },
          window.location.origin,
        );
      });
    };
    function walletRequest(method, params = [], chain, callback) {
      const tag = TAG + ' | walletRequest | ';
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
        const requestInfo = {
          id: requestId,
          method,
          params,
          chain,
          siteUrl: SOURCE_INFO.siteUrl,
          scriptSource: SOURCE_INFO.scriptSource,
          version: SOURCE_INFO.version,
          requestTime: /* @__PURE__ */ new Date().toISOString(),
          referrer: document.referrer,
          href: window.location.href,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
        };
        callbacks.set(requestId, {
          callback,
          timestamp: Date.now(),
          method,
        });
        const message = {
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
    window.addEventListener('message', event => {
      const tag = TAG + ' | message | ';
      if (event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.source === 'keepkey-content' && data.type === 'INJECTION_CONFIRMED') {
        isContentScriptReady = true;
        processQueue();
        return;
      }
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
    class EventEmitter {
      events = /* @__PURE__ */ new Map();
      on(event, handler) {
        if (!this.events.has(event)) {
          this.events.set(event, /* @__PURE__ */ new Set());
        }
        this.events.get(event).add(handler);
      }
      off(event, handler) {
        var _a;
        (_a = this.events.get(event)) == null ? void 0 : _a.delete(handler);
      }
      removeListener(event, handler) {
        this.off(event, handler);
      }
      removeAllListeners(event) {
        if (event) {
          this.events.delete(event);
        } else {
          this.events.clear();
        }
      }
      emit(event, ...args) {
        var _a;
        (_a = this.events.get(event)) == null
          ? void 0
          : _a.forEach(handler => {
              try {
                handler(...args);
              } catch (error) {
                console.error(TAG, `Error in event handler for ${event}:`, error);
              }
            });
      }
      once(event, handler) {
        const onceHandler = (...args) => {
          handler(...args);
          this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
      }
    }
    function createWalletObject(chain) {
      console.log(TAG, 'Creating wallet object for chain:', chain);
      const eventEmitter = new EventEmitter();
      const wallet = {
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
        send: (payload, param1, callback) => {
          if (!payload.chain) {
            payload.chain = chain;
          }
          if (typeof callback === 'function') {
            walletRequest(payload.method, payload.params || param1, chain, (error, result) => {
              if (error) {
                callback(error);
              } else {
                callback(null, { id: payload.id, jsonrpc: '2.0', result });
              }
            });
          } else {
            console.warn(TAG, 'Synchronous send is deprecated and may not work properly');
            return { id: payload.id, jsonrpc: '2.0', result: null };
          }
        },
        sendAsync: (payload, param1, callback) => {
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
        on: (event, handler) => {
          eventEmitter.on(event, handler);
          return wallet;
        },
        off: (event, handler) => {
          eventEmitter.off(event, handler);
          return wallet;
        },
        removeListener: (event, handler) => {
          eventEmitter.removeListener(event, handler);
          return wallet;
        },
        removeAllListeners: event => {
          eventEmitter.removeAllListeners(event);
          return wallet;
        },
        emit: (event, ...args) => {
          eventEmitter.emit(event, ...args);
          return wallet;
        },
        once: (event, handler) => {
          eventEmitter.once(event, handler);
          return wallet;
        },
        // Additional methods for compatibility
        enable: () => {
          return wallet.request({ method: 'eth_requestAccounts' });
        },
        _metamask: {
          isUnlocked: () => Promise.resolve(true),
        },
      };
      if (chain === 'ethereum') {
        wallet.chainId = '0x1';
        wallet.networkVersion = '1';
        wallet.selectedAddress = null;
        wallet._handleAccountsChanged = accounts => {
          wallet.selectedAddress = accounts[0] || null;
          eventEmitter.emit('accountsChanged', accounts);
        };
        wallet._handleChainChanged = chainId => {
          wallet.chainId = chainId;
          eventEmitter.emit('chainChanged', chainId);
        };
        wallet._handleConnect = info => {
          eventEmitter.emit('connect', info);
        };
        wallet._handleDisconnect = error => {
          wallet.selectedAddress = null;
          eventEmitter.emit('disconnect', error);
        };
      }
      return wallet;
    }
    function announceProvider(ethereumProvider) {
      const info = {
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
    async function mountWallet() {
      const tag = TAG + ' | mountWallet | ';
      console.log(tag, 'Starting wallet mount process');
      const verified = await verifyInjection();
      if (!verified) {
        console.error(tag, 'Failed to verify injection, wallet features may not work');
        injectionState.lastError = 'Injection not verified';
      }
      const ethereum = createWalletObject('ethereum');
      const xfi = {
        binance: createWalletObject('binance'),
        bitcoin: createWalletObject('bitcoin'),
        bitcoincash: createWalletObject('bitcoincash'),
        dogecoin: createWalletObject('dogecoin'),
        dash: createWalletObject('dash'),
        ethereum,
        keplr: createWalletObject('keplr'),
        litecoin: createWalletObject('litecoin'),
        thorchain: createWalletObject('thorchain'),
        mayachain: createWalletObject('mayachain'),
      };
      const keepkey = {
        binance: createWalletObject('binance'),
        bitcoin: createWalletObject('bitcoin'),
        bitcoincash: createWalletObject('bitcoincash'),
        dogecoin: createWalletObject('dogecoin'),
        dash: createWalletObject('dash'),
        ethereum,
        osmosis: createWalletObject('osmosis'),
        cosmos: createWalletObject('cosmos'),
        litecoin: createWalletObject('litecoin'),
        thorchain: createWalletObject('thorchain'),
        mayachain: createWalletObject('mayachain'),
        ripple: createWalletObject('ripple'),
      };
      const mountProvider = (name, provider) => {
        if (kWindow[name]) {
          console.warn(tag, `${name} already exists, checking if override is allowed`);
        }
        try {
          Object.defineProperty(kWindow, name, {
            value: provider,
            writable: false,
            configurable: true,
            // Allow reconfiguration for updates
          });
          console.log(tag, `Successfully mounted window.${name}`);
        } catch (e) {
          console.error(tag, `Failed to mount window.${name}:`, e);
          injectionState.lastError = `Failed to mount ${name}`;
        }
      };
      mountProvider('ethereum', ethereum);
      mountProvider('xfi', xfi);
      mountProvider('keepkey', keepkey);
      announceProvider(ethereum);
      window.addEventListener('eip6963:requestProvider', () => {
        console.log(tag, 'Re-announcing provider on request');
        announceProvider(ethereum);
      });
      window.addEventListener('message', event => {
        var _a, _b, _c;
        if (((_a = event.data) == null ? void 0 : _a.type) === 'CHAIN_CHANGED') {
          console.log(tag, 'Chain changed:', event.data);
          ethereum.emit('chainChanged', (_b = event.data.provider) == null ? void 0 : _b.chainId);
        }
        if (((_c = event.data) == null ? void 0 : _c.type) === 'ACCOUNTS_CHANGED') {
          console.log(tag, 'Accounts changed:', event.data);
          if (ethereum._handleAccountsChanged) {
            ethereum._handleAccountsChanged(event.data.accounts || []);
          }
        }
      });
      console.log(tag, 'Wallet mount complete');
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountWallet);
    } else {
      mountWallet();
    }
    console.log(TAG, 'Injection script loaded and initialized');
  })();
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luamVjdGVkL2luamVjdGVkLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7XG4gIFdhbGxldFJlcXVlc3RJbmZvLFxuICBXYWxsZXRNZXNzYWdlLFxuICBQcm92aWRlckluZm8sXG4gIFdhbGxldENhbGxiYWNrLFxuICBJbmplY3Rpb25TdGF0ZSxcbiAgQ2hhaW5UeXBlLFxuICBXYWxsZXRQcm92aWRlcixcbiAgS2VlcEtleVdpbmRvdyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbihmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IFRBRyA9ICcgfCBLZWVwS2V5SW5qZWN0ZWQgfCAnO1xuICBjb25zdCBWRVJTSU9OID0gJzIuMC4wJztcbiAgY29uc3QgTUFYX1JFVFJZX0NPVU5UID0gMztcbiAgY29uc3QgUkVUUllfREVMQVkgPSAxMDA7IC8vIG1zXG4gIGNvbnN0IENBTExCQUNLX1RJTUVPVVQgPSAzMDAwMDsgLy8gMzAgc2Vjb25kc1xuICBjb25zdCBNRVNTQUdFX1FVRVVFX01BWCA9IDEwMDtcblxuICBjb25zdCBrV2luZG93ID0gd2luZG93IGFzIEtlZXBLZXlXaW5kb3c7XG5cbiAgLy8gRW5oYW5jZWQgaW5qZWN0aW9uIHN0YXRlIHRyYWNraW5nXG4gIGNvbnN0IGluamVjdGlvblN0YXRlOiBJbmplY3Rpb25TdGF0ZSA9IHtcbiAgICBpc0luamVjdGVkOiBmYWxzZSxcbiAgICB2ZXJzaW9uOiBWRVJTSU9OLFxuICAgIGluamVjdGVkQXQ6IERhdGUubm93KCksXG4gICAgcmV0cnlDb3VudDogMCxcbiAgfTtcblxuICAvLyBDaGVjayBmb3IgZXhpc3RpbmcgaW5qZWN0aW9uIHdpdGggdmVyc2lvbiBjb21wYXJpc29uXG4gIGlmIChrV2luZG93LmtlZXBrZXlJbmplY3Rpb25TdGF0ZSkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0ga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGU7XG4gICAgY29uc29sZS53YXJuKFRBRywgYEV4aXN0aW5nIGluamVjdGlvbiBkZXRlY3RlZCB2JHtleGlzdGluZy52ZXJzaW9ufSwgY3VycmVudCB2JHtWRVJTSU9OfWApO1xuXG4gICAgLy8gT25seSBza2lwIGlmIHNhbWUgb3IgbmV3ZXIgdmVyc2lvblxuICAgIGlmIChleGlzdGluZy52ZXJzaW9uID49IFZFUlNJT04pIHtcbiAgICAgIGNvbnNvbGUubG9nKFRBRywgJ1NraXBwaW5nIGluamVjdGlvbiwgbmV3ZXIgb3Igc2FtZSB2ZXJzaW9uIGFscmVhZHkgcHJlc2VudCcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhUQUcsICdVcGdyYWRpbmcgaW5qZWN0aW9uIHRvIG5ld2VyIHZlcnNpb24nKTtcbiAgfVxuXG4gIC8vIFNldCBpbmplY3Rpb24gc3RhdGVcbiAga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGUgPSBpbmplY3Rpb25TdGF0ZTtcblxuICBjb25zb2xlLmxvZyhUQUcsIGBJbml0aWFsaXppbmcgS2VlcEtleSBJbmplY3Rpb24gdiR7VkVSU0lPTn1gKTtcblxuICAvLyBFbmhhbmNlZCBzb3VyY2UgaW5mb3JtYXRpb25cbiAgY29uc3QgU09VUkNFX0lORk8gPSB7XG4gICAgc2l0ZVVybDogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgc2NyaXB0U291cmNlOiAnS2VlcEtleSBFeHRlbnNpb24nLFxuICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgaW5qZWN0ZWRUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgb3JpZ2luOiB3aW5kb3cubG9jYXRpb24ub3JpZ2luLFxuICAgIHByb3RvY29sOiB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2wsXG4gIH07XG5cbiAgbGV0IG1lc3NhZ2VJZCA9IDA7XG4gIGNvbnN0IGNhbGxiYWNrcyA9IG5ldyBNYXA8bnVtYmVyLCBXYWxsZXRDYWxsYmFjaz4oKTtcbiAgY29uc3QgbWVzc2FnZVF1ZXVlOiBXYWxsZXRNZXNzYWdlW10gPSBbXTtcbiAgbGV0IGlzQ29udGVudFNjcmlwdFJlYWR5ID0gZmFsc2U7XG5cbiAgLy8gQ2xlYW51cCBvbGQgY2FsbGJhY2tzIHBlcmlvZGljYWxseVxuICBjb25zdCBjbGVhbnVwQ2FsbGJhY2tzID0gKCkgPT4ge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgY2FsbGJhY2tzLmZvckVhY2goKGNhbGxiYWNrLCBpZCkgPT4ge1xuICAgICAgaWYgKG5vdyAtIGNhbGxiYWNrLnRpbWVzdGFtcCA+IENBTExCQUNLX1RJTUVPVVQpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFRBRywgYENhbGxiYWNrIHRpbWVvdXQgZm9yIHJlcXVlc3QgJHtpZH0gKCR7Y2FsbGJhY2subWV0aG9kfSlgKTtcbiAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobmV3IEVycm9yKCdSZXF1ZXN0IHRpbWVvdXQnKSk7XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoaWQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIHNldEludGVydmFsKGNsZWFudXBDYWxsYmFja3MsIDUwMDApO1xuXG4gIC8vIE1hbmFnZSBtZXNzYWdlIHF1ZXVlIHNpemVcbiAgY29uc3QgYWRkVG9RdWV1ZSA9IChtZXNzYWdlOiBXYWxsZXRNZXNzYWdlKSA9PiB7XG4gICAgaWYgKG1lc3NhZ2VRdWV1ZS5sZW5ndGggPj0gTUVTU0FHRV9RVUVVRV9NQVgpIHtcbiAgICAgIGNvbnNvbGUud2FybihUQUcsICdNZXNzYWdlIHF1ZXVlIGZ1bGwsIHJlbW92aW5nIG9sZGVzdCBtZXNzYWdlJyk7XG4gICAgICBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICB9XG4gICAgbWVzc2FnZVF1ZXVlLnB1c2gobWVzc2FnZSk7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBxdWV1ZWQgbWVzc2FnZXMgd2hlbiBjb250ZW50IHNjcmlwdCBiZWNvbWVzIHJlYWR5XG4gIGNvbnN0IHByb2Nlc3NRdWV1ZSA9ICgpID0+IHtcbiAgICBpZiAoIWlzQ29udGVudFNjcmlwdFJlYWR5KSByZXR1cm47XG5cbiAgICB3aGlsZSAobWVzc2FnZVF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICAgIGlmIChtZXNzYWdlKSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gVmVyaWZ5IGluamVjdGlvbiB3aXRoIGNvbnRlbnQgc2NyaXB0XG4gIGNvbnN0IHZlcmlmeUluamVjdGlvbiA9IChyZXRyeUNvdW50ID0gMCk6IFByb21pc2U8Ym9vbGVhbj4gPT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgIGNvbnN0IHZlcmlmeUlkID0gKyttZXNzYWdlSWQ7XG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGlmIChyZXRyeUNvdW50IDwgTUFYX1JFVFJZX0NPVU5UKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coVEFHLCBgVmVyaWZpY2F0aW9uIGF0dGVtcHQgJHtyZXRyeUNvdW50ICsgMX0gZmFpbGVkLCByZXRyeWluZy4uLmApO1xuICAgICAgICAgIHNldFRpbWVvdXQoXG4gICAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAgIHZlcmlmeUluamVjdGlvbihyZXRyeUNvdW50ICsgMSkudGhlbihyZXNvbHZlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBSRVRSWV9ERUxBWSAqIE1hdGgucG93KDIsIHJldHJ5Q291bnQpLFxuICAgICAgICAgICk7IC8vIEV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFRBRywgJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uIGFmdGVyIG1heCByZXRyaWVzJyk7XG4gICAgICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uJztcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgICAgfSwgMTAwMCk7XG5cbiAgICAgIGNvbnN0IGhhbmRsZVZlcmlmaWNhdGlvbiA9IChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBldmVudC5zb3VyY2UgPT09IHdpbmRvdyAmJlxuICAgICAgICAgIGV2ZW50LmRhdGE/LnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy5yZXF1ZXN0SWQgPT09IHZlcmlmeUlkXG4gICAgICAgICkge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG4gICAgICAgICAgaXNDb250ZW50U2NyaXB0UmVhZHkgPSB0cnVlO1xuICAgICAgICAgIGluamVjdGlvblN0YXRlLmlzSW5qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgIGNvbnNvbGUubG9nKFRBRywgJ0luamVjdGlvbiB2ZXJpZmllZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgICBwcm9jZXNzUXVldWUoKTtcbiAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG5cbiAgICAgIC8vIFNlbmQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcbiAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShcbiAgICAgICAge1xuICAgICAgICAgIHNvdXJjZTogJ2tlZXBrZXktaW5qZWN0ZWQnLFxuICAgICAgICAgIHR5cGU6ICdJTkpFQ1RJT05fVkVSSUZZJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6IHZlcmlmeUlkLFxuICAgICAgICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICB9IGFzIFdhbGxldE1lc3NhZ2UsXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4sXG4gICAgICApO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIEVuaGFuY2VkIHdhbGxldCByZXF1ZXN0IHdpdGggdmFsaWRhdGlvblxuICBmdW5jdGlvbiB3YWxsZXRSZXF1ZXN0KFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIHBhcmFtczogYW55W10gPSBbXSxcbiAgICBjaGFpbjogQ2hhaW5UeXBlLFxuICAgIGNhbGxiYWNrOiAoZXJyb3I6IGFueSwgcmVzdWx0PzogYW55KSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgd2FsbGV0UmVxdWVzdCB8ICc7XG5cbiAgICAvLyBWYWxpZGF0ZSBpbnB1dHNcbiAgICBpZiAoIW1ldGhvZCB8fCB0eXBlb2YgbWV0aG9kICE9PSAnc3RyaW5nJykge1xuICAgICAgY29uc29sZS5lcnJvcih0YWcsICdJbnZhbGlkIG1ldGhvZDonLCBtZXRob2QpO1xuICAgICAgY2FsbGJhY2sobmV3IEVycm9yKCdJbnZhbGlkIG1ldGhvZCcpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGFyYW1zKSkge1xuICAgICAgY29uc29sZS53YXJuKHRhZywgJ1BhcmFtcyBub3QgYW4gYXJyYXksIHdyYXBwaW5nOicsIHBhcmFtcyk7XG4gICAgICBwYXJhbXMgPSBbcGFyYW1zXTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVxdWVzdElkID0gKyttZXNzYWdlSWQ7XG4gICAgICBjb25zdCByZXF1ZXN0SW5mbzogV2FsbGV0UmVxdWVzdEluZm8gPSB7XG4gICAgICAgIGlkOiByZXF1ZXN0SWQsXG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBjaGFpbixcbiAgICAgICAgc2l0ZVVybDogU09VUkNFX0lORk8uc2l0ZVVybCxcbiAgICAgICAgc2NyaXB0U291cmNlOiBTT1VSQ0VfSU5GTy5zY3JpcHRTb3VyY2UsXG4gICAgICAgIHZlcnNpb246IFNPVVJDRV9JTkZPLnZlcnNpb24sXG4gICAgICAgIHJlcXVlc3RUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHJlZmVycmVyOiBkb2N1bWVudC5yZWZlcnJlcixcbiAgICAgICAgaHJlZjogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgICAgIHVzZXJBZ2VudDogbmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgcGxhdGZvcm06IG5hdmlnYXRvci5wbGF0Zm9ybSxcbiAgICAgICAgbGFuZ3VhZ2U6IG5hdmlnYXRvci5sYW5ndWFnZSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFN0b3JlIGNhbGxiYWNrIHdpdGggbWV0YWRhdGFcbiAgICAgIGNhbGxiYWNrcy5zZXQocmVxdWVzdElkLCB7XG4gICAgICAgIGNhbGxiYWNrLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIG1ldGhvZCxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtZXNzYWdlOiBXYWxsZXRNZXNzYWdlID0ge1xuICAgICAgICBzb3VyY2U6ICdrZWVwa2V5LWluamVjdGVkJyxcbiAgICAgICAgdHlwZTogJ1dBTExFVF9SRVFVRVNUJyxcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICByZXF1ZXN0SW5mbyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfTtcblxuICAgICAgaWYgKGlzQ29udGVudFNjcmlwdFJlYWR5KSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHRhZywgJ0NvbnRlbnQgc2NyaXB0IG5vdCByZWFkeSwgcXVldWVpbmcgcmVxdWVzdCcpO1xuICAgICAgICBhZGRUb1F1ZXVlKG1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHRhZywgJ0Vycm9yIGluIHdhbGxldFJlcXVlc3Q6JywgZXJyb3IpO1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIExpc3RlbiBmb3IgcmVzcG9uc2VzIHdpdGggZW5oYW5jZWQgdmFsaWRhdGlvblxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFnID0gVEFHICsgJyB8IG1lc3NhZ2UgfCAnO1xuXG4gICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIG9yaWdpblxuICAgIGlmIChldmVudC5zb3VyY2UgIT09IHdpbmRvdykgcmV0dXJuO1xuXG4gICAgY29uc3QgZGF0YSA9IGV2ZW50LmRhdGEgYXMgV2FsbGV0TWVzc2FnZTtcbiAgICBpZiAoIWRhdGEgfHwgdHlwZW9mIGRhdGEgIT09ICdvYmplY3QnKSByZXR1cm47XG5cbiAgICAvLyBIYW5kbGUgaW5qZWN0aW9uIGNvbmZpcm1hdGlvblxuICAgIGlmIChkYXRhLnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiYgZGF0YS50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcpIHtcbiAgICAgIGlzQ29udGVudFNjcmlwdFJlYWR5ID0gdHJ1ZTtcbiAgICAgIHByb2Nlc3NRdWV1ZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSB3YWxsZXQgcmVzcG9uc2VzXG4gICAgaWYgKGRhdGEuc291cmNlID09PSAna2VlcGtleS1jb250ZW50JyAmJiBkYXRhLnR5cGUgPT09ICdXQUxMRVRfUkVTUE9OU0UnICYmIGRhdGEucmVxdWVzdElkKSB7XG4gICAgICBjb25zdCBjYWxsYmFjayA9IGNhbGxiYWNrcy5nZXQoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChkYXRhLmVycm9yKSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2soZGF0YS5lcnJvcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobnVsbCwgZGF0YS5yZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS53YXJuKHRhZywgJ05vIGNhbGxiYWNrIGZvdW5kIGZvciByZXF1ZXN0SWQ6JywgZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLy8gRXZlbnQgZW1pdHRlciBpbXBsZW1lbnRhdGlvbiBmb3IgRUlQLTExOTMgY29tcGF0aWJpbGl0eVxuICBjbGFzcyBFdmVudEVtaXR0ZXIge1xuICAgIHByaXZhdGUgZXZlbnRzOiBNYXA8c3RyaW5nLCBTZXQ8RnVuY3Rpb24+PiA9IG5ldyBNYXAoKTtcblxuICAgIG9uKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzLmhhcyhldmVudCkpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuc2V0KGV2ZW50LCBuZXcgU2V0KCkpO1xuICAgICAgfVxuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KSEuYWRkKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIG9mZihldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZGVsZXRlKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICB0aGlzLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgfVxuXG4gICAgcmVtb3ZlQWxsTGlzdGVuZXJzKGV2ZW50Pzogc3RyaW5nKSB7XG4gICAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuZGVsZXRlKGV2ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZXZlbnRzLmNsZWFyKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZW1pdChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZm9yRWFjaChoYW5kbGVyID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoVEFHLCBgRXJyb3IgaW4gZXZlbnQgaGFuZGxlciBmb3IgJHtldmVudH06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBvbmNlKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBjb25zdCBvbmNlSGFuZGxlciA9ICguLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB0aGlzLm9mZihldmVudCwgb25jZUhhbmRsZXIpO1xuICAgICAgfTtcbiAgICAgIHRoaXMub24oZXZlbnQsIG9uY2VIYW5kbGVyKTtcbiAgICB9XG4gIH1cblxuICAvLyBDcmVhdGUgd2FsbGV0IHByb3ZpZGVyIHdpdGggcHJvcGVyIHR5cGluZ1xuICBmdW5jdGlvbiBjcmVhdGVXYWxsZXRPYmplY3QoY2hhaW46IENoYWluVHlwZSk6IFdhbGxldFByb3ZpZGVyIHtcbiAgICBjb25zb2xlLmxvZyhUQUcsICdDcmVhdGluZyB3YWxsZXQgb2JqZWN0IGZvciBjaGFpbjonLCBjaGFpbik7XG5cbiAgICBjb25zdCBldmVudEVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbiAgICBjb25zdCB3YWxsZXQ6IFdhbGxldFByb3ZpZGVyID0ge1xuICAgICAgbmV0d29yazogJ21haW5uZXQnLFxuICAgICAgaXNLZWVwS2V5OiB0cnVlLFxuICAgICAgaXNNZXRhTWFzazogdHJ1ZSxcbiAgICAgIGlzQ29ubmVjdGVkOiAoKSA9PiBpc0NvbnRlbnRTY3JpcHRSZWFkeSxcblxuICAgICAgcmVxdWVzdDogKHsgbWV0aG9kLCBwYXJhbXMgPSBbXSB9KSA9PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgd2FsbGV0UmVxdWVzdChtZXRob2QsIHBhcmFtcywgY2hhaW4sIChlcnJvciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBzZW5kOiAocGF5bG9hZDogYW55LCBwYXJhbTE/OiBhbnksIGNhbGxiYWNrPzogYW55KSA9PiB7XG4gICAgICAgIGlmICghcGF5bG9hZC5jaGFpbikge1xuICAgICAgICAgIHBheWxvYWQuY2hhaW4gPSBjaGFpbjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAvLyBBc3luYyBzZW5kXG4gICAgICAgICAgd2FsbGV0UmVxdWVzdChwYXlsb2FkLm1ldGhvZCwgcGF5bG9hZC5wYXJhbXMgfHwgcGFyYW0xLCBjaGFpbiwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFN5bmMgc2VuZCAoZGVwcmVjYXRlZCwgYnV0IHJlcXVpcmVkIGZvciBjb21wYXRpYmlsaXR5KVxuICAgICAgICAgIGNvbnNvbGUud2FybihUQUcsICdTeW5jaHJvbm91cyBzZW5kIGlzIGRlcHJlY2F0ZWQgYW5kIG1heSBub3Qgd29yayBwcm9wZXJseScpO1xuICAgICAgICAgIHJldHVybiB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0OiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIHNlbmRBc3luYzogKHBheWxvYWQ6IGFueSwgcGFyYW0xPzogYW55LCBjYWxsYmFjaz86IGFueSkgPT4ge1xuICAgICAgICBpZiAoIXBheWxvYWQuY2hhaW4pIHtcbiAgICAgICAgICBwYXlsb2FkLmNoYWluID0gY2hhaW47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYiA9IGNhbGxiYWNrIHx8IHBhcmFtMTtcbiAgICAgICAgaWYgKHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoVEFHLCAnc2VuZEFzeW5jIHJlcXVpcmVzIGEgY2FsbGJhY2sgZnVuY3Rpb24nKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgY2IoZXJyb3IpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYihudWxsLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0IH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vbihldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgb2ZmOiAoZXZlbnQ6IHN0cmluZywgaGFuZGxlcjogRnVuY3Rpb24pID0+IHtcbiAgICAgICAgZXZlbnRFbWl0dGVyLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgcmVtb3ZlTGlzdGVuZXI6IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIHJlbW92ZUFsbExpc3RlbmVyczogKGV2ZW50Pzogc3RyaW5nKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5yZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIGVtaXQ6IChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIuZW1pdChldmVudCwgLi4uYXJncyk7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgb25jZTogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vbmNlKGV2ZW50LCBoYW5kbGVyKTtcbiAgICAgICAgcmV0dXJuIHdhbGxldDsgLy8gUmV0dXJuIHRoaXMgZm9yIGNoYWluaW5nXG4gICAgICB9LFxuXG4gICAgICAvLyBBZGRpdGlvbmFsIG1ldGhvZHMgZm9yIGNvbXBhdGliaWxpdHlcbiAgICAgIGVuYWJsZTogKCkgPT4ge1xuICAgICAgICAvLyBMZWdhY3kgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgIHJldHVybiB3YWxsZXQucmVxdWVzdCh7IG1ldGhvZDogJ2V0aF9yZXF1ZXN0QWNjb3VudHMnIH0pO1xuICAgICAgfSxcblxuICAgICAgX21ldGFtYXNrOiB7XG4gICAgICAgIGlzVW5sb2NrZWQ6ICgpID0+IFByb21pc2UucmVzb2x2ZSh0cnVlKSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIC8vIEFkZCBjaGFpbi1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgaWYgKGNoYWluID09PSAnZXRoZXJldW0nKSB7XG4gICAgICB3YWxsZXQuY2hhaW5JZCA9ICcweDEnO1xuICAgICAgd2FsbGV0Lm5ldHdvcmtWZXJzaW9uID0gJzEnO1xuICAgICAgd2FsbGV0LnNlbGVjdGVkQWRkcmVzcyA9IG51bGw7IC8vIFdpbGwgYmUgcG9wdWxhdGVkIGFmdGVyIGNvbm5lY3Rpb25cblxuICAgICAgLy8gQXV0by1jb25uZWN0IGhhbmRsZXJcbiAgICAgIHdhbGxldC5faGFuZGxlQWNjb3VudHNDaGFuZ2VkID0gKGFjY291bnRzOiBzdHJpbmdbXSkgPT4ge1xuICAgICAgICB3YWxsZXQuc2VsZWN0ZWRBZGRyZXNzID0gYWNjb3VudHNbMF0gfHwgbnVsbDtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoJ2FjY291bnRzQ2hhbmdlZCcsIGFjY291bnRzKTtcbiAgICAgIH07XG5cbiAgICAgIHdhbGxldC5faGFuZGxlQ2hhaW5DaGFuZ2VkID0gKGNoYWluSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICB3YWxsZXQuY2hhaW5JZCA9IGNoYWluSWQ7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdjaGFpbkNoYW5nZWQnLCBjaGFpbklkKTtcbiAgICAgIH07XG5cbiAgICAgIHdhbGxldC5faGFuZGxlQ29ubmVjdCA9IChpbmZvOiB7IGNoYWluSWQ6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdjb25uZWN0JywgaW5mbyk7XG4gICAgICB9O1xuXG4gICAgICB3YWxsZXQuX2hhbmRsZURpc2Nvbm5lY3QgPSAoZXJyb3I6IHsgY29kZTogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICB3YWxsZXQuc2VsZWN0ZWRBZGRyZXNzID0gbnVsbDtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoJ2Rpc2Nvbm5lY3QnLCBlcnJvcik7XG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB3YWxsZXQ7XG4gIH1cblxuICAvLyBFSVAtNjk2MyBQcm92aWRlciBBbm5vdW5jZW1lbnRcbiAgZnVuY3Rpb24gYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bVByb3ZpZGVyOiBXYWxsZXRQcm92aWRlcikge1xuICAgIGNvbnN0IGluZm86IFByb3ZpZGVySW5mbyA9IHtcbiAgICAgIHV1aWQ6ICczNTA2NzBkYi0xOWZhLTQ3MDQtYTE2Ni1lNTJlMTc4YjU5ZDQnLFxuICAgICAgbmFtZTogJ0tlZXBLZXkgQ2xpZW50JyxcbiAgICAgIGljb246ICdodHRwczovL3Bpb25lZXJzLmRldi9jb2lucy9rZWVwa2V5LnBuZycsXG4gICAgICByZG5zOiAnY29tLmtlZXBrZXknLFxuICAgIH07XG5cbiAgICBjb25zdCBhbm5vdW5jZUV2ZW50ID0gbmV3IEN1c3RvbUV2ZW50KCdlaXA2OTYzOmFubm91bmNlUHJvdmlkZXInLCB7XG4gICAgICBkZXRhaWw6IE9iamVjdC5mcmVlemUoeyBpbmZvLCBwcm92aWRlcjogZXRoZXJldW1Qcm92aWRlciB9KSxcbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKFRBRywgJ0Fubm91bmNpbmcgRUlQLTY5NjMgcHJvdmlkZXInKTtcbiAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChhbm5vdW5jZUV2ZW50KTtcbiAgfVxuXG4gIC8vIE1vdW50IHdhbGxldCB3aXRoIHByb3BlciBzdGF0ZSBtYW5hZ2VtZW50XG4gIGFzeW5jIGZ1bmN0aW9uIG1vdW50V2FsbGV0KCkge1xuICAgIGNvbnN0IHRhZyA9IFRBRyArICcgfCBtb3VudFdhbGxldCB8ICc7XG4gICAgY29uc29sZS5sb2codGFnLCAnU3RhcnRpbmcgd2FsbGV0IG1vdW50IHByb2Nlc3MnKTtcblxuICAgIC8vIFdhaXQgZm9yIGluamVjdGlvbiB2ZXJpZmljYXRpb25cbiAgICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUluamVjdGlvbigpO1xuICAgIGlmICghdmVyaWZpZWQpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IodGFnLCAnRmFpbGVkIHRvIHZlcmlmeSBpbmplY3Rpb24sIHdhbGxldCBmZWF0dXJlcyBtYXkgbm90IHdvcmsnKTtcbiAgICAgIC8vIENvbnRpbnVlIGFueXdheSBmb3IgY29tcGF0aWJpbGl0eSwgYnV0IGZsYWcgdGhlIGlzc3VlXG4gICAgICBpbmplY3Rpb25TdGF0ZS5sYXN0RXJyb3IgPSAnSW5qZWN0aW9uIG5vdCB2ZXJpZmllZCc7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHdhbGxldCBvYmplY3RzXG4gICAgY29uc3QgZXRoZXJldW0gPSBjcmVhdGVXYWxsZXRPYmplY3QoJ2V0aGVyZXVtJyk7XG4gICAgY29uc3QgeGZpOiBSZWNvcmQ8c3RyaW5nLCBXYWxsZXRQcm92aWRlcj4gPSB7XG4gICAgICBiaW5hbmNlOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpbmFuY2UnKSxcbiAgICAgIGJpdGNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnYml0Y29pbicpLFxuICAgICAgYml0Y29pbmNhc2g6IGNyZWF0ZVdhbGxldE9iamVjdCgnYml0Y29pbmNhc2gnKSxcbiAgICAgIGRvZ2Vjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2RvZ2Vjb2luJyksXG4gICAgICBkYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2Rhc2gnKSxcbiAgICAgIGV0aGVyZXVtOiBldGhlcmV1bSxcbiAgICAgIGtlcGxyOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2tlcGxyJyksXG4gICAgICBsaXRlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdsaXRlY29pbicpLFxuICAgICAgdGhvcmNoYWluOiBjcmVhdGVXYWxsZXRPYmplY3QoJ3Rob3JjaGFpbicpLFxuICAgICAgbWF5YWNoYWluOiBjcmVhdGVXYWxsZXRPYmplY3QoJ21heWFjaGFpbicpLFxuICAgIH07XG5cbiAgICBjb25zdCBrZWVwa2V5OiBSZWNvcmQ8c3RyaW5nLCBXYWxsZXRQcm92aWRlcj4gPSB7XG4gICAgICBiaW5hbmNlOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpbmFuY2UnKSxcbiAgICAgIGJpdGNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnYml0Y29pbicpLFxuICAgICAgYml0Y29pbmNhc2g6IGNyZWF0ZVdhbGxldE9iamVjdCgnYml0Y29pbmNhc2gnKSxcbiAgICAgIGRvZ2Vjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2RvZ2Vjb2luJyksXG4gICAgICBkYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2Rhc2gnKSxcbiAgICAgIGV0aGVyZXVtOiBldGhlcmV1bSxcbiAgICAgIG9zbW9zaXM6IGNyZWF0ZVdhbGxldE9iamVjdCgnb3Ntb3NpcycpLFxuICAgICAgY29zbW9zOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2Nvc21vcycpLFxuICAgICAgbGl0ZWNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbGl0ZWNvaW4nKSxcbiAgICAgIHRob3JjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCd0aG9yY2hhaW4nKSxcbiAgICAgIG1heWFjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdtYXlhY2hhaW4nKSxcbiAgICAgIHJpcHBsZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdyaXBwbGUnKSxcbiAgICB9O1xuXG4gICAgLy8gTW91bnQgcHJvdmlkZXJzIHdpdGggY29uZmxpY3QgZGV0ZWN0aW9uXG4gICAgY29uc3QgbW91bnRQcm92aWRlciA9IChuYW1lOiBzdHJpbmcsIHByb3ZpZGVyOiBhbnkpID0+IHtcbiAgICAgIGlmICgoa1dpbmRvdyBhcyBhbnkpW25hbWVdKSB7XG4gICAgICAgIGNvbnNvbGUud2Fybih0YWcsIGAke25hbWV9IGFscmVhZHkgZXhpc3RzLCBjaGVja2luZyBpZiBvdmVycmlkZSBpcyBhbGxvd2VkYCk7XG4gICAgICAgIC8vIFRPRE86IEFkZCB1c2VyIHByZWZlcmVuY2UgY2hlY2sgaGVyZVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoa1dpbmRvdywgbmFtZSwge1xuICAgICAgICAgIHZhbHVlOiBwcm92aWRlcixcbiAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLCAvLyBBbGxvdyByZWNvbmZpZ3VyYXRpb24gZm9yIHVwZGF0ZXNcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnNvbGUubG9nKHRhZywgYFN1Y2Nlc3NmdWxseSBtb3VudGVkIHdpbmRvdy4ke25hbWV9YCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IodGFnLCBgRmFpbGVkIHRvIG1vdW50IHdpbmRvdy4ke25hbWV9OmAsIGUpO1xuICAgICAgICBpbmplY3Rpb25TdGF0ZS5sYXN0RXJyb3IgPSBgRmFpbGVkIHRvIG1vdW50ICR7bmFtZX1gO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBNb3VudCBwcm92aWRlcnNcbiAgICBtb3VudFByb3ZpZGVyKCdldGhlcmV1bScsIGV0aGVyZXVtKTtcbiAgICBtb3VudFByb3ZpZGVyKCd4ZmknLCB4ZmkpO1xuICAgIG1vdW50UHJvdmlkZXIoJ2tlZXBrZXknLCBrZWVwa2V5KTtcblxuICAgIC8vIEFubm91bmNlIEVJUC02OTYzIHByb3ZpZGVyXG4gICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG5cbiAgICAvLyBMaXN0ZW4gZm9yIHJlLWFubm91bmNlbWVudCByZXF1ZXN0c1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdlaXA2OTYzOnJlcXVlc3RQcm92aWRlcicsICgpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKHRhZywgJ1JlLWFubm91bmNpbmcgcHJvdmlkZXIgb24gcmVxdWVzdCcpO1xuICAgICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG4gICAgfSk7XG5cbiAgICAvLyBIYW5kbGUgY2hhaW4gY2hhbmdlcyBhbmQgb3RoZXIgZXZlbnRzXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQ6IE1lc3NhZ2VFdmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmRhdGE/LnR5cGUgPT09ICdDSEFJTl9DSEFOR0VEJykge1xuICAgICAgICBjb25zb2xlLmxvZyh0YWcsICdDaGFpbiBjaGFuZ2VkOicsIGV2ZW50LmRhdGEpO1xuICAgICAgICBldGhlcmV1bS5lbWl0KCdjaGFpbkNoYW5nZWQnLCBldmVudC5kYXRhLnByb3ZpZGVyPy5jaGFpbklkKTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAnQUNDT1VOVFNfQ0hBTkdFRCcpIHtcbiAgICAgICAgY29uc29sZS5sb2codGFnLCAnQWNjb3VudHMgY2hhbmdlZDonLCBldmVudC5kYXRhKTtcbiAgICAgICAgaWYgKGV0aGVyZXVtLl9oYW5kbGVBY2NvdW50c0NoYW5nZWQpIHtcbiAgICAgICAgICBldGhlcmV1bS5faGFuZGxlQWNjb3VudHNDaGFuZ2VkKGV2ZW50LmRhdGEuYWNjb3VudHMgfHwgW10pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zb2xlLmxvZyh0YWcsICdXYWxsZXQgbW91bnQgY29tcGxldGUnKTtcbiAgfVxuXG4gIC8vIEluaXRpYWxpemUgYmFzZWQgb24gZG9jdW1lbnQgc3RhdGVcbiAgaWYgKGRvY3VtZW50LnJlYWR5U3RhdGUgPT09ICdsb2FkaW5nJykge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNvbnRlbnRMb2FkZWQnLCBtb3VudFdhbGxldCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gRG9jdW1lbnQgYWxyZWFkeSBsb2FkZWQsIG1vdW50IGltbWVkaWF0ZWx5XG4gICAgbW91bnRXYWxsZXQoKTtcbiAgfVxuXG4gIGNvbnNvbGUubG9nKFRBRywgJ0luamVjdGlvbiBzY3JpcHQgbG9hZGVkIGFuZCBpbml0aWFsaXplZCcpO1xufSkoKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVdBLEdBQUMsV0FBWTtBQUNYLFVBQU0sTUFBTTtBQUNaLFVBQU0sVUFBVTtBQUNoQixVQUFNLGtCQUFrQjtBQUN4QixVQUFNLGNBQWM7QUFDcEIsVUFBTSxtQkFBbUI7QUFDekIsVUFBTSxvQkFBb0I7QUFFMUIsVUFBTSxVQUFVO0FBR2hCLFVBQU0saUJBQWlDO0FBQUEsTUFDckMsWUFBWTtBQUFBLE1BQ1osU0FBUztBQUFBLE1BQ1QsWUFBWSxLQUFLLElBQUk7QUFBQSxNQUNyQixZQUFZO0FBQUEsSUFDZDtBQUdBLFFBQUksUUFBUSx1QkFBdUI7QUFDakMsWUFBTSxXQUFXLFFBQVE7QUFDekIsY0FBUSxLQUFLLEtBQUssZ0NBQWdDLFNBQVMsT0FBTyxjQUFjLE9BQU8sRUFBRTtBQUd6RixVQUFJLFNBQVMsV0FBVyxTQUFTO0FBQy9CLGdCQUFRLElBQUksS0FBSywyREFBMkQ7QUFDNUU7QUFBQSxNQUNGO0FBQ0EsY0FBUSxJQUFJLEtBQUssc0NBQXNDO0FBQUEsSUFDekQ7QUFHQSxZQUFRLHdCQUF3QjtBQUVoQyxZQUFRLElBQUksS0FBSyxtQ0FBbUMsT0FB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
