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
    async function mountWallet() {
      const tag = TAG + ' | mountWallet | ';
      console.log(tag, 'Starting wallet mount process');
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
      window.addEventListener('eip6963:requestProvider', () => {
        console.log(tag, 'Re-announcing provider on request');
        announceProvider(ethereum);
      });
      announceProvider(ethereum);
      setTimeout(() => {
        console.log(tag, 'Delayed EIP-6963 announcement for late-loading dApps');
        announceProvider(ethereum);
      }, 100);
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
    mountWallet();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        console.log(TAG, 'DOM loaded, re-announcing provider for late-loading dApps');
        if (kWindow.ethereum && typeof kWindow.dispatchEvent === 'function') {
          const ethereum = kWindow.ethereum;
          announceProvider(ethereum);
        }
      });
    }
    console.log(TAG, 'Injection script loaded and initialized');
  })();
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luamVjdGVkL2luamVjdGVkLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7XG4gIFdhbGxldFJlcXVlc3RJbmZvLFxuICBXYWxsZXRNZXNzYWdlLFxuICBQcm92aWRlckluZm8sXG4gIFdhbGxldENhbGxiYWNrLFxuICBJbmplY3Rpb25TdGF0ZSxcbiAgQ2hhaW5UeXBlLFxuICBXYWxsZXRQcm92aWRlcixcbiAgS2VlcEtleVdpbmRvdyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbihmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IFRBRyA9ICcgfCBLZWVwS2V5SW5qZWN0ZWQgfCAnO1xuICBjb25zdCBWRVJTSU9OID0gJzIuMC4wJztcbiAgY29uc3QgTUFYX1JFVFJZX0NPVU5UID0gMztcbiAgY29uc3QgUkVUUllfREVMQVkgPSAxMDA7IC8vIG1zXG4gIGNvbnN0IENBTExCQUNLX1RJTUVPVVQgPSAzMDAwMDsgLy8gMzAgc2Vjb25kc1xuICBjb25zdCBNRVNTQUdFX1FVRVVFX01BWCA9IDEwMDtcblxuICBjb25zdCBrV2luZG93ID0gd2luZG93IGFzIEtlZXBLZXlXaW5kb3c7XG5cbiAgLy8gRW5oYW5jZWQgaW5qZWN0aW9uIHN0YXRlIHRyYWNraW5nXG4gIGNvbnN0IGluamVjdGlvblN0YXRlOiBJbmplY3Rpb25TdGF0ZSA9IHtcbiAgICBpc0luamVjdGVkOiBmYWxzZSxcbiAgICB2ZXJzaW9uOiBWRVJTSU9OLFxuICAgIGluamVjdGVkQXQ6IERhdGUubm93KCksXG4gICAgcmV0cnlDb3VudDogMCxcbiAgfTtcblxuICAvLyBDaGVjayBmb3IgZXhpc3RpbmcgaW5qZWN0aW9uIHdpdGggdmVyc2lvbiBjb21wYXJpc29uXG4gIGlmIChrV2luZG93LmtlZXBrZXlJbmplY3Rpb25TdGF0ZSkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0ga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGU7XG4gICAgY29uc29sZS53YXJuKFRBRywgYEV4aXN0aW5nIGluamVjdGlvbiBkZXRlY3RlZCB2JHtleGlzdGluZy52ZXJzaW9ufSwgY3VycmVudCB2JHtWRVJTSU9OfWApO1xuXG4gICAgLy8gT25seSBza2lwIGlmIHNhbWUgb3IgbmV3ZXIgdmVyc2lvblxuICAgIGlmIChleGlzdGluZy52ZXJzaW9uID49IFZFUlNJT04pIHtcbiAgICAgIGNvbnNvbGUubG9nKFRBRywgJ1NraXBwaW5nIGluamVjdGlvbiwgbmV3ZXIgb3Igc2FtZSB2ZXJzaW9uIGFscmVhZHkgcHJlc2VudCcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhUQUcsICdVcGdyYWRpbmcgaW5qZWN0aW9uIHRvIG5ld2VyIHZlcnNpb24nKTtcbiAgfVxuXG4gIC8vIFNldCBpbmplY3Rpb24gc3RhdGVcbiAga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGUgPSBpbmplY3Rpb25TdGF0ZTtcblxuICBjb25zb2xlLmxvZyhUQUcsIGBJbml0aWFsaXppbmcgS2VlcEtleSBJbmplY3Rpb24gdiR7VkVSU0lPTn1gKTtcblxuICAvLyBFbmhhbmNlZCBzb3VyY2UgaW5mb3JtYXRpb25cbiAgY29uc3QgU09VUkNFX0lORk8gPSB7XG4gICAgc2l0ZVVybDogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgc2NyaXB0U291cmNlOiAnS2VlcEtleSBFeHRlbnNpb24nLFxuICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgaW5qZWN0ZWRUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgb3JpZ2luOiB3aW5kb3cubG9jYXRpb24ub3JpZ2luLFxuICAgIHByb3RvY29sOiB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2wsXG4gIH07XG5cbiAgbGV0IG1lc3NhZ2VJZCA9IDA7XG4gIGNvbnN0IGNhbGxiYWNrcyA9IG5ldyBNYXA8bnVtYmVyLCBXYWxsZXRDYWxsYmFjaz4oKTtcbiAgY29uc3QgbWVzc2FnZVF1ZXVlOiBXYWxsZXRNZXNzYWdlW10gPSBbXTtcbiAgbGV0IGlzQ29udGVudFNjcmlwdFJlYWR5ID0gZmFsc2U7XG5cbiAgLy8gQ2xlYW51cCBvbGQgY2FsbGJhY2tzIHBlcmlvZGljYWxseVxuICBjb25zdCBjbGVhbnVwQ2FsbGJhY2tzID0gKCkgPT4ge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgY2FsbGJhY2tzLmZvckVhY2goKGNhbGxiYWNrLCBpZCkgPT4ge1xuICAgICAgaWYgKG5vdyAtIGNhbGxiYWNrLnRpbWVzdGFtcCA+IENBTExCQUNLX1RJTUVPVVQpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFRBRywgYENhbGxiYWNrIHRpbWVvdXQgZm9yIHJlcXVlc3QgJHtpZH0gKCR7Y2FsbGJhY2subWV0aG9kfSlgKTtcbiAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobmV3IEVycm9yKCdSZXF1ZXN0IHRpbWVvdXQnKSk7XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoaWQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIHNldEludGVydmFsKGNsZWFudXBDYWxsYmFja3MsIDUwMDApO1xuXG4gIC8vIE1hbmFnZSBtZXNzYWdlIHF1ZXVlIHNpemVcbiAgY29uc3QgYWRkVG9RdWV1ZSA9IChtZXNzYWdlOiBXYWxsZXRNZXNzYWdlKSA9PiB7XG4gICAgaWYgKG1lc3NhZ2VRdWV1ZS5sZW5ndGggPj0gTUVTU0FHRV9RVUVVRV9NQVgpIHtcbiAgICAgIGNvbnNvbGUud2FybihUQUcsICdNZXNzYWdlIHF1ZXVlIGZ1bGwsIHJlbW92aW5nIG9sZGVzdCBtZXNzYWdlJyk7XG4gICAgICBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICB9XG4gICAgbWVzc2FnZVF1ZXVlLnB1c2gobWVzc2FnZSk7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBxdWV1ZWQgbWVzc2FnZXMgd2hlbiBjb250ZW50IHNjcmlwdCBiZWNvbWVzIHJlYWR5XG4gIGNvbnN0IHByb2Nlc3NRdWV1ZSA9ICgpID0+IHtcbiAgICBpZiAoIWlzQ29udGVudFNjcmlwdFJlYWR5KSByZXR1cm47XG5cbiAgICB3aGlsZSAobWVzc2FnZVF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICAgIGlmIChtZXNzYWdlKSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gVmVyaWZ5IGluamVjdGlvbiB3aXRoIGNvbnRlbnQgc2NyaXB0XG4gIGNvbnN0IHZlcmlmeUluamVjdGlvbiA9IChyZXRyeUNvdW50ID0gMCk6IFByb21pc2U8Ym9vbGVhbj4gPT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgIGNvbnN0IHZlcmlmeUlkID0gKyttZXNzYWdlSWQ7XG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGlmIChyZXRyeUNvdW50IDwgTUFYX1JFVFJZX0NPVU5UKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coVEFHLCBgVmVyaWZpY2F0aW9uIGF0dGVtcHQgJHtyZXRyeUNvdW50ICsgMX0gZmFpbGVkLCByZXRyeWluZy4uLmApO1xuICAgICAgICAgIHNldFRpbWVvdXQoXG4gICAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAgIHZlcmlmeUluamVjdGlvbihyZXRyeUNvdW50ICsgMSkudGhlbihyZXNvbHZlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBSRVRSWV9ERUxBWSAqIE1hdGgucG93KDIsIHJldHJ5Q291bnQpLFxuICAgICAgICAgICk7IC8vIEV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFRBRywgJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uIGFmdGVyIG1heCByZXRyaWVzJyk7XG4gICAgICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uJztcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgICAgfSwgMTAwMCk7XG5cbiAgICAgIGNvbnN0IGhhbmRsZVZlcmlmaWNhdGlvbiA9IChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBldmVudC5zb3VyY2UgPT09IHdpbmRvdyAmJlxuICAgICAgICAgIGV2ZW50LmRhdGE/LnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy5yZXF1ZXN0SWQgPT09IHZlcmlmeUlkXG4gICAgICAgICkge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG4gICAgICAgICAgaXNDb250ZW50U2NyaXB0UmVhZHkgPSB0cnVlO1xuICAgICAgICAgIGluamVjdGlvblN0YXRlLmlzSW5qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgIGNvbnNvbGUubG9nKFRBRywgJ0luamVjdGlvbiB2ZXJpZmllZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgICBwcm9jZXNzUXVldWUoKTtcbiAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG5cbiAgICAgIC8vIFNlbmQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcbiAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShcbiAgICAgICAge1xuICAgICAgICAgIHNvdXJjZTogJ2tlZXBrZXktaW5qZWN0ZWQnLFxuICAgICAgICAgIHR5cGU6ICdJTkpFQ1RJT05fVkVSSUZZJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6IHZlcmlmeUlkLFxuICAgICAgICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICB9IGFzIFdhbGxldE1lc3NhZ2UsXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4sXG4gICAgICApO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIEVuaGFuY2VkIHdhbGxldCByZXF1ZXN0IHdpdGggdmFsaWRhdGlvblxuICBmdW5jdGlvbiB3YWxsZXRSZXF1ZXN0KFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIHBhcmFtczogYW55W10gPSBbXSxcbiAgICBjaGFpbjogQ2hhaW5UeXBlLFxuICAgIGNhbGxiYWNrOiAoZXJyb3I6IGFueSwgcmVzdWx0PzogYW55KSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgd2FsbGV0UmVxdWVzdCB8ICc7XG5cbiAgICAvLyBWYWxpZGF0ZSBpbnB1dHNcbiAgICBpZiAoIW1ldGhvZCB8fCB0eXBlb2YgbWV0aG9kICE9PSAnc3RyaW5nJykge1xuICAgICAgY29uc29sZS5lcnJvcih0YWcsICdJbnZhbGlkIG1ldGhvZDonLCBtZXRob2QpO1xuICAgICAgY2FsbGJhY2sobmV3IEVycm9yKCdJbnZhbGlkIG1ldGhvZCcpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGFyYW1zKSkge1xuICAgICAgY29uc29sZS53YXJuKHRhZywgJ1BhcmFtcyBub3QgYW4gYXJyYXksIHdyYXBwaW5nOicsIHBhcmFtcyk7XG4gICAgICBwYXJhbXMgPSBbcGFyYW1zXTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVxdWVzdElkID0gKyttZXNzYWdlSWQ7XG4gICAgICBjb25zdCByZXF1ZXN0SW5mbzogV2FsbGV0UmVxdWVzdEluZm8gPSB7XG4gICAgICAgIGlkOiByZXF1ZXN0SWQsXG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBjaGFpbixcbiAgICAgICAgc2l0ZVVybDogU09VUkNFX0lORk8uc2l0ZVVybCxcbiAgICAgICAgc2NyaXB0U291cmNlOiBTT1VSQ0VfSU5GTy5zY3JpcHRTb3VyY2UsXG4gICAgICAgIHZlcnNpb246IFNPVVJDRV9JTkZPLnZlcnNpb24sXG4gICAgICAgIHJlcXVlc3RUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHJlZmVycmVyOiBkb2N1bWVudC5yZWZlcnJlcixcbiAgICAgICAgaHJlZjogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgICAgIHVzZXJBZ2VudDogbmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgcGxhdGZvcm06IG5hdmlnYXRvci5wbGF0Zm9ybSxcbiAgICAgICAgbGFuZ3VhZ2U6IG5hdmlnYXRvci5sYW5ndWFnZSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFN0b3JlIGNhbGxiYWNrIHdpdGggbWV0YWRhdGFcbiAgICAgIGNhbGxiYWNrcy5zZXQocmVxdWVzdElkLCB7XG4gICAgICAgIGNhbGxiYWNrLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIG1ldGhvZCxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtZXNzYWdlOiBXYWxsZXRNZXNzYWdlID0ge1xuICAgICAgICBzb3VyY2U6ICdrZWVwa2V5LWluamVjdGVkJyxcbiAgICAgICAgdHlwZTogJ1dBTExFVF9SRVFVRVNUJyxcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICByZXF1ZXN0SW5mbyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfTtcblxuICAgICAgaWYgKGlzQ29udGVudFNjcmlwdFJlYWR5KSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHRhZywgJ0NvbnRlbnQgc2NyaXB0IG5vdCByZWFkeSwgcXVldWVpbmcgcmVxdWVzdCcpO1xuICAgICAgICBhZGRUb1F1ZXVlKG1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHRhZywgJ0Vycm9yIGluIHdhbGxldFJlcXVlc3Q6JywgZXJyb3IpO1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIExpc3RlbiBmb3IgcmVzcG9uc2VzIHdpdGggZW5oYW5jZWQgdmFsaWRhdGlvblxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFnID0gVEFHICsgJyB8IG1lc3NhZ2UgfCAnO1xuXG4gICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIG9yaWdpblxuICAgIGlmIChldmVudC5zb3VyY2UgIT09IHdpbmRvdykgcmV0dXJuO1xuXG4gICAgY29uc3QgZGF0YSA9IGV2ZW50LmRhdGEgYXMgV2FsbGV0TWVzc2FnZTtcbiAgICBpZiAoIWRhdGEgfHwgdHlwZW9mIGRhdGEgIT09ICdvYmplY3QnKSByZXR1cm47XG5cbiAgICAvLyBIYW5kbGUgaW5qZWN0aW9uIGNvbmZpcm1hdGlvblxuICAgIGlmIChkYXRhLnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiYgZGF0YS50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcpIHtcbiAgICAgIGlzQ29udGVudFNjcmlwdFJlYWR5ID0gdHJ1ZTtcbiAgICAgIHByb2Nlc3NRdWV1ZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSB3YWxsZXQgcmVzcG9uc2VzXG4gICAgaWYgKGRhdGEuc291cmNlID09PSAna2VlcGtleS1jb250ZW50JyAmJiBkYXRhLnR5cGUgPT09ICdXQUxMRVRfUkVTUE9OU0UnICYmIGRhdGEucmVxdWVzdElkKSB7XG4gICAgICBjb25zdCBjYWxsYmFjayA9IGNhbGxiYWNrcy5nZXQoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChkYXRhLmVycm9yKSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2soZGF0YS5lcnJvcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobnVsbCwgZGF0YS5yZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS53YXJuKHRhZywgJ05vIGNhbGxiYWNrIGZvdW5kIGZvciByZXF1ZXN0SWQ6JywgZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLy8gRXZlbnQgZW1pdHRlciBpbXBsZW1lbnRhdGlvbiBmb3IgRUlQLTExOTMgY29tcGF0aWJpbGl0eVxuICBjbGFzcyBFdmVudEVtaXR0ZXIge1xuICAgIHByaXZhdGUgZXZlbnRzOiBNYXA8c3RyaW5nLCBTZXQ8RnVuY3Rpb24+PiA9IG5ldyBNYXAoKTtcblxuICAgIG9uKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzLmhhcyhldmVudCkpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuc2V0KGV2ZW50LCBuZXcgU2V0KCkpO1xuICAgICAgfVxuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KSEuYWRkKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIG9mZihldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZGVsZXRlKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICB0aGlzLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgfVxuXG4gICAgcmVtb3ZlQWxsTGlzdGVuZXJzKGV2ZW50Pzogc3RyaW5nKSB7XG4gICAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuZGVsZXRlKGV2ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZXZlbnRzLmNsZWFyKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZW1pdChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZm9yRWFjaChoYW5kbGVyID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoVEFHLCBgRXJyb3IgaW4gZXZlbnQgaGFuZGxlciBmb3IgJHtldmVudH06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBvbmNlKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBjb25zdCBvbmNlSGFuZGxlciA9ICguLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB0aGlzLm9mZihldmVudCwgb25jZUhhbmRsZXIpO1xuICAgICAgfTtcbiAgICAgIHRoaXMub24oZXZlbnQsIG9uY2VIYW5kbGVyKTtcbiAgICB9XG4gIH1cblxuICAvLyBDcmVhdGUgd2FsbGV0IHByb3ZpZGVyIHdpdGggcHJvcGVyIHR5cGluZ1xuICBmdW5jdGlvbiBjcmVhdGVXYWxsZXRPYmplY3QoY2hhaW46IENoYWluVHlwZSk6IFdhbGxldFByb3ZpZGVyIHtcbiAgICBjb25zb2xlLmxvZyhUQUcsICdDcmVhdGluZyB3YWxsZXQgb2JqZWN0IGZvciBjaGFpbjonLCBjaGFpbik7XG5cbiAgICBjb25zdCBldmVudEVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbiAgICBjb25zdCB3YWxsZXQ6IFdhbGxldFByb3ZpZGVyID0ge1xuICAgICAgbmV0d29yazogJ21haW5uZXQnLFxuICAgICAgaXNLZWVwS2V5OiB0cnVlLFxuICAgICAgaXNNZXRhTWFzazogdHJ1ZSxcbiAgICAgIGlzQ29ubmVjdGVkOiAoKSA9PiBpc0NvbnRlbnRTY3JpcHRSZWFkeSxcblxuICAgICAgcmVxdWVzdDogKHsgbWV0aG9kLCBwYXJhbXMgPSBbXSB9KSA9PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgd2FsbGV0UmVxdWVzdChtZXRob2QsIHBhcmFtcywgY2hhaW4sIChlcnJvciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBzZW5kOiAocGF5bG9hZDogYW55LCBwYXJhbTE/OiBhbnksIGNhbGxiYWNrPzogYW55KSA9PiB7XG4gICAgICAgIGlmICghcGF5bG9hZC5jaGFpbikge1xuICAgICAgICAgIHBheWxvYWQuY2hhaW4gPSBjaGFpbjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAvLyBBc3luYyBzZW5kXG4gICAgICAgICAgd2FsbGV0UmVxdWVzdChwYXlsb2FkLm1ldGhvZCwgcGF5bG9hZC5wYXJhbXMgfHwgcGFyYW0xLCBjaGFpbiwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFN5bmMgc2VuZCAoZGVwcmVjYXRlZCwgYnV0IHJlcXVpcmVkIGZvciBjb21wYXRpYmlsaXR5KVxuICAgICAgICAgIGNvbnNvbGUud2FybihUQUcsICdTeW5jaHJvbm91cyBzZW5kIGlzIGRlcHJlY2F0ZWQgYW5kIG1heSBub3Qgd29yayBwcm9wZXJseScpO1xuICAgICAgICAgIHJldHVybiB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0OiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIHNlbmRBc3luYzogKHBheWxvYWQ6IGFueSwgcGFyYW0xPzogYW55LCBjYWxsYmFjaz86IGFueSkgPT4ge1xuICAgICAgICBpZiAoIXBheWxvYWQuY2hhaW4pIHtcbiAgICAgICAgICBwYXlsb2FkLmNoYWluID0gY2hhaW47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYiA9IGNhbGxiYWNrIHx8IHBhcmFtMTtcbiAgICAgICAgaWYgKHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoVEFHLCAnc2VuZEFzeW5jIHJlcXVpcmVzIGEgY2FsbGJhY2sgZnVuY3Rpb24nKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgY2IoZXJyb3IpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYihudWxsLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0IH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vbihldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgb2ZmOiAoZXZlbnQ6IHN0cmluZywgaGFuZGxlcjogRnVuY3Rpb24pID0+IHtcbiAgICAgICAgZXZlbnRFbWl0dGVyLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgcmVtb3ZlTGlzdGVuZXI6IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIHJlbW92ZUFsbExpc3RlbmVyczogKGV2ZW50Pzogc3RyaW5nKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5yZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIGVtaXQ6IChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIuZW1pdChldmVudCwgLi4uYXJncyk7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgb25jZTogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vbmNlKGV2ZW50LCBoYW5kbGVyKTtcbiAgICAgICAgcmV0dXJuIHdhbGxldDsgLy8gUmV0dXJuIHRoaXMgZm9yIGNoYWluaW5nXG4gICAgICB9LFxuXG4gICAgICAvLyBBZGRpdGlvbmFsIG1ldGhvZHMgZm9yIGNvbXBhdGliaWxpdHlcbiAgICAgIGVuYWJsZTogKCkgPT4ge1xuICAgICAgICAvLyBMZWdhY3kgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgIHJldHVybiB3YWxsZXQucmVxdWVzdCh7IG1ldGhvZDogJ2V0aF9yZXF1ZXN0QWNjb3VudHMnIH0pO1xuICAgICAgfSxcblxuICAgICAgX21ldGFtYXNrOiB7XG4gICAgICAgIGlzVW5sb2NrZWQ6ICgpID0+IFByb21pc2UucmVzb2x2ZSh0cnVlKSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIC8vIEFkZCBjaGFpbi1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgaWYgKGNoYWluID09PSAnZXRoZXJldW0nKSB7XG4gICAgICB3YWxsZXQuY2hhaW5JZCA9ICcweDEnO1xuICAgICAgd2FsbGV0Lm5ldHdvcmtWZXJzaW9uID0gJzEnO1xuICAgICAgd2FsbGV0LnNlbGVjdGVkQWRkcmVzcyA9IG51bGw7IC8vIFdpbGwgYmUgcG9wdWxhdGVkIGFmdGVyIGNvbm5lY3Rpb25cblxuICAgICAgLy8gQXV0by1jb25uZWN0IGhhbmRsZXJcbiAgICAgIHdhbGxldC5faGFuZGxlQWNjb3VudHNDaGFuZ2VkID0gKGFjY291bnRzOiBzdHJpbmdbXSkgPT4ge1xuICAgICAgICB3YWxsZXQuc2VsZWN0ZWRBZGRyZXNzID0gYWNjb3VudHNbMF0gfHwgbnVsbDtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoJ2FjY291bnRzQ2hhbmdlZCcsIGFjY291bnRzKTtcbiAgICAgIH07XG5cbiAgICAgIHdhbGxldC5faGFuZGxlQ2hhaW5DaGFuZ2VkID0gKGNoYWluSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICB3YWxsZXQuY2hhaW5JZCA9IGNoYWluSWQ7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdjaGFpbkNoYW5nZWQnLCBjaGFpbklkKTtcbiAgICAgIH07XG5cbiAgICAgIHdhbGxldC5faGFuZGxlQ29ubmVjdCA9IChpbmZvOiB7IGNoYWluSWQ6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdjb25uZWN0JywgaW5mbyk7XG4gICAgICB9O1xuXG4gICAgICB3YWxsZXQuX2hhbmRsZURpc2Nvbm5lY3QgPSAoZXJyb3I6IHsgY29kZTogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICB3YWxsZXQuc2VsZWN0ZWRBZGRyZXNzID0gbnVsbDtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoJ2Rpc2Nvbm5lY3QnLCBlcnJvcik7XG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB3YWxsZXQ7XG4gIH1cblxuICAvLyBFSVAtNjk2MyBQcm92aWRlciBBbm5vdW5jZW1lbnRcbiAgZnVuY3Rpb24gYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bVByb3ZpZGVyOiBXYWxsZXRQcm92aWRlcikge1xuICAgIGNvbnN0IGluZm86IFByb3ZpZGVySW5mbyA9IHtcbiAgICAgIHV1aWQ6ICczNTA2NzBkYi0xOWZhLTQ3MDQtYTE2Ni1lNTJlMTc4YjU5ZDQnLFxuICAgICAgbmFtZTogJ0tlZXBLZXknLFxuICAgICAgaWNvbjogJ2RhdGE6aW1hZ2UvcG5nO2Jhc2U2NCxpVkJPUncwS0dnb0FBQUFOU1VoRVVnQUFBQ0FBQUFBZ0NBWUFBQUJ6ZW5yMEFBQUFBWE5TUjBJQXJzNGM2UUFBQUVSbFdFbG1UVTBBS2dBQUFBZ0FBWWRwQUFRQUFBQUJBQUFBR2dBQUFBQUFBNkFCQUFNQUFBQUJBQUVBQUtBQ0FBUUFBQUFCQUFBQUlLQURBQVFBQUFBQkFBQUFJQUFBQUFDc2htTHpBQUFEVWtsRVFWUllDYjFYVFVnVVlSaWUzYlhFV2hWTFFhVXNnd1ZMb1V0RVFqVUppWlgwQTBHWDdCSVpYdXJrT1RTdmRvMmt2RVRIQXNPc2hGZ3FPcWhsUkQ5QzdTR1MxSlRDc2oxa3JVN1BNK3c3ek16T3p1ek1xaTg4Kzczdjl6N3Z6M3p6elRleml1SWdtcWJGZ0c1Z0JQZ3VGT2dxNENYTElNd0NvMEFYRUpONHp4SGtFdUE2a0FJTWtVQk1xTVprN3NvL1VHOEFVY25qT0lLd0ZYZ0haSWdFd0tGbU9IT2ZZTzRheVNWam1Bb2M3TzRSMEVCN2xZUzVoOUsxakJKNkE3Q3VBZlhHN09vcGJLTFhraDRkY2NOWjdqbHNpMGdBSmxXTEk1akJQV0ZzVEs1QUd4Q1JJbXN3RnFER1dhbkRCbzZJc1lialVhbkZibXJGV0lIeEQzSXNtZkpzZ0I0eTJhSnVGNFVyVUM1R251TnR4SmVFUXFFb0FiM0xKVitGNGN0bEh3a1pYRFVMdjhmRUtRQ0hCNCtyQ0o5bmdLY0lHVVRWUnViVDAyN3k4eVI5Yk9NNG1oS1RUd05KWkQ0bWlhRFhBRzhkcXpsTVNodzNZUkNaUlZBcjd2VTRnNUYvRDRaQm9KSzJIK0VtOUNzZkVkQm9LbjRLOWpQQWQzRzlzTVBxWkV6cFJQekF3UmZXSnBOOUVmWlNSa0FPRTVMRDd3cnc4ZGtwd1JoNTVWTW0yN2ZxdDRGaVZCakdCVGF4RW00RGI4ZCs0QlB0SU9LM0FkYllDUEMxcWgvaGFHSVM5Z0hnRGVCYmdqVEFJa1hBZlRSeGtnYWFtTU53Q0hnQitCTWs0RGVjcTBoR2tGUWJrYS9XTXlaL0VleUhObzZUdVN3eDNObjhnSFFWSVlPa09oQjVHcDR6Y2RiQkhpRHZaMnBSdXpvenJ1MmV1S3VET3VjZy9LbGlUQWpLS01hOWtzQnB4QkxyYnpSd1ZmaWZPbkI0UlIyZzNRU0gzQ2Z4NUZSZGMyS29Hc3Ryb1VlUUtoNDd2bkF3V3ZVS2pzUGNBL3dXZEJVa2pSQWdaZHN6bk84RDV4TEdDL09weGMzTmlRZVY5dUlzZ2tORGFVb01GcE5ETGxlQW4wY1RRTkJqR2FGVzZmbjJXcmt5L2RJNmFiUE9sOWVOOWRlb1doakxsb0N2MytiUHk3dzMvOWt6ZnZqWDEyMGcxY3VTZHNKNDd4bTFDZ1M5QWF4Q0VybGJWNnFKMDJXMW5xMjJsRzc1QXRJSFdRRWVKcE9ZYUFUNmdCUVFXQzVYTkNqYzdka2tIRktXZTZ2M0ZjTGZielJBTWxjQzZJQzZDK2dHeGdDZWN0Wm5DUk11b3BWRzF2K054MDRzWUlObHhMSDR3STZXNTJVRmhUK1E0MWIyTmwwcWVMbndaUEdRdWNOSHJYTjZaREc5NFJRdU82ODhYYndORnp2amxTdXdIMDN3RVc4SCtCZi9keHJVT1dkYytIOG1LWHRFcEdwWTNBQUFBQUJKUlU1RXJrSmdnZz09JyxcbiAgICAgIHJkbnM6ICdjb20ua2VlcGtleS5jbGllbnQnLFxuICAgIH07XG5cbiAgICBjb25zdCBhbm5vdW5jZUV2ZW50ID0gbmV3IEN1c3RvbUV2ZW50KCdlaXA2OTYzOmFubm91bmNlUHJvdmlkZXInLCB7XG4gICAgICBkZXRhaWw6IE9iamVjdC5mcmVlemUoeyBpbmZvLCBwcm92aWRlcjogZXRoZXJldW1Qcm92aWRlciB9KSxcbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKFRBRywgJ0Fubm91bmNpbmcgRUlQLTY5NjMgcHJvdmlkZXInKTtcbiAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChhbm5vdW5jZUV2ZW50KTtcbiAgfVxuXG4gIC8vIE1vdW50IHdhbGxldCB3aXRoIHByb3BlciBzdGF0ZSBtYW5hZ2VtZW50XG4gIGFzeW5jIGZ1bmN0aW9uIG1vdW50V2FsbGV0KCkge1xuICAgIGNvbnN0IHRhZyA9IFRBRyArICcgfCBtb3VudFdhbGxldCB8ICc7XG4gICAgY29uc29sZS5sb2codGFnLCAnU3RhcnRpbmcgd2FsbGV0IG1vdW50IHByb2Nlc3MnKTtcblxuICAgIC8vIENyZWF0ZSB3YWxsZXQgb2JqZWN0cyBpbW1lZGlhdGVseSAtIGRvbid0IHdhaXQgZm9yIHZlcmlmaWNhdGlvblxuICAgIGNvbnN0IGV0aGVyZXVtID0gY3JlYXRlV2FsbGV0T2JqZWN0KCdldGhlcmV1bScpO1xuICAgIGNvbnN0IHhmaTogUmVjb3JkPHN0cmluZywgV2FsbGV0UHJvdmlkZXI+ID0ge1xuICAgICAgYmluYW5jZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaW5hbmNlJyksXG4gICAgICBiaXRjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW4nKSxcbiAgICAgIGJpdGNvaW5jYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW5jYXNoJyksXG4gICAgICBkb2dlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdkb2dlY29pbicpLFxuICAgICAgZGFzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdkYXNoJyksXG4gICAgICBldGhlcmV1bTogZXRoZXJldW0sXG4gICAgICBrZXBscjogY3JlYXRlV2FsbGV0T2JqZWN0KCdrZXBscicpLFxuICAgICAgbGl0ZWNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbGl0ZWNvaW4nKSxcbiAgICAgIHRob3JjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCd0aG9yY2hhaW4nKSxcbiAgICAgIG1heWFjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdtYXlhY2hhaW4nKSxcbiAgICB9O1xuXG4gICAgY29uc3Qga2VlcGtleTogUmVjb3JkPHN0cmluZywgV2FsbGV0UHJvdmlkZXI+ID0ge1xuICAgICAgYmluYW5jZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaW5hbmNlJyksXG4gICAgICBiaXRjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW4nKSxcbiAgICAgIGJpdGNvaW5jYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW5jYXNoJyksXG4gICAgICBkb2dlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdkb2dlY29pbicpLFxuICAgICAgZGFzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdkYXNoJyksXG4gICAgICBldGhlcmV1bTogZXRoZXJldW0sXG4gICAgICBvc21vc2lzOiBjcmVhdGVXYWxsZXRPYmplY3QoJ29zbW9zaXMnKSxcbiAgICAgIGNvc21vczogY3JlYXRlV2FsbGV0T2JqZWN0KCdjb3Ntb3MnKSxcbiAgICAgIGxpdGVjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2xpdGVjb2luJyksXG4gICAgICB0aG9yY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgndGhvcmNoYWluJyksXG4gICAgICBtYXlhY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbWF5YWNoYWluJyksXG4gICAgICByaXBwbGU6IGNyZWF0ZVdhbGxldE9iamVjdCgncmlwcGxlJyksXG4gICAgfTtcblxuICAgIC8vIE1vdW50IHByb3ZpZGVycyB3aXRoIGNvbmZsaWN0IGRldGVjdGlvblxuICAgIGNvbnN0IG1vdW50UHJvdmlkZXIgPSAobmFtZTogc3RyaW5nLCBwcm92aWRlcjogYW55KSA9PiB7XG4gICAgICBpZiAoKGtXaW5kb3cgYXMgYW55KVtuYW1lXSkge1xuICAgICAgICBjb25zb2xlLndhcm4odGFnLCBgJHtuYW1lfSBhbHJlYWR5IGV4aXN0cywgY2hlY2tpbmcgaWYgb3ZlcnJpZGUgaXMgYWxsb3dlZGApO1xuICAgICAgICAvLyBUT0RPOiBBZGQgdXNlciBwcmVmZXJlbmNlIGNoZWNrIGhlcmVcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGtXaW5kb3csIG5hbWUsIHtcbiAgICAgICAgICB2YWx1ZTogcHJvdmlkZXIsXG4gICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgLy8gQWxsb3cgcmVjb25maWd1cmF0aW9uIGZvciB1cGRhdGVzXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zb2xlLmxvZyh0YWcsIGBTdWNjZXNzZnVsbHkgbW91bnRlZCB3aW5kb3cuJHtuYW1lfWApO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKHRhZywgYEZhaWxlZCB0byBtb3VudCB3aW5kb3cuJHtuYW1lfTpgLCBlKTtcbiAgICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gYEZhaWxlZCB0byBtb3VudCAke25hbWV9YDtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gTW91bnQgcHJvdmlkZXJzXG4gICAgbW91bnRQcm92aWRlcignZXRoZXJldW0nLCBldGhlcmV1bSk7XG4gICAgbW91bnRQcm92aWRlcigneGZpJywgeGZpKTtcbiAgICBtb3VudFByb3ZpZGVyKCdrZWVwa2V5Jywga2VlcGtleSk7XG5cbiAgICAvLyBDUklUSUNBTDogU2V0IHVwIEVJUC02OTYzIGxpc3RlbmVyIEJFRk9SRSBhbm5vdW5jaW5nXG4gICAgLy8gVGhpcyBlbnN1cmVzIHdlIGNhdGNoIGFueSBpbW1lZGlhdGUgcmVxdWVzdHNcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignZWlwNjk2MzpyZXF1ZXN0UHJvdmlkZXInLCAoKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyh0YWcsICdSZS1hbm5vdW5jaW5nIHByb3ZpZGVyIG9uIHJlcXVlc3QnKTtcbiAgICAgIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW0pO1xuICAgIH0pO1xuXG4gICAgLy8gQW5ub3VuY2UgRUlQLTY5NjMgcHJvdmlkZXIgaW1tZWRpYXRlbHlcbiAgICBhbm5vdW5jZVByb3ZpZGVyKGV0aGVyZXVtKTtcblxuICAgIC8vIEFsc28gYW5ub3VuY2Ugd2l0aCBhIHNsaWdodCBkZWxheSB0byBjYXRjaCBsYXRlLWxvYWRpbmcgZEFwcHNcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKHRhZywgJ0RlbGF5ZWQgRUlQLTY5NjMgYW5ub3VuY2VtZW50IGZvciBsYXRlLWxvYWRpbmcgZEFwcHMnKTtcbiAgICAgIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW0pO1xuICAgIH0sIDEwMCk7XG5cbiAgICAvLyBIYW5kbGUgY2hhaW4gY2hhbmdlcyBhbmQgb3RoZXIgZXZlbnRzXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQ6IE1lc3NhZ2VFdmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmRhdGE/LnR5cGUgPT09ICdDSEFJTl9DSEFOR0VEJykge1xuICAgICAgICBjb25zb2xlLmxvZyh0YWcsICdDaGFpbiBjaGFuZ2VkOicsIGV2ZW50LmRhdGEpO1xuICAgICAgICBldGhlcmV1bS5lbWl0KCdjaGFpbkNoYW5nZWQnLCBldmVudC5kYXRhLnByb3ZpZGVyPy5jaGFpbklkKTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAnQUNDT1VOVFNfQ0hBTkdFRCcpIHtcbiAgICAgICAgY29uc29sZS5sb2codGFnLCAnQWNjb3VudHMgY2hhbmdlZDonLCBldmVudC5kYXRhKTtcbiAgICAgICAgaWYgKGV0aGVyZXVtLl9oYW5kbGVBY2NvdW50c0NoYW5nZWQpIHtcbiAgICAgICAgICBldGhlcmV1bS5faGFuZGxlQWNjb3VudHNDaGFuZ2VkKGV2ZW50LmRhdGEuYWNjb3VudHMgfHwgW10pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBOb3cgdmVyaWZ5IGluamVjdGlvbiBmb3IgY29udGVudCBzY3JpcHQgY29tbXVuaWNhdGlvblxuICAgIC8vIFRoaXMgaXMgbm9uLWJsb2NraW5nIGZvciBFSVAtNjk2M1xuICAgIHZlcmlmeUluamVjdGlvbigpLnRoZW4odmVyaWZpZWQgPT4ge1xuICAgICAgaWYgKCF2ZXJpZmllZCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKHRhZywgJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uLCB3YWxsZXQgZmVhdHVyZXMgbWF5IG5vdCB3b3JrJyk7XG4gICAgICAgIGluamVjdGlvblN0YXRlLmxhc3RFcnJvciA9ICdJbmplY3Rpb24gbm90IHZlcmlmaWVkJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHRhZywgJ0luamVjdGlvbiB2ZXJpZmllZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKHRhZywgJ1dhbGxldCBtb3VudCBjb21wbGV0ZScpO1xuICB9XG5cbiAgLy8gSW5pdGlhbGl6ZSBpbW1lZGlhdGVseSBmb3IgRUlQLTY5NjMgY29tcGxpYW5jZVxuICAvLyBUaGUgc3BlYyByZXF1aXJlcyBhbm5vdW5jZW1lbnQgYXMgZWFybHkgYXMgcG9zc2libGVcbiAgbW91bnRXYWxsZXQoKTtcblxuICAvLyBBbHNvIHJlLXJ1biB3aGVuIERPTSBpcyByZWFkeSBpbiBjYXNlIGRBcHAgbG9hZHMgbGF0ZXJcbiAgaWYgKGRvY3VtZW50LnJlYWR5U3RhdGUgPT09ICdsb2FkaW5nJykge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNvbnRlbnRMb2FkZWQnLCAoKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhUQUcsICdET00gbG9hZGVkLCByZS1hbm5vdW5jaW5nIHByb3ZpZGVyIGZvciBsYXRlLWxvYWRpbmcgZEFwcHMnKTtcbiAgICAgIC8vIFJlLWFubm91bmNlIHdoZW4gRE9NIGlzIHJlYWR5XG4gICAgICBpZiAoa1dpbmRvdy5ldGhlcmV1bSAmJiB0eXBlb2Yga1dpbmRvdy5kaXNwYXRjaEV2ZW50ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGV0aGVyZXVtID0ga1dpbmRvdy5ldGhlcmV1bSBhcyBXYWxsZXRQcm92aWRlcjtcbiAgICAgICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBjb25zb2xlLmxvZyhUQUcsICdJbmplY3Rpb24gc2NyaXB0IGxvYWRlZCBhbmQgaW5pdGlhbGl6ZWQnKTtcbn0pKCk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFXQSxHQUFDLFdBQVk7QUFDWCxVQUFNLE1BQU07QUFDWixVQUFNLFVBQVU7QUFDaEIsVUFBTSxrQkFBa0I7QUFDeEIsVUFBTSxjQUFjO0FBQ3BCLFVBQU0sbUJBQW1CO0FBQ3pCLFVBQU0sb0JBQW9CO0FBRTFCLFVBQU0sVUFBVTtBQUdoQixVQUFN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
