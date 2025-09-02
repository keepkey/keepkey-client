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
    function createWalletObject(chain) {
      console.log(TAG, 'Creating wallet object for chain:', chain);
      const wallet = {
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
          window.addEventListener(event, handler);
        },
        removeListener: (event, handler) => {
          window.removeEventListener(event, handler);
        },
        removeAllListeners: () => {
          console.warn(TAG, 'removeAllListeners not fully implemented');
        },
      };
      if (chain === 'ethereum') {
        wallet.chainId = '0x1';
        wallet.networkVersion = '1';
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
        var _a, _b;
        if (((_a = event.data) == null ? void 0 : _a.type) === 'CHAIN_CHANGED' && ethereum.emit) {
          console.log(tag, 'Chain changed:', event.data);
          ethereum.emit('chainChanged', (_b = event.data.provider) == null ? void 0 : _b.chainId);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luamVjdGVkL2luamVjdGVkLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7IFxuICBXYWxsZXRSZXF1ZXN0SW5mbywgXG4gIFdhbGxldE1lc3NhZ2UsIFxuICBQcm92aWRlckluZm8sIFxuICBXYWxsZXRDYWxsYmFjayxcbiAgSW5qZWN0aW9uU3RhdGUsXG4gIENoYWluVHlwZSxcbiAgV2FsbGV0UHJvdmlkZXIsXG4gIEtlZXBLZXlXaW5kb3dcbn0gZnJvbSAnLi90eXBlcyc7XG5cbihmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IFRBRyA9ICcgfCBLZWVwS2V5SW5qZWN0ZWQgfCAnO1xuICBjb25zdCBWRVJTSU9OID0gJzIuMC4wJztcbiAgY29uc3QgTUFYX1JFVFJZX0NPVU5UID0gMztcbiAgY29uc3QgUkVUUllfREVMQVkgPSAxMDA7IC8vIG1zXG4gIGNvbnN0IENBTExCQUNLX1RJTUVPVVQgPSAzMDAwMDsgLy8gMzAgc2Vjb25kc1xuICBjb25zdCBNRVNTQUdFX1FVRVVFX01BWCA9IDEwMDtcblxuICBjb25zdCBrV2luZG93ID0gd2luZG93IGFzIEtlZXBLZXlXaW5kb3c7XG5cbiAgLy8gRW5oYW5jZWQgaW5qZWN0aW9uIHN0YXRlIHRyYWNraW5nXG4gIGNvbnN0IGluamVjdGlvblN0YXRlOiBJbmplY3Rpb25TdGF0ZSA9IHtcbiAgICBpc0luamVjdGVkOiBmYWxzZSxcbiAgICB2ZXJzaW9uOiBWRVJTSU9OLFxuICAgIGluamVjdGVkQXQ6IERhdGUubm93KCksXG4gICAgcmV0cnlDb3VudDogMFxuICB9O1xuXG4gIC8vIENoZWNrIGZvciBleGlzdGluZyBpbmplY3Rpb24gd2l0aCB2ZXJzaW9uIGNvbXBhcmlzb25cbiAgaWYgKGtXaW5kb3cua2VlcGtleUluamVjdGlvblN0YXRlKSB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBrV2luZG93LmtlZXBrZXlJbmplY3Rpb25TdGF0ZTtcbiAgICBjb25zb2xlLndhcm4oVEFHLCBgRXhpc3RpbmcgaW5qZWN0aW9uIGRldGVjdGVkIHYke2V4aXN0aW5nLnZlcnNpb259LCBjdXJyZW50IHYke1ZFUlNJT059YCk7XG4gICAgXG4gICAgLy8gT25seSBza2lwIGlmIHNhbWUgb3IgbmV3ZXIgdmVyc2lvblxuICAgIGlmIChleGlzdGluZy52ZXJzaW9uID49IFZFUlNJT04pIHtcbiAgICAgIGNvbnNvbGUubG9nKFRBRywgJ1NraXBwaW5nIGluamVjdGlvbiwgbmV3ZXIgb3Igc2FtZSB2ZXJzaW9uIGFscmVhZHkgcHJlc2VudCcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhUQUcsICdVcGdyYWRpbmcgaW5qZWN0aW9uIHRvIG5ld2VyIHZlcnNpb24nKTtcbiAgfVxuXG4gIC8vIFNldCBpbmplY3Rpb24gc3RhdGVcbiAga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGUgPSBpbmplY3Rpb25TdGF0ZTtcblxuICBjb25zb2xlLmxvZyhUQUcsIGBJbml0aWFsaXppbmcgS2VlcEtleSBJbmplY3Rpb24gdiR7VkVSU0lPTn1gKTtcblxuICAvLyBFbmhhbmNlZCBzb3VyY2UgaW5mb3JtYXRpb25cbiAgY29uc3QgU09VUkNFX0lORk8gPSB7XG4gICAgc2l0ZVVybDogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgc2NyaXB0U291cmNlOiAnS2VlcEtleSBFeHRlbnNpb24nLFxuICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgaW5qZWN0ZWRUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgb3JpZ2luOiB3aW5kb3cubG9jYXRpb24ub3JpZ2luLFxuICAgIHByb3RvY29sOiB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2xcbiAgfTtcblxuICBsZXQgbWVzc2FnZUlkID0gMDtcbiAgY29uc3QgY2FsbGJhY2tzID0gbmV3IE1hcDxudW1iZXIsIFdhbGxldENhbGxiYWNrPigpO1xuICBjb25zdCBtZXNzYWdlUXVldWU6IFdhbGxldE1lc3NhZ2VbXSA9IFtdO1xuICBsZXQgaXNDb250ZW50U2NyaXB0UmVhZHkgPSBmYWxzZTtcblxuICAvLyBDbGVhbnVwIG9sZCBjYWxsYmFja3MgcGVyaW9kaWNhbGx5XG4gIGNvbnN0IGNsZWFudXBDYWxsYmFja3MgPSAoKSA9PiB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBjYWxsYmFja3MuZm9yRWFjaCgoY2FsbGJhY2ssIGlkKSA9PiB7XG4gICAgICBpZiAobm93IC0gY2FsbGJhY2sudGltZXN0YW1wID4gQ0FMTEJBQ0tfVElNRU9VVCkge1xuICAgICAgICBjb25zb2xlLndhcm4oVEFHLCBgQ2FsbGJhY2sgdGltZW91dCBmb3IgcmVxdWVzdCAke2lkfSAoJHtjYWxsYmFjay5tZXRob2R9KWApO1xuICAgICAgICBjYWxsYmFjay5jYWxsYmFjayhuZXcgRXJyb3IoJ1JlcXVlc3QgdGltZW91dCcpKTtcbiAgICAgICAgY2FsbGJhY2tzLmRlbGV0ZShpZCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgc2V0SW50ZXJ2YWwoY2xlYW51cENhbGxiYWNrcywgNTAwMCk7XG5cbiAgLy8gTWFuYWdlIG1lc3NhZ2UgcXVldWUgc2l6ZVxuICBjb25zdCBhZGRUb1F1ZXVlID0gKG1lc3NhZ2U6IFdhbGxldE1lc3NhZ2UpID0+IHtcbiAgICBpZiAobWVzc2FnZVF1ZXVlLmxlbmd0aCA+PSBNRVNTQUdFX1FVRVVFX01BWCkge1xuICAgICAgY29uc29sZS53YXJuKFRBRywgJ01lc3NhZ2UgcXVldWUgZnVsbCwgcmVtb3Zpbmcgb2xkZXN0IG1lc3NhZ2UnKTtcbiAgICAgIG1lc3NhZ2VRdWV1ZS5zaGlmdCgpO1xuICAgIH1cbiAgICBtZXNzYWdlUXVldWUucHVzaChtZXNzYWdlKTtcbiAgfTtcblxuICAvLyBQcm9jZXNzIHF1ZXVlZCBtZXNzYWdlcyB3aGVuIGNvbnRlbnQgc2NyaXB0IGJlY29tZXMgcmVhZHlcbiAgY29uc3QgcHJvY2Vzc1F1ZXVlID0gKCkgPT4ge1xuICAgIGlmICghaXNDb250ZW50U2NyaXB0UmVhZHkpIHJldHVybjtcbiAgICBcbiAgICB3aGlsZSAobWVzc2FnZVF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICAgIGlmIChtZXNzYWdlKSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gVmVyaWZ5IGluamVjdGlvbiB3aXRoIGNvbnRlbnQgc2NyaXB0XG4gIGNvbnN0IHZlcmlmeUluamVjdGlvbiA9IChyZXRyeUNvdW50ID0gMCk6IFByb21pc2U8Ym9vbGVhbj4gPT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3QgdmVyaWZ5SWQgPSArK21lc3NhZ2VJZDtcbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgaWYgKHJldHJ5Q291bnQgPCBNQVhfUkVUUllfQ09VTlQpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhUQUcsIGBWZXJpZmljYXRpb24gYXR0ZW1wdCAke3JldHJ5Q291bnQgKyAxfSBmYWlsZWQsIHJldHJ5aW5nLi4uYCk7XG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICB2ZXJpZnlJbmplY3Rpb24ocmV0cnlDb3VudCArIDEpLnRoZW4ocmVzb2x2ZSk7XG4gICAgICAgICAgfSwgUkVUUllfREVMQVkgKiBNYXRoLnBvdygyLCByZXRyeUNvdW50KSk7IC8vIEV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFRBRywgJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uIGFmdGVyIG1heCByZXRyaWVzJyk7XG4gICAgICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uJztcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgICAgfSwgMTAwMCk7XG5cbiAgICAgIGNvbnN0IGhhbmRsZVZlcmlmaWNhdGlvbiA9IChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBldmVudC5zb3VyY2UgPT09IHdpbmRvdyAmJlxuICAgICAgICAgIGV2ZW50LmRhdGE/LnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy5yZXF1ZXN0SWQgPT09IHZlcmlmeUlkXG4gICAgICAgICkge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG4gICAgICAgICAgaXNDb250ZW50U2NyaXB0UmVhZHkgPSB0cnVlO1xuICAgICAgICAgIGluamVjdGlvblN0YXRlLmlzSW5qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgIGNvbnNvbGUubG9nKFRBRywgJ0luamVjdGlvbiB2ZXJpZmllZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgICBwcm9jZXNzUXVldWUoKTtcbiAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG5cbiAgICAgIC8vIFNlbmQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcbiAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZSh7XG4gICAgICAgIHNvdXJjZTogJ2tlZXBrZXktaW5qZWN0ZWQnLFxuICAgICAgICB0eXBlOiAnSU5KRUNUSU9OX1ZFUklGWScsXG4gICAgICAgIHJlcXVlc3RJZDogdmVyaWZ5SWQsXG4gICAgICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKVxuICAgICAgfSBhcyBXYWxsZXRNZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBFbmhhbmNlZCB3YWxsZXQgcmVxdWVzdCB3aXRoIHZhbGlkYXRpb25cbiAgZnVuY3Rpb24gd2FsbGV0UmVxdWVzdChcbiAgICBtZXRob2Q6IHN0cmluZywgXG4gICAgcGFyYW1zOiBhbnlbXSA9IFtdLCBcbiAgICBjaGFpbjogQ2hhaW5UeXBlLCBcbiAgICBjYWxsYmFjazogKGVycm9yOiBhbnksIHJlc3VsdD86IGFueSkgPT4gdm9pZFxuICApIHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgd2FsbGV0UmVxdWVzdCB8ICc7XG4gICAgXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRzXG4gICAgaWYgKCFtZXRob2QgfHwgdHlwZW9mIG1ldGhvZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IodGFnLCAnSW52YWxpZCBtZXRob2Q6JywgbWV0aG9kKTtcbiAgICAgIGNhbGxiYWNrKG5ldyBFcnJvcignSW52YWxpZCBtZXRob2QnKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhcmFtcykpIHtcbiAgICAgIGNvbnNvbGUud2Fybih0YWcsICdQYXJhbXMgbm90IGFuIGFycmF5LCB3cmFwcGluZzonLCBwYXJhbXMpO1xuICAgICAgcGFyYW1zID0gW3BhcmFtc107XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9ICsrbWVzc2FnZUlkO1xuICAgICAgY29uc3QgcmVxdWVzdEluZm86IFdhbGxldFJlcXVlc3RJbmZvID0ge1xuICAgICAgICBpZDogcmVxdWVzdElkLFxuICAgICAgICBtZXRob2QsXG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgY2hhaW4sXG4gICAgICAgIHNpdGVVcmw6IFNPVVJDRV9JTkZPLnNpdGVVcmwsXG4gICAgICAgIHNjcmlwdFNvdXJjZTogU09VUkNFX0lORk8uc2NyaXB0U291cmNlLFxuICAgICAgICB2ZXJzaW9uOiBTT1VSQ0VfSU5GTy52ZXJzaW9uLFxuICAgICAgICByZXF1ZXN0VGltZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICByZWZlcnJlcjogZG9jdW1lbnQucmVmZXJyZXIsXG4gICAgICAgIGhyZWY6IHdpbmRvdy5sb2NhdGlvbi5ocmVmLFxuICAgICAgICB1c2VyQWdlbnQ6IG5hdmlnYXRvci51c2VyQWdlbnQsXG4gICAgICAgIHBsYXRmb3JtOiBuYXZpZ2F0b3IucGxhdGZvcm0sXG4gICAgICAgIGxhbmd1YWdlOiBuYXZpZ2F0b3IubGFuZ3VhZ2UsXG4gICAgICB9O1xuXG4gICAgICAvLyBTdG9yZSBjYWxsYmFjayB3aXRoIG1ldGFkYXRhXG4gICAgICBjYWxsYmFja3Muc2V0KHJlcXVlc3RJZCwge1xuICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICBtZXRob2RcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtZXNzYWdlOiBXYWxsZXRNZXNzYWdlID0ge1xuICAgICAgICBzb3VyY2U6ICdrZWVwa2V5LWluamVjdGVkJyxcbiAgICAgICAgdHlwZTogJ1dBTExFVF9SRVFVRVNUJyxcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICByZXF1ZXN0SW5mbyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpXG4gICAgICB9O1xuXG4gICAgICBpZiAoaXNDb250ZW50U2NyaXB0UmVhZHkpIHtcbiAgICAgICAgd2luZG93LnBvc3RNZXNzYWdlKG1lc3NhZ2UsIHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2codGFnLCAnQ29udGVudCBzY3JpcHQgbm90IHJlYWR5LCBxdWV1ZWluZyByZXF1ZXN0Jyk7XG4gICAgICAgIGFkZFRvUXVldWUobWVzc2FnZSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IodGFnLCAnRXJyb3IgaW4gd2FsbGV0UmVxdWVzdDonLCBlcnJvcik7XG4gICAgICBjYWxsYmFjayhlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLy8gTGlzdGVuIGZvciByZXNwb25zZXMgd2l0aCBlbmhhbmNlZCB2YWxpZGF0aW9uXG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgKGV2ZW50OiBNZXNzYWdlRXZlbnQpID0+IHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgbWVzc2FnZSB8ICc7XG4gICAgXG4gICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIG9yaWdpblxuICAgIGlmIChldmVudC5zb3VyY2UgIT09IHdpbmRvdykgcmV0dXJuO1xuICAgIFxuICAgIGNvbnN0IGRhdGEgPSBldmVudC5kYXRhIGFzIFdhbGxldE1lc3NhZ2U7XG4gICAgaWYgKCFkYXRhIHx8IHR5cGVvZiBkYXRhICE9PSAnb2JqZWN0JykgcmV0dXJuO1xuXG4gICAgLy8gSGFuZGxlIGluamVjdGlvbiBjb25maXJtYXRpb25cbiAgICBpZiAoZGF0YS5zb3VyY2UgPT09ICdrZWVwa2V5LWNvbnRlbnQnICYmIGRhdGEudHlwZSA9PT0gJ0lOSkVDVElPTl9DT05GSVJNRUQnKSB7XG4gICAgICBpc0NvbnRlbnRTY3JpcHRSZWFkeSA9IHRydWU7XG4gICAgICBwcm9jZXNzUXVldWUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgd2FsbGV0IHJlc3BvbnNlc1xuICAgIGlmIChkYXRhLnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiYgZGF0YS50eXBlID09PSAnV0FMTEVUX1JFU1BPTlNFJyAmJiBkYXRhLnJlcXVlc3RJZCkge1xuICAgICAgY29uc3QgY2FsbGJhY2sgPSBjYWxsYmFja3MuZ2V0KGRhdGEucmVxdWVzdElkKTtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICBpZiAoZGF0YS5lcnJvcikge1xuICAgICAgICAgIGNhbGxiYWNrLmNhbGxiYWNrKGRhdGEuZXJyb3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhbGxiYWNrLmNhbGxiYWNrKG51bGwsIGRhdGEucmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICBjYWxsYmFja3MuZGVsZXRlKGRhdGEucmVxdWVzdElkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUud2Fybih0YWcsICdObyBjYWxsYmFjayBmb3VuZCBmb3IgcmVxdWVzdElkOicsIGRhdGEucmVxdWVzdElkKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIC8vIENyZWF0ZSB3YWxsZXQgcHJvdmlkZXIgd2l0aCBwcm9wZXIgdHlwaW5nXG4gIGZ1bmN0aW9uIGNyZWF0ZVdhbGxldE9iamVjdChjaGFpbjogQ2hhaW5UeXBlKTogV2FsbGV0UHJvdmlkZXIge1xuICAgIGNvbnNvbGUubG9nKFRBRywgJ0NyZWF0aW5nIHdhbGxldCBvYmplY3QgZm9yIGNoYWluOicsIGNoYWluKTtcbiAgICBcbiAgICBjb25zdCB3YWxsZXQ6IFdhbGxldFByb3ZpZGVyID0ge1xuICAgICAgbmV0d29yazogJ21haW5uZXQnLFxuICAgICAgaXNLZWVwS2V5OiB0cnVlLFxuICAgICAgaXNNZXRhTWFzazogdHJ1ZSxcbiAgICAgIGlzQ29ubmVjdGVkOiBpc0NvbnRlbnRTY3JpcHRSZWFkeSxcbiAgICAgIFxuICAgICAgcmVxdWVzdDogKHsgbWV0aG9kLCBwYXJhbXMgPSBbXSB9KSA9PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgd2FsbGV0UmVxdWVzdChtZXRob2QsIHBhcmFtcywgY2hhaW4sIChlcnJvciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBzZW5kOiAocGF5bG9hZDogYW55LCBwYXJhbTE/OiBhbnksIGNhbGxiYWNrPzogYW55KSA9PiB7XG4gICAgICAgIGlmICghcGF5bG9hZC5jaGFpbikge1xuICAgICAgICAgIHBheWxvYWQuY2hhaW4gPSBjaGFpbjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEFzeW5jIHNlbmRcbiAgICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHsgaWQ6IHBheWxvYWQuaWQsIGpzb25ycGM6ICcyLjAnLCByZXN1bHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU3luYyBzZW5kIChkZXByZWNhdGVkLCBidXQgcmVxdWlyZWQgZm9yIGNvbXBhdGliaWxpdHkpXG4gICAgICAgICAgY29uc29sZS53YXJuKFRBRywgJ1N5bmNocm9ub3VzIHNlbmQgaXMgZGVwcmVjYXRlZCBhbmQgbWF5IG5vdCB3b3JrIHByb3Blcmx5Jyk7XG4gICAgICAgICAgcmV0dXJuIHsgaWQ6IHBheWxvYWQuaWQsIGpzb25ycGM6ICcyLjAnLCByZXN1bHQ6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgc2VuZEFzeW5jOiAocGF5bG9hZDogYW55LCBwYXJhbTE/OiBhbnksIGNhbGxiYWNrPzogYW55KSA9PiB7XG4gICAgICAgIGlmICghcGF5bG9hZC5jaGFpbikge1xuICAgICAgICAgIHBheWxvYWQuY2hhaW4gPSBjaGFpbjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgY2IgPSBjYWxsYmFjayB8fCBwYXJhbTE7XG4gICAgICAgIGlmICh0eXBlb2YgY2IgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFRBRywgJ3NlbmRBc3luYyByZXF1aXJlcyBhIGNhbGxiYWNrIGZ1bmN0aW9uJyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgY2IoZXJyb3IpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYihudWxsLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0IH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBoYW5kbGVyIGFzIEV2ZW50TGlzdGVuZXIpO1xuICAgICAgfSxcblxuICAgICAgcmVtb3ZlTGlzdGVuZXI6IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4ge1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciBhcyBFdmVudExpc3RlbmVyKTtcbiAgICAgIH0sXG5cbiAgICAgIHJlbW92ZUFsbExpc3RlbmVyczogKCkgPT4ge1xuICAgICAgICAvLyBUaGlzIHdvdWxkIHJlcXVpcmUgdHJhY2tpbmcgYWxsIGxpc3RlbmVyc1xuICAgICAgICBjb25zb2xlLndhcm4oVEFHLCAncmVtb3ZlQWxsTGlzdGVuZXJzIG5vdCBmdWxseSBpbXBsZW1lbnRlZCcpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBBZGQgY2hhaW4tc3BlY2lmaWMgcHJvcGVydGllc1xuICAgIGlmIChjaGFpbiA9PT0gJ2V0aGVyZXVtJykge1xuICAgICAgd2FsbGV0LmNoYWluSWQgPSAnMHgxJztcbiAgICAgIHdhbGxldC5uZXR3b3JrVmVyc2lvbiA9ICcxJztcbiAgICB9XG5cbiAgICByZXR1cm4gd2FsbGV0O1xuICB9XG5cbiAgLy8gRUlQLTY5NjMgUHJvdmlkZXIgQW5ub3VuY2VtZW50XG4gIGZ1bmN0aW9uIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW1Qcm92aWRlcjogV2FsbGV0UHJvdmlkZXIpIHtcbiAgICBjb25zdCBpbmZvOiBQcm92aWRlckluZm8gPSB7XG4gICAgICB1dWlkOiAnMzUwNjcwZGItMTlmYS00NzA0LWExNjYtZTUyZTE3OGI1OWQ0JyxcbiAgICAgIG5hbWU6ICdLZWVwS2V5IENsaWVudCcsXG4gICAgICBpY29uOiAnaHR0cHM6Ly9waW9uZWVycy5kZXYvY29pbnMva2VlcGtleS5wbmcnLFxuICAgICAgcmRuczogJ2NvbS5rZWVwa2V5JyxcbiAgICB9O1xuXG4gICAgY29uc3QgYW5ub3VuY2VFdmVudCA9IG5ldyBDdXN0b21FdmVudCgnZWlwNjk2Mzphbm5vdW5jZVByb3ZpZGVyJywge1xuICAgICAgZGV0YWlsOiBPYmplY3QuZnJlZXplKHsgaW5mbywgcHJvdmlkZXI6IGV0aGVyZXVtUHJvdmlkZXIgfSksXG4gICAgfSk7XG5cbiAgICBjb25zb2xlLmxvZyhUQUcsICdBbm5vdW5jaW5nIEVJUC02OTYzIHByb3ZpZGVyJyk7XG4gICAgd2luZG93LmRpc3BhdGNoRXZlbnQoYW5ub3VuY2VFdmVudCk7XG4gIH1cblxuICAvLyBNb3VudCB3YWxsZXQgd2l0aCBwcm9wZXIgc3RhdGUgbWFuYWdlbWVudFxuICBhc3luYyBmdW5jdGlvbiBtb3VudFdhbGxldCgpIHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgbW91bnRXYWxsZXQgfCAnO1xuICAgIGNvbnNvbGUubG9nKHRhZywgJ1N0YXJ0aW5nIHdhbGxldCBtb3VudCBwcm9jZXNzJyk7XG5cbiAgICAvLyBXYWl0IGZvciBpbmplY3Rpb24gdmVyaWZpY2F0aW9uXG4gICAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlJbmplY3Rpb24oKTtcbiAgICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHRhZywgJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uLCB3YWxsZXQgZmVhdHVyZXMgbWF5IG5vdCB3b3JrJyk7XG4gICAgICAvLyBDb250aW51ZSBhbnl3YXkgZm9yIGNvbXBhdGliaWxpdHksIGJ1dCBmbGFnIHRoZSBpc3N1ZVxuICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gJ0luamVjdGlvbiBub3QgdmVyaWZpZWQnO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSB3YWxsZXQgb2JqZWN0c1xuICAgIGNvbnN0IGV0aGVyZXVtID0gY3JlYXRlV2FsbGV0T2JqZWN0KCdldGhlcmV1bScpO1xuICAgIGNvbnN0IHhmaTogUmVjb3JkPHN0cmluZywgV2FsbGV0UHJvdmlkZXI+ID0ge1xuICAgICAgYmluYW5jZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaW5hbmNlJyksXG4gICAgICBiaXRjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW4nKSxcbiAgICAgIGJpdGNvaW5jYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW5jYXNoJyksXG4gICAgICBkb2dlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdkb2dlY29pbicpLFxuICAgICAgZGFzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdkYXNoJyksXG4gICAgICBldGhlcmV1bTogZXRoZXJldW0sXG4gICAgICBrZXBscjogY3JlYXRlV2FsbGV0T2JqZWN0KCdrZXBscicpLFxuICAgICAgbGl0ZWNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbGl0ZWNvaW4nKSxcbiAgICAgIHRob3JjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCd0aG9yY2hhaW4nKSxcbiAgICAgIG1heWFjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdtYXlhY2hhaW4nKSxcbiAgICB9O1xuXG4gICAgY29uc3Qga2VlcGtleTogUmVjb3JkPHN0cmluZywgV2FsbGV0UHJvdmlkZXI+ID0ge1xuICAgICAgYmluYW5jZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaW5hbmNlJyksXG4gICAgICBiaXRjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW4nKSxcbiAgICAgIGJpdGNvaW5jYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW5jYXNoJyksXG4gICAgICBkb2dlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdkb2dlY29pbicpLFxuICAgICAgZGFzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdkYXNoJyksXG4gICAgICBldGhlcmV1bTogZXRoZXJldW0sXG4gICAgICBvc21vc2lzOiBjcmVhdGVXYWxsZXRPYmplY3QoJ29zbW9zaXMnKSxcbiAgICAgIGNvc21vczogY3JlYXRlV2FsbGV0T2JqZWN0KCdjb3Ntb3MnKSxcbiAgICAgIGxpdGVjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2xpdGVjb2luJyksXG4gICAgICB0aG9yY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgndGhvcmNoYWluJyksXG4gICAgICBtYXlhY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbWF5YWNoYWluJyksXG4gICAgICByaXBwbGU6IGNyZWF0ZVdhbGxldE9iamVjdCgncmlwcGxlJyksXG4gICAgfTtcblxuICAgIC8vIE1vdW50IHByb3ZpZGVycyB3aXRoIGNvbmZsaWN0IGRldGVjdGlvblxuICAgIGNvbnN0IG1vdW50UHJvdmlkZXIgPSAobmFtZTogc3RyaW5nLCBwcm92aWRlcjogYW55KSA9PiB7XG4gICAgICBpZiAoKGtXaW5kb3cgYXMgYW55KVtuYW1lXSkge1xuICAgICAgICBjb25zb2xlLndhcm4odGFnLCBgJHtuYW1lfSBhbHJlYWR5IGV4aXN0cywgY2hlY2tpbmcgaWYgb3ZlcnJpZGUgaXMgYWxsb3dlZGApO1xuICAgICAgICAvLyBUT0RPOiBBZGQgdXNlciBwcmVmZXJlbmNlIGNoZWNrIGhlcmVcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdHJ5IHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGtXaW5kb3csIG5hbWUsIHtcbiAgICAgICAgICB2YWx1ZTogcHJvdmlkZXIsXG4gICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgLy8gQWxsb3cgcmVjb25maWd1cmF0aW9uIGZvciB1cGRhdGVzXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zb2xlLmxvZyh0YWcsIGBTdWNjZXNzZnVsbHkgbW91bnRlZCB3aW5kb3cuJHtuYW1lfWApO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKHRhZywgYEZhaWxlZCB0byBtb3VudCB3aW5kb3cuJHtuYW1lfTpgLCBlKTtcbiAgICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gYEZhaWxlZCB0byBtb3VudCAke25hbWV9YDtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gTW91bnQgcHJvdmlkZXJzXG4gICAgbW91bnRQcm92aWRlcignZXRoZXJldW0nLCBldGhlcmV1bSk7XG4gICAgbW91bnRQcm92aWRlcigneGZpJywgeGZpKTtcbiAgICBtb3VudFByb3ZpZGVyKCdrZWVwa2V5Jywga2VlcGtleSk7XG5cbiAgICAvLyBBbm5vdW5jZSBFSVAtNjk2MyBwcm92aWRlclxuICAgIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW0pO1xuXG4gICAgLy8gTGlzdGVuIGZvciByZS1hbm5vdW5jZW1lbnQgcmVxdWVzdHNcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignZWlwNjk2MzpyZXF1ZXN0UHJvdmlkZXInLCAoKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyh0YWcsICdSZS1hbm5vdW5jaW5nIHByb3ZpZGVyIG9uIHJlcXVlc3QnKTtcbiAgICAgIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW0pO1xuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGNoYWluIGNoYW5nZXMgYW5kIG90aGVyIGV2ZW50c1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgKGV2ZW50OiBNZXNzYWdlRXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAnQ0hBSU5fQ0hBTkdFRCcgJiYgZXRoZXJldW0uZW1pdCkge1xuICAgICAgICBjb25zb2xlLmxvZyh0YWcsICdDaGFpbiBjaGFuZ2VkOicsIGV2ZW50LmRhdGEpO1xuICAgICAgICBldGhlcmV1bS5lbWl0KCdjaGFpbkNoYW5nZWQnLCBldmVudC5kYXRhLnByb3ZpZGVyPy5jaGFpbklkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKHRhZywgJ1dhbGxldCBtb3VudCBjb21wbGV0ZScpO1xuICB9XG5cbiAgLy8gSW5pdGlhbGl6ZSBiYXNlZCBvbiBkb2N1bWVudCBzdGF0ZVxuICBpZiAoZG9jdW1lbnQucmVhZHlTdGF0ZSA9PT0gJ2xvYWRpbmcnKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignRE9NQ29udGVudExvYWRlZCcsIG1vdW50V2FsbGV0KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBEb2N1bWVudCBhbHJlYWR5IGxvYWRlZCwgbW91bnQgaW1tZWRpYXRlbHlcbiAgICBtb3VudFdhbGxldCgpO1xuICB9XG5cbiAgY29uc29sZS5sb2coVEFHLCAnSW5qZWN0aW9uIHNjcmlwdCBsb2FkZWQgYW5kIGluaXRpYWxpemVk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
