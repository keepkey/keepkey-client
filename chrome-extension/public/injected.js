"use strict";
(() => {
  // src/injected/injected.ts
  (function() {
    const TAG = " | KeepKeyInjected | ";
    const VERSION = "2.0.0";
    const MAX_RETRY_COUNT = 3;
    const RETRY_DELAY = 100;
    const CALLBACK_TIMEOUT = 3e4;
    const MESSAGE_QUEUE_MAX = 100;
    const kWindow = window;
    const injectionState = {
      isInjected: false,
      version: VERSION,
      injectedAt: Date.now(),
      retryCount: 0
    };
    if (kWindow.keepkeyInjectionState) {
      const existing = kWindow.keepkeyInjectionState;
      console.warn(TAG, `Existing injection detected v${existing.version}, current v${VERSION}`);
      if (existing.version >= VERSION) {
        console.log(TAG, "Skipping injection, newer or same version already present");
        return;
      }
      console.log(TAG, "Upgrading injection to newer version");
    }
    kWindow.keepkeyInjectionState = injectionState;
    console.log(TAG, `Initializing KeepKey Injection v${VERSION}`);
    const SOURCE_INFO = {
      siteUrl: window.location.href,
      scriptSource: "KeepKey Extension",
      version: VERSION,
      injectedTime: (/* @__PURE__ */ new Date()).toISOString(),
      origin: window.location.origin,
      protocol: window.location.protocol
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
          callback.callback(new Error("Request timeout"));
          callbacks.delete(id);
        }
      });
    };
    setInterval(cleanupCallbacks, 5e3);
    const addToQueue = (message) => {
      if (messageQueue.length >= MESSAGE_QUEUE_MAX) {
        console.warn(TAG, "Message queue full, removing oldest message");
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
      return new Promise((resolve) => {
        const verifyId = ++messageId;
        const timeout = setTimeout(() => {
          if (retryCount < MAX_RETRY_COUNT) {
            console.log(TAG, `Verification attempt ${retryCount + 1} failed, retrying...`);
            setTimeout(
              () => {
                verifyInjection(retryCount + 1).then(resolve);
              },
              RETRY_DELAY * Math.pow(2, retryCount)
            );
          } else {
            console.error(TAG, "Failed to verify injection after max retries");
            injectionState.lastError = "Failed to verify injection";
            resolve(false);
          }
        }, 1e3);
        const handleVerification = (event) => {
          var _a, _b, _c;
          if (event.source === window && ((_a = event.data) == null ? void 0 : _a.source) === "keepkey-content" && ((_b = event.data) == null ? void 0 : _b.type) === "INJECTION_CONFIRMED" && ((_c = event.data) == null ? void 0 : _c.requestId) === verifyId) {
            clearTimeout(timeout);
            window.removeEventListener("message", handleVerification);
            isContentScriptReady = true;
            injectionState.isInjected = true;
            console.log(TAG, "Injection verified successfully");
            processQueue();
            resolve(true);
          }
        };
        window.addEventListener("message", handleVerification);
        window.postMessage(
          {
            source: "keepkey-injected",
            type: "INJECTION_VERIFY",
            requestId: verifyId,
            version: VERSION,
            timestamp: Date.now()
          },
          window.location.origin
        );
      });
    };
    function walletRequest(method, params = [], chain, callback) {
      const tag = TAG + " | walletRequest | ";
      if (!method || typeof method !== "string") {
        console.error(tag, "Invalid method:", method);
        callback(new Error("Invalid method"));
        return;
      }
      if (!Array.isArray(params)) {
        console.warn(tag, "Params not an array, wrapping:", params);
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
          requestTime: (/* @__PURE__ */ new Date()).toISOString(),
          referrer: document.referrer,
          href: window.location.href,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        };
        callbacks.set(requestId, {
          callback,
          timestamp: Date.now(),
          method
        });
        const message = {
          source: "keepkey-injected",
          type: "WALLET_REQUEST",
          requestId,
          requestInfo,
          timestamp: Date.now()
        };
        if (isContentScriptReady) {
          window.postMessage(message, window.location.origin);
        } else {
          console.log(tag, "Content script not ready, queueing request");
          addToQueue(message);
        }
      } catch (error) {
        console.error(tag, "Error in walletRequest:", error);
        callback(error);
      }
    }
    window.addEventListener("message", (event) => {
      const tag = TAG + " | message | ";
      if (event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.source === "keepkey-content" && data.type === "INJECTION_CONFIRMED") {
        isContentScriptReady = true;
        processQueue();
        return;
      }
      if (data.source === "keepkey-content" && data.type === "WALLET_RESPONSE" && data.requestId) {
        const callback = callbacks.get(data.requestId);
        if (callback) {
          if (data.error) {
            callback.callback(data.error);
          } else {
            callback.callback(null, data.result);
          }
          callbacks.delete(data.requestId);
        } else {
          console.warn(tag, "No callback found for requestId:", data.requestId);
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
        (_a = this.events.get(event)) == null ? void 0 : _a.forEach((handler) => {
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
      console.log(TAG, "Creating wallet object for chain:", chain);
      const eventEmitter = new EventEmitter();
      const wallet = {
        network: "mainnet",
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
          if (typeof callback === "function") {
            walletRequest(payload.method, payload.params || param1, chain, (error, result) => {
              if (error) {
                callback(error);
              } else {
                callback(null, { id: payload.id, jsonrpc: "2.0", result });
              }
            });
            return void 0;
          } else {
            console.warn(TAG, "Synchronous send is deprecated and may not work properly");
            return { id: payload.id, jsonrpc: "2.0", result: null };
          }
        },
        sendAsync: (payload, param1, callback) => {
          if (!payload.chain) {
            payload.chain = chain;
          }
          const cb = callback || param1;
          if (typeof cb !== "function") {
            console.error(TAG, "sendAsync requires a callback function");
            return;
          }
          walletRequest(payload.method, payload.params || param1, chain, (error, result) => {
            if (error) {
              cb(error);
            } else {
              cb(null, { id: payload.id, jsonrpc: "2.0", result });
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
        removeAllListeners: (event) => {
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
          return wallet.request({ method: "eth_requestAccounts" });
        },
        _metamask: {
          isUnlocked: () => Promise.resolve(true)
        }
      };
      if (chain === "ethereum") {
        wallet.chainId = "0x1";
        wallet.networkVersion = "1";
        wallet.selectedAddress = null;
        wallet._handleAccountsChanged = (accounts) => {
          wallet.selectedAddress = accounts[0] || null;
          eventEmitter.emit("accountsChanged", accounts);
        };
        wallet._handleChainChanged = (chainId) => {
          wallet.chainId = chainId;
          eventEmitter.emit("chainChanged", chainId);
        };
        wallet._handleConnect = (info) => {
          eventEmitter.emit("connect", info);
        };
        wallet._handleDisconnect = (error) => {
          wallet.selectedAddress = null;
          eventEmitter.emit("disconnect", error);
        };
      }
      return wallet;
    }
    function announceProvider(ethereumProvider) {
      const info = {
        uuid: "350670db-19fa-4704-a166-e52e178b59d4",
        name: "KeepKey",
        icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==",
        rdns: "com.keepkey.client"
      };
      const announceEvent = new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider: ethereumProvider })
      });
      console.log(TAG, "Announcing EIP-6963 provider");
      window.dispatchEvent(announceEvent);
    }
    async function mountWallet() {
      const tag = TAG + " | mountWallet | ";
      console.log(tag, "Starting wallet mount process");
      const ethereum = createWalletObject("ethereum");
      const xfi = {
        binance: createWalletObject("binance"),
        bitcoin: createWalletObject("bitcoin"),
        bitcoincash: createWalletObject("bitcoincash"),
        dogecoin: createWalletObject("dogecoin"),
        dash: createWalletObject("dash"),
        ethereum,
        keplr: createWalletObject("keplr"),
        litecoin: createWalletObject("litecoin"),
        thorchain: createWalletObject("thorchain"),
        mayachain: createWalletObject("mayachain")
      };
      const keepkey = {
        binance: createWalletObject("binance"),
        bitcoin: createWalletObject("bitcoin"),
        bitcoincash: createWalletObject("bitcoincash"),
        dogecoin: createWalletObject("dogecoin"),
        dash: createWalletObject("dash"),
        ethereum,
        osmosis: createWalletObject("osmosis"),
        cosmos: createWalletObject("cosmos"),
        litecoin: createWalletObject("litecoin"),
        thorchain: createWalletObject("thorchain"),
        mayachain: createWalletObject("mayachain"),
        ripple: createWalletObject("ripple")
      };
      const mountProvider = (name, provider) => {
        if (kWindow[name]) {
          console.warn(tag, `${name} already exists, checking if override is allowed`);
        }
        try {
          Object.defineProperty(kWindow, name, {
            value: provider,
            writable: false,
            configurable: true
            // Allow reconfiguration for updates
          });
          console.log(tag, `Successfully mounted window.${name}`);
        } catch (e) {
          console.error(tag, `Failed to mount window.${name}:`, e);
          injectionState.lastError = `Failed to mount ${name}`;
        }
      };
      mountProvider("ethereum", ethereum);
      mountProvider("xfi", xfi);
      mountProvider("keepkey", keepkey);
      window.addEventListener("eip6963:requestProvider", () => {
        console.log(tag, "Re-announcing provider on request");
        announceProvider(ethereum);
      });
      announceProvider(ethereum);
      setTimeout(() => {
        console.log(tag, "Delayed EIP-6963 announcement for late-loading dApps");
        announceProvider(ethereum);
      }, 100);
      window.addEventListener("message", (event) => {
        var _a, _b, _c;
        if (((_a = event.data) == null ? void 0 : _a.type) === "CHAIN_CHANGED") {
          console.log(tag, "Chain changed:", event.data);
          ethereum.emit("chainChanged", (_b = event.data.provider) == null ? void 0 : _b.chainId);
        }
        if (((_c = event.data) == null ? void 0 : _c.type) === "ACCOUNTS_CHANGED") {
          console.log(tag, "Accounts changed:", event.data);
          if (ethereum._handleAccountsChanged) {
            ethereum._handleAccountsChanged(event.data.accounts || []);
          }
        }
      });
      verifyInjection().then((verified) => {
        if (!verified) {
          console.error(tag, "Failed to verify injection, wallet features may not work");
          injectionState.lastError = "Injection not verified";
        } else {
          console.log(tag, "Injection verified successfully");
        }
      });
      console.log(tag, "Wallet mount complete");
    }
    mountWallet();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        console.log(TAG, "DOM loaded, re-announcing provider for late-loading dApps");
        if (kWindow.ethereum && typeof kWindow.dispatchEvent === "function") {
          const ethereum = kWindow.ethereum;
          announceProvider(ethereum);
        }
      });
    }
    console.log(TAG, "Injection script loaded and initialized");
  })();
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luamVjdGVkL2luamVjdGVkLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7XG4gIFdhbGxldFJlcXVlc3RJbmZvLFxuICBXYWxsZXRNZXNzYWdlLFxuICBQcm92aWRlckluZm8sXG4gIFdhbGxldENhbGxiYWNrLFxuICBJbmplY3Rpb25TdGF0ZSxcbiAgQ2hhaW5UeXBlLFxuICBXYWxsZXRQcm92aWRlcixcbiAgS2VlcEtleVdpbmRvdyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbihmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IFRBRyA9ICcgfCBLZWVwS2V5SW5qZWN0ZWQgfCAnO1xuICBjb25zdCBWRVJTSU9OID0gJzIuMC4wJztcbiAgY29uc3QgTUFYX1JFVFJZX0NPVU5UID0gMztcbiAgY29uc3QgUkVUUllfREVMQVkgPSAxMDA7IC8vIG1zXG4gIGNvbnN0IENBTExCQUNLX1RJTUVPVVQgPSAzMDAwMDsgLy8gMzAgc2Vjb25kc1xuICBjb25zdCBNRVNTQUdFX1FVRVVFX01BWCA9IDEwMDtcblxuICBjb25zdCBrV2luZG93ID0gd2luZG93IGFzIEtlZXBLZXlXaW5kb3c7XG5cbiAgLy8gRW5oYW5jZWQgaW5qZWN0aW9uIHN0YXRlIHRyYWNraW5nXG4gIGNvbnN0IGluamVjdGlvblN0YXRlOiBJbmplY3Rpb25TdGF0ZSA9IHtcbiAgICBpc0luamVjdGVkOiBmYWxzZSxcbiAgICB2ZXJzaW9uOiBWRVJTSU9OLFxuICAgIGluamVjdGVkQXQ6IERhdGUubm93KCksXG4gICAgcmV0cnlDb3VudDogMCxcbiAgfTtcblxuICAvLyBDaGVjayBmb3IgZXhpc3RpbmcgaW5qZWN0aW9uIHdpdGggdmVyc2lvbiBjb21wYXJpc29uXG4gIGlmIChrV2luZG93LmtlZXBrZXlJbmplY3Rpb25TdGF0ZSkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0ga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGU7XG4gICAgY29uc29sZS53YXJuKFRBRywgYEV4aXN0aW5nIGluamVjdGlvbiBkZXRlY3RlZCB2JHtleGlzdGluZy52ZXJzaW9ufSwgY3VycmVudCB2JHtWRVJTSU9OfWApO1xuXG4gICAgLy8gT25seSBza2lwIGlmIHNhbWUgb3IgbmV3ZXIgdmVyc2lvblxuICAgIGlmIChleGlzdGluZy52ZXJzaW9uID49IFZFUlNJT04pIHtcbiAgICAgIGNvbnNvbGUubG9nKFRBRywgJ1NraXBwaW5nIGluamVjdGlvbiwgbmV3ZXIgb3Igc2FtZSB2ZXJzaW9uIGFscmVhZHkgcHJlc2VudCcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhUQUcsICdVcGdyYWRpbmcgaW5qZWN0aW9uIHRvIG5ld2VyIHZlcnNpb24nKTtcbiAgfVxuXG4gIC8vIFNldCBpbmplY3Rpb24gc3RhdGVcbiAga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGUgPSBpbmplY3Rpb25TdGF0ZTtcblxuICBjb25zb2xlLmxvZyhUQUcsIGBJbml0aWFsaXppbmcgS2VlcEtleSBJbmplY3Rpb24gdiR7VkVSU0lPTn1gKTtcblxuICAvLyBFbmhhbmNlZCBzb3VyY2UgaW5mb3JtYXRpb25cbiAgY29uc3QgU09VUkNFX0lORk8gPSB7XG4gICAgc2l0ZVVybDogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgc2NyaXB0U291cmNlOiAnS2VlcEtleSBFeHRlbnNpb24nLFxuICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgaW5qZWN0ZWRUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgb3JpZ2luOiB3aW5kb3cubG9jYXRpb24ub3JpZ2luLFxuICAgIHByb3RvY29sOiB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2wsXG4gIH07XG5cbiAgbGV0IG1lc3NhZ2VJZCA9IDA7XG4gIGNvbnN0IGNhbGxiYWNrcyA9IG5ldyBNYXA8bnVtYmVyLCBXYWxsZXRDYWxsYmFjaz4oKTtcbiAgY29uc3QgbWVzc2FnZVF1ZXVlOiBXYWxsZXRNZXNzYWdlW10gPSBbXTtcbiAgbGV0IGlzQ29udGVudFNjcmlwdFJlYWR5ID0gZmFsc2U7XG5cbiAgLy8gQ2xlYW51cCBvbGQgY2FsbGJhY2tzIHBlcmlvZGljYWxseVxuICBjb25zdCBjbGVhbnVwQ2FsbGJhY2tzID0gKCkgPT4ge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgY2FsbGJhY2tzLmZvckVhY2goKGNhbGxiYWNrLCBpZCkgPT4ge1xuICAgICAgaWYgKG5vdyAtIGNhbGxiYWNrLnRpbWVzdGFtcCA+IENBTExCQUNLX1RJTUVPVVQpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFRBRywgYENhbGxiYWNrIHRpbWVvdXQgZm9yIHJlcXVlc3QgJHtpZH0gKCR7Y2FsbGJhY2subWV0aG9kfSlgKTtcbiAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobmV3IEVycm9yKCdSZXF1ZXN0IHRpbWVvdXQnKSk7XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoaWQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIHNldEludGVydmFsKGNsZWFudXBDYWxsYmFja3MsIDUwMDApO1xuXG4gIC8vIE1hbmFnZSBtZXNzYWdlIHF1ZXVlIHNpemVcbiAgY29uc3QgYWRkVG9RdWV1ZSA9IChtZXNzYWdlOiBXYWxsZXRNZXNzYWdlKSA9PiB7XG4gICAgaWYgKG1lc3NhZ2VRdWV1ZS5sZW5ndGggPj0gTUVTU0FHRV9RVUVVRV9NQVgpIHtcbiAgICAgIGNvbnNvbGUud2FybihUQUcsICdNZXNzYWdlIHF1ZXVlIGZ1bGwsIHJlbW92aW5nIG9sZGVzdCBtZXNzYWdlJyk7XG4gICAgICBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICB9XG4gICAgbWVzc2FnZVF1ZXVlLnB1c2gobWVzc2FnZSk7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBxdWV1ZWQgbWVzc2FnZXMgd2hlbiBjb250ZW50IHNjcmlwdCBiZWNvbWVzIHJlYWR5XG4gIGNvbnN0IHByb2Nlc3NRdWV1ZSA9ICgpID0+IHtcbiAgICBpZiAoIWlzQ29udGVudFNjcmlwdFJlYWR5KSByZXR1cm47XG5cbiAgICB3aGlsZSAobWVzc2FnZVF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBtZXNzYWdlUXVldWUuc2hpZnQoKTtcbiAgICAgIGlmIChtZXNzYWdlKSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gVmVyaWZ5IGluamVjdGlvbiB3aXRoIGNvbnRlbnQgc2NyaXB0XG4gIGNvbnN0IHZlcmlmeUluamVjdGlvbiA9IChyZXRyeUNvdW50ID0gMCk6IFByb21pc2U8Ym9vbGVhbj4gPT4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgIGNvbnN0IHZlcmlmeUlkID0gKyttZXNzYWdlSWQ7XG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGlmIChyZXRyeUNvdW50IDwgTUFYX1JFVFJZX0NPVU5UKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coVEFHLCBgVmVyaWZpY2F0aW9uIGF0dGVtcHQgJHtyZXRyeUNvdW50ICsgMX0gZmFpbGVkLCByZXRyeWluZy4uLmApO1xuICAgICAgICAgIHNldFRpbWVvdXQoXG4gICAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAgIHZlcmlmeUluamVjdGlvbihyZXRyeUNvdW50ICsgMSkudGhlbihyZXNvbHZlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBSRVRSWV9ERUxBWSAqIE1hdGgucG93KDIsIHJldHJ5Q291bnQpLFxuICAgICAgICAgICk7IC8vIEV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFRBRywgJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uIGFmdGVyIG1heCByZXRyaWVzJyk7XG4gICAgICAgICAgaW5qZWN0aW9uU3RhdGUubGFzdEVycm9yID0gJ0ZhaWxlZCB0byB2ZXJpZnkgaW5qZWN0aW9uJztcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgICAgfSwgMTAwMCk7XG5cbiAgICAgIGNvbnN0IGhhbmRsZVZlcmlmaWNhdGlvbiA9IChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBldmVudC5zb3VyY2UgPT09IHdpbmRvdyAmJlxuICAgICAgICAgIGV2ZW50LmRhdGE/LnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcgJiZcbiAgICAgICAgICBldmVudC5kYXRhPy5yZXF1ZXN0SWQgPT09IHZlcmlmeUlkXG4gICAgICAgICkge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG4gICAgICAgICAgaXNDb250ZW50U2NyaXB0UmVhZHkgPSB0cnVlO1xuICAgICAgICAgIGluamVjdGlvblN0YXRlLmlzSW5qZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgIGNvbnNvbGUubG9nKFRBRywgJ0luamVjdGlvbiB2ZXJpZmllZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgICAgICBwcm9jZXNzUXVldWUoKTtcbiAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZVZlcmlmaWNhdGlvbik7XG5cbiAgICAgIC8vIFNlbmQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcbiAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShcbiAgICAgICAge1xuICAgICAgICAgIHNvdXJjZTogJ2tlZXBrZXktaW5qZWN0ZWQnLFxuICAgICAgICAgIHR5cGU6ICdJTkpFQ1RJT05fVkVSSUZZJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6IHZlcmlmeUlkLFxuICAgICAgICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICB9IGFzIFdhbGxldE1lc3NhZ2UsXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4sXG4gICAgICApO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIEVuaGFuY2VkIHdhbGxldCByZXF1ZXN0IHdpdGggdmFsaWRhdGlvblxuICBmdW5jdGlvbiB3YWxsZXRSZXF1ZXN0KFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIHBhcmFtczogYW55W10gPSBbXSxcbiAgICBjaGFpbjogQ2hhaW5UeXBlLFxuICAgIGNhbGxiYWNrOiAoZXJyb3I6IGFueSwgcmVzdWx0PzogYW55KSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgd2FsbGV0UmVxdWVzdCB8ICc7XG5cbiAgICAvLyBWYWxpZGF0ZSBpbnB1dHNcbiAgICBpZiAoIW1ldGhvZCB8fCB0eXBlb2YgbWV0aG9kICE9PSAnc3RyaW5nJykge1xuICAgICAgY29uc29sZS5lcnJvcih0YWcsICdJbnZhbGlkIG1ldGhvZDonLCBtZXRob2QpO1xuICAgICAgY2FsbGJhY2sobmV3IEVycm9yKCdJbnZhbGlkIG1ldGhvZCcpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGFyYW1zKSkge1xuICAgICAgY29uc29sZS53YXJuKHRhZywgJ1BhcmFtcyBub3QgYW4gYXJyYXksIHdyYXBwaW5nOicsIHBhcmFtcyk7XG4gICAgICBwYXJhbXMgPSBbcGFyYW1zXTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVxdWVzdElkID0gKyttZXNzYWdlSWQ7XG4gICAgICBjb25zdCByZXF1ZXN0SW5mbzogV2FsbGV0UmVxdWVzdEluZm8gPSB7XG4gICAgICAgIGlkOiByZXF1ZXN0SWQsXG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBjaGFpbixcbiAgICAgICAgc2l0ZVVybDogU09VUkNFX0lORk8uc2l0ZVVybCxcbiAgICAgICAgc2NyaXB0U291cmNlOiBTT1VSQ0VfSU5GTy5zY3JpcHRTb3VyY2UsXG4gICAgICAgIHZlcnNpb246IFNPVVJDRV9JTkZPLnZlcnNpb24sXG4gICAgICAgIHJlcXVlc3RUaW1lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHJlZmVycmVyOiBkb2N1bWVudC5yZWZlcnJlcixcbiAgICAgICAgaHJlZjogd2luZG93LmxvY2F0aW9uLmhyZWYsXG4gICAgICAgIHVzZXJBZ2VudDogbmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgcGxhdGZvcm06IG5hdmlnYXRvci5wbGF0Zm9ybSxcbiAgICAgICAgbGFuZ3VhZ2U6IG5hdmlnYXRvci5sYW5ndWFnZSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFN0b3JlIGNhbGxiYWNrIHdpdGggbWV0YWRhdGFcbiAgICAgIGNhbGxiYWNrcy5zZXQocmVxdWVzdElkLCB7XG4gICAgICAgIGNhbGxiYWNrLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIG1ldGhvZCxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtZXNzYWdlOiBXYWxsZXRNZXNzYWdlID0ge1xuICAgICAgICBzb3VyY2U6ICdrZWVwa2V5LWluamVjdGVkJyxcbiAgICAgICAgdHlwZTogJ1dBTExFVF9SRVFVRVNUJyxcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICByZXF1ZXN0SW5mbyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfTtcblxuICAgICAgaWYgKGlzQ29udGVudFNjcmlwdFJlYWR5KSB7XG4gICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZShtZXNzYWdlLCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHRhZywgJ0NvbnRlbnQgc2NyaXB0IG5vdCByZWFkeSwgcXVldWVpbmcgcmVxdWVzdCcpO1xuICAgICAgICBhZGRUb1F1ZXVlKG1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHRhZywgJ0Vycm9yIGluIHdhbGxldFJlcXVlc3Q6JywgZXJyb3IpO1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIExpc3RlbiBmb3IgcmVzcG9uc2VzIHdpdGggZW5oYW5jZWQgdmFsaWRhdGlvblxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFnID0gVEFHICsgJyB8IG1lc3NhZ2UgfCAnO1xuXG4gICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIG9yaWdpblxuICAgIGlmIChldmVudC5zb3VyY2UgIT09IHdpbmRvdykgcmV0dXJuO1xuXG4gICAgY29uc3QgZGF0YSA9IGV2ZW50LmRhdGEgYXMgV2FsbGV0TWVzc2FnZTtcbiAgICBpZiAoIWRhdGEgfHwgdHlwZW9mIGRhdGEgIT09ICdvYmplY3QnKSByZXR1cm47XG5cbiAgICAvLyBIYW5kbGUgaW5qZWN0aW9uIGNvbmZpcm1hdGlvblxuICAgIGlmIChkYXRhLnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiYgZGF0YS50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcpIHtcbiAgICAgIGlzQ29udGVudFNjcmlwdFJlYWR5ID0gdHJ1ZTtcbiAgICAgIHByb2Nlc3NRdWV1ZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSB3YWxsZXQgcmVzcG9uc2VzXG4gICAgaWYgKGRhdGEuc291cmNlID09PSAna2VlcGtleS1jb250ZW50JyAmJiBkYXRhLnR5cGUgPT09ICdXQUxMRVRfUkVTUE9OU0UnICYmIGRhdGEucmVxdWVzdElkKSB7XG4gICAgICBjb25zdCBjYWxsYmFjayA9IGNhbGxiYWNrcy5nZXQoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChkYXRhLmVycm9yKSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2soZGF0YS5lcnJvcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobnVsbCwgZGF0YS5yZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS53YXJuKHRhZywgJ05vIGNhbGxiYWNrIGZvdW5kIGZvciByZXF1ZXN0SWQ6JywgZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLy8gRXZlbnQgZW1pdHRlciBpbXBsZW1lbnRhdGlvbiBmb3IgRUlQLTExOTMgY29tcGF0aWJpbGl0eVxuICBjbGFzcyBFdmVudEVtaXR0ZXIge1xuICAgIHByaXZhdGUgZXZlbnRzOiBNYXA8c3RyaW5nLCBTZXQ8RnVuY3Rpb24+PiA9IG5ldyBNYXAoKTtcblxuICAgIG9uKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzLmhhcyhldmVudCkpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuc2V0KGV2ZW50LCBuZXcgU2V0KCkpO1xuICAgICAgfVxuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KSEuYWRkKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIG9mZihldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZGVsZXRlKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICB0aGlzLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgfVxuXG4gICAgcmVtb3ZlQWxsTGlzdGVuZXJzKGV2ZW50Pzogc3RyaW5nKSB7XG4gICAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuZGVsZXRlKGV2ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZXZlbnRzLmNsZWFyKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZW1pdChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZm9yRWFjaChoYW5kbGVyID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoVEFHLCBgRXJyb3IgaW4gZXZlbnQgaGFuZGxlciBmb3IgJHtldmVudH06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBvbmNlKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBjb25zdCBvbmNlSGFuZGxlciA9ICguLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB0aGlzLm9mZihldmVudCwgb25jZUhhbmRsZXIpO1xuICAgICAgfTtcbiAgICAgIHRoaXMub24oZXZlbnQsIG9uY2VIYW5kbGVyKTtcbiAgICB9XG4gIH1cblxuICAvLyBDcmVhdGUgd2FsbGV0IHByb3ZpZGVyIHdpdGggcHJvcGVyIHR5cGluZ1xuICBmdW5jdGlvbiBjcmVhdGVXYWxsZXRPYmplY3QoY2hhaW46IENoYWluVHlwZSk6IFdhbGxldFByb3ZpZGVyIHtcbiAgICBjb25zb2xlLmxvZyhUQUcsICdDcmVhdGluZyB3YWxsZXQgb2JqZWN0IGZvciBjaGFpbjonLCBjaGFpbik7XG5cbiAgICBjb25zdCBldmVudEVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbiAgICBjb25zdCB3YWxsZXQ6IFdhbGxldFByb3ZpZGVyID0ge1xuICAgICAgbmV0d29yazogJ21haW5uZXQnLFxuICAgICAgaXNLZWVwS2V5OiB0cnVlLFxuICAgICAgaXNNZXRhTWFzazogdHJ1ZSxcbiAgICAgIGlzQ29ubmVjdGVkOiAoKSA9PiBpc0NvbnRlbnRTY3JpcHRSZWFkeSxcblxuICAgICAgcmVxdWVzdDogKHsgbWV0aG9kLCBwYXJhbXMgPSBbXSB9KSA9PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgd2FsbGV0UmVxdWVzdChtZXRob2QsIHBhcmFtcywgY2hhaW4sIChlcnJvciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBzZW5kOiAocGF5bG9hZDogYW55LCBwYXJhbTE/OiBhbnksIGNhbGxiYWNrPzogYW55KTogYW55ID0+IHtcbiAgICAgICAgaWYgKCFwYXlsb2FkLmNoYWluKSB7XG4gICAgICAgICAgcGF5bG9hZC5jaGFpbiA9IGNoYWluO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEFzeW5jIHNlbmRcbiAgICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHsgaWQ6IHBheWxvYWQuaWQsIGpzb25ycGM6ICcyLjAnLCByZXN1bHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTeW5jIHNlbmQgKGRlcHJlY2F0ZWQsIGJ1dCByZXF1aXJlZCBmb3IgY29tcGF0aWJpbGl0eSlcbiAgICAgICAgICBjb25zb2xlLndhcm4oVEFHLCAnU3luY2hyb25vdXMgc2VuZCBpcyBkZXByZWNhdGVkIGFuZCBtYXkgbm90IHdvcmsgcHJvcGVybHknKTtcbiAgICAgICAgICByZXR1cm4geyBpZDogcGF5bG9hZC5pZCwganNvbnJwYzogJzIuMCcsIHJlc3VsdDogbnVsbCB9O1xuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBzZW5kQXN5bmM6IChwYXlsb2FkOiBhbnksIHBhcmFtMT86IGFueSwgY2FsbGJhY2s/OiBhbnkpID0+IHtcbiAgICAgICAgaWYgKCFwYXlsb2FkLmNoYWluKSB7XG4gICAgICAgICAgcGF5bG9hZC5jaGFpbiA9IGNoYWluO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY2IgPSBjYWxsYmFjayB8fCBwYXJhbTE7XG4gICAgICAgIGlmICh0eXBlb2YgY2IgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKFRBRywgJ3NlbmRBc3luYyByZXF1aXJlcyBhIGNhbGxiYWNrIGZ1bmN0aW9uJyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgd2FsbGV0UmVxdWVzdChwYXlsb2FkLm1ldGhvZCwgcGF5bG9hZC5wYXJhbXMgfHwgcGFyYW0xLCBjaGFpbiwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNiKGVycm9yKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2IobnVsbCwgeyBpZDogcGF5bG9hZC5pZCwganNvbnJwYzogJzIuMCcsIHJlc3VsdCB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSxcblxuICAgICAgb246IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIub24oZXZlbnQsIGhhbmRsZXIpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIG9mZjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vZmYoZXZlbnQsIGhhbmRsZXIpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIHJlbW92ZUxpc3RlbmVyOiAoZXZlbnQ6IHN0cmluZywgaGFuZGxlcjogRnVuY3Rpb24pID0+IHtcbiAgICAgICAgZXZlbnRFbWl0dGVyLnJlbW92ZUxpc3RlbmVyKGV2ZW50LCBoYW5kbGVyKTtcbiAgICAgICAgcmV0dXJuIHdhbGxldDsgLy8gUmV0dXJuIHRoaXMgZm9yIGNoYWluaW5nXG4gICAgICB9LFxuXG4gICAgICByZW1vdmVBbGxMaXN0ZW5lcnM6IChldmVudD86IHN0cmluZykgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIucmVtb3ZlQWxsTGlzdGVuZXJzKGV2ZW50KTtcbiAgICAgICAgcmV0dXJuIHdhbGxldDsgLy8gUmV0dXJuIHRoaXMgZm9yIGNoYWluaW5nXG4gICAgICB9LFxuXG4gICAgICBlbWl0OiAoZXZlbnQ6IHN0cmluZywgLi4uYXJnczogYW55W10pID0+IHtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoZXZlbnQsIC4uLmFyZ3MpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIG9uY2U6IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIub25jZShldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgLy8gQWRkaXRpb25hbCBtZXRob2RzIGZvciBjb21wYXRpYmlsaXR5XG4gICAgICBlbmFibGU6ICgpID0+IHtcbiAgICAgICAgLy8gTGVnYWN5IG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICByZXR1cm4gd2FsbGV0LnJlcXVlc3QoeyBtZXRob2Q6ICdldGhfcmVxdWVzdEFjY291bnRzJyB9KTtcbiAgICAgIH0sXG5cbiAgICAgIF9tZXRhbWFzazoge1xuICAgICAgICBpc1VubG9ja2VkOiAoKSA9PiBQcm9taXNlLnJlc29sdmUodHJ1ZSksXG4gICAgICB9LFxuICAgIH07XG5cbiAgICAvLyBBZGQgY2hhaW4tc3BlY2lmaWMgcHJvcGVydGllc1xuICAgIGlmIChjaGFpbiA9PT0gJ2V0aGVyZXVtJykge1xuICAgICAgd2FsbGV0LmNoYWluSWQgPSAnMHgxJztcbiAgICAgIHdhbGxldC5uZXR3b3JrVmVyc2lvbiA9ICcxJztcbiAgICAgIHdhbGxldC5zZWxlY3RlZEFkZHJlc3MgPSBudWxsOyAvLyBXaWxsIGJlIHBvcHVsYXRlZCBhZnRlciBjb25uZWN0aW9uXG5cbiAgICAgIC8vIEF1dG8tY29ubmVjdCBoYW5kbGVyXG4gICAgICB3YWxsZXQuX2hhbmRsZUFjY291bnRzQ2hhbmdlZCA9IChhY2NvdW50czogc3RyaW5nW10pID0+IHtcbiAgICAgICAgd2FsbGV0LnNlbGVjdGVkQWRkcmVzcyA9IGFjY291bnRzWzBdIHx8IG51bGw7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdhY2NvdW50c0NoYW5nZWQnLCBhY2NvdW50cyk7XG4gICAgICB9O1xuXG4gICAgICB3YWxsZXQuX2hhbmRsZUNoYWluQ2hhbmdlZCA9IChjaGFpbklkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgd2FsbGV0LmNoYWluSWQgPSBjaGFpbklkO1xuICAgICAgICBldmVudEVtaXR0ZXIuZW1pdCgnY2hhaW5DaGFuZ2VkJywgY2hhaW5JZCk7XG4gICAgICB9O1xuXG4gICAgICB3YWxsZXQuX2hhbmRsZUNvbm5lY3QgPSAoaW5mbzogeyBjaGFpbklkOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIuZW1pdCgnY29ubmVjdCcsIGluZm8pO1xuICAgICAgfTtcblxuICAgICAgd2FsbGV0Ll9oYW5kbGVEaXNjb25uZWN0ID0gKGVycm9yOiB7IGNvZGU6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0pID0+IHtcbiAgICAgICAgd2FsbGV0LnNlbGVjdGVkQWRkcmVzcyA9IG51bGw7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdkaXNjb25uZWN0JywgZXJyb3IpO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gd2FsbGV0O1xuICB9XG5cbiAgLy8gRUlQLTY5NjMgUHJvdmlkZXIgQW5ub3VuY2VtZW50XG4gIGZ1bmN0aW9uIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW1Qcm92aWRlcjogV2FsbGV0UHJvdmlkZXIpIHtcbiAgICBjb25zdCBpbmZvOiBQcm92aWRlckluZm8gPSB7XG4gICAgICB1dWlkOiAnMzUwNjcwZGItMTlmYS00NzA0LWExNjYtZTUyZTE3OGI1OWQ0JyxcbiAgICAgIG5hbWU6ICdLZWVwS2V5JyxcbiAgICAgIGljb246ICdkYXRhOmltYWdlL3BuZztiYXNlNjQsaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUNBQUFBQWdDQVlBQUFCemVucjBBQUFBQVhOU1IwSUFyczRjNlFBQUFFUmxXRWxtVFUwQUtnQUFBQWdBQVlkcEFBUUFBQUFCQUFBQUdnQUFBQUFBQTZBQkFBTUFBQUFCQUFFQUFLQUNBQVFBQUFBQkFBQUFJS0FEQUFRQUFBQUJBQUFBSUFBQUFBQ3NobUx6QUFBRFVrbEVRVlJZQ2IxWFRVZ1VZUmllM2JYRVdoVkxRYVVzZ3dWTG9VdEVRalVKaVpYMEEwR1g3QklaWHVya09UU3ZkbzJrdkVUSEFzT3NoRmdxT3FobFJEOUM3U0dTMUpUQ3NqMWtyVTdQTSt3N3pNek96dXpNcWk4OCs3M3Y5ejd2ejN6enpUZXppdUlnbXFiRmdHNWdCUGd1Rk9ncTRDWExJTXdDbzBBWEVKTjR6eEhrRXVBNmtBSU1rVUJNcU1aazdzby9VRzhBVWNuak9JS3dGWGdIWklnRXdLRm1PSE9mWU80YXlTVmptQW9jN080UjBFQjdsWVM1aDlLMWpCSjZBN0N1QWZYRzdPb3BiS0xYa2g0ZGNjTlo3amxzaTBnQUpsV0xJNWpCUFdGc1RLNUFHeENSSW1zd0ZxREdXYW5EQm82SXNZYmpVYW5GYm1yRldJSHhEM0lzbWZKc2dCNHkyYUp1RjRVclVDNUdudU50eEplRVFxRW9BYjNMSlYrRjRjdGxId2taWERVTHY4ZkVLUUNIQjQrckNKOW5nS2NJR1VUVlJ1YlQwMjd5OHlSOWJPTTRtaEtUVHdOSlpENG1pYURYQUc4ZHF6bE1TaHczWVJDWlJWQXI3dlU0ZzVGL0Q0WkJvSksySCtFbTlDc2ZFZEJvS240SzlqUEFkM0c5c01QcVpFenBSUHpBd1JmV0pwTjlFZlpTUmtBT0U1TEQ3d3J3OGRrcHdSaDU1Vk1tMjdmcXQ0RmlWQmpHQlRheEVtNERiOGQrNEJQdElPSzNBZGJZQ1BDMXFoL2hhR0lTOWdIZ0RlQmJnalRBSWtYQWZUUnhrZ2FhbU1Od0NIZ0IrQk1rNERlY3EwaEdrRlFia2EvV015Wi9FZXlITm82VHVTd3gzTm44Z0hRVklZT2tPaEI1R3A0emNkYkJIaUR2WjJwUnV6b3pydTJldUt1RE91Y2cvS2xpVEFqS0tNYTlrc0JweEJMcmJ6UndWZmlmT25CNFJSMmczUVNIM0NmeDVGUmRjMktvR3N0cm9VZVFLaDQ3dm5Bd1d2VUtqc1BjQS93V2RCVWtqUkFnWmRzem5POEQ1eExHQy9PcHhjM05pUWVWOXVJc2drTkRhVW9NRnBORExsZUFuMGNUUU5CakdhRlc2Zm4yV3JreS9kSTZhYlBPbDllTjlkZW9XaGpMbG9DdjMrYlB5N3czLzlremZ2algxMjBnMWN1U2RzSjQ3eG0xQ2dTOUFheENFcmxiVjZxSjAyVzFucTIybEc3NUF0SUhXUUVlSnBPWWFBVDZnQlFRV0M1WE5DamM3ZGtrSEZLV2U2djNGY0xmYnpSQU1sY0M2SUM2QytnR3hnQ2VjdFpuQ1JNdW9wVkcxditOeDA0c1lJTmx4TEg0d0k2VzUyVUZoVCtRNDFiMk5sMHFlTG53WlBHUXVjTkhyWE42WkRHOTRSUXVPNjg4WGJ3TkZ6dmpsU3V3SDAzd0VXOEgrQmYvZHhyVU9XZGMrSDhtS1h0RXBHcFkzQUFBQUFCSlJVNUVya0pnZ2c9PScsXG4gICAgICByZG5zOiAnY29tLmtlZXBrZXkuY2xpZW50JyxcbiAgICB9O1xuXG4gICAgY29uc3QgYW5ub3VuY2VFdmVudCA9IG5ldyBDdXN0b21FdmVudCgnZWlwNjk2Mzphbm5vdW5jZVByb3ZpZGVyJywge1xuICAgICAgZGV0YWlsOiBPYmplY3QuZnJlZXplKHsgaW5mbywgcHJvdmlkZXI6IGV0aGVyZXVtUHJvdmlkZXIgfSksXG4gICAgfSk7XG5cbiAgICBjb25zb2xlLmxvZyhUQUcsICdBbm5vdW5jaW5nIEVJUC02OTYzIHByb3ZpZGVyJyk7XG4gICAgd2luZG93LmRpc3BhdGNoRXZlbnQoYW5ub3VuY2VFdmVudCk7XG4gIH1cblxuICAvLyBNb3VudCB3YWxsZXQgd2l0aCBwcm9wZXIgc3RhdGUgbWFuYWdlbWVudFxuICBhc3luYyBmdW5jdGlvbiBtb3VudFdhbGxldCgpIHtcbiAgICBjb25zdCB0YWcgPSBUQUcgKyAnIHwgbW91bnRXYWxsZXQgfCAnO1xuICAgIGNvbnNvbGUubG9nKHRhZywgJ1N0YXJ0aW5nIHdhbGxldCBtb3VudCBwcm9jZXNzJyk7XG5cbiAgICAvLyBDcmVhdGUgd2FsbGV0IG9iamVjdHMgaW1tZWRpYXRlbHkgLSBkb24ndCB3YWl0IGZvciB2ZXJpZmljYXRpb25cbiAgICBjb25zdCBldGhlcmV1bSA9IGNyZWF0ZVdhbGxldE9iamVjdCgnZXRoZXJldW0nKTtcbiAgICBjb25zdCB4Zmk6IFJlY29yZDxzdHJpbmcsIFdhbGxldFByb3ZpZGVyPiA9IHtcbiAgICAgIGJpbmFuY2U6IGNyZWF0ZVdhbGxldE9iamVjdCgnYmluYW5jZScpLFxuICAgICAgYml0Y29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaXRjb2luJyksXG4gICAgICBiaXRjb2luY2FzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaXRjb2luY2FzaCcpLFxuICAgICAgZG9nZWNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnZG9nZWNvaW4nKSxcbiAgICAgIGRhc2g6IGNyZWF0ZVdhbGxldE9iamVjdCgnZGFzaCcpLFxuICAgICAgZXRoZXJldW06IGV0aGVyZXVtLFxuICAgICAga2VwbHI6IGNyZWF0ZVdhbGxldE9iamVjdCgna2VwbHInKSxcbiAgICAgIGxpdGVjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2xpdGVjb2luJyksXG4gICAgICB0aG9yY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgndGhvcmNoYWluJyksXG4gICAgICBtYXlhY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbWF5YWNoYWluJyksXG4gICAgfTtcblxuICAgIGNvbnN0IGtlZXBrZXk6IFJlY29yZDxzdHJpbmcsIFdhbGxldFByb3ZpZGVyPiA9IHtcbiAgICAgIGJpbmFuY2U6IGNyZWF0ZVdhbGxldE9iamVjdCgnYmluYW5jZScpLFxuICAgICAgYml0Y29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaXRjb2luJyksXG4gICAgICBiaXRjb2luY2FzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaXRjb2luY2FzaCcpLFxuICAgICAgZG9nZWNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnZG9nZWNvaW4nKSxcbiAgICAgIGRhc2g6IGNyZWF0ZVdhbGxldE9iamVjdCgnZGFzaCcpLFxuICAgICAgZXRoZXJldW06IGV0aGVyZXVtLFxuICAgICAgb3Ntb3NpczogY3JlYXRlV2FsbGV0T2JqZWN0KCdvc21vc2lzJyksXG4gICAgICBjb3Ntb3M6IGNyZWF0ZVdhbGxldE9iamVjdCgnY29zbW9zJyksXG4gICAgICBsaXRlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdsaXRlY29pbicpLFxuICAgICAgdGhvcmNoYWluOiBjcmVhdGVXYWxsZXRPYmplY3QoJ3Rob3JjaGFpbicpLFxuICAgICAgbWF5YWNoYWluOiBjcmVhdGVXYWxsZXRPYmplY3QoJ21heWFjaGFpbicpLFxuICAgICAgcmlwcGxlOiBjcmVhdGVXYWxsZXRPYmplY3QoJ3JpcHBsZScpLFxuICAgIH07XG5cbiAgICAvLyBNb3VudCBwcm92aWRlcnMgd2l0aCBjb25mbGljdCBkZXRlY3Rpb25cbiAgICBjb25zdCBtb3VudFByb3ZpZGVyID0gKG5hbWU6IHN0cmluZywgcHJvdmlkZXI6IGFueSkgPT4ge1xuICAgICAgaWYgKChrV2luZG93IGFzIGFueSlbbmFtZV0pIHtcbiAgICAgICAgY29uc29sZS53YXJuKHRhZywgYCR7bmFtZX0gYWxyZWFkeSBleGlzdHMsIGNoZWNraW5nIGlmIG92ZXJyaWRlIGlzIGFsbG93ZWRgKTtcbiAgICAgICAgLy8gVE9ETzogQWRkIHVzZXIgcHJlZmVyZW5jZSBjaGVjayBoZXJlXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShrV2luZG93LCBuYW1lLCB7XG4gICAgICAgICAgdmFsdWU6IHByb3ZpZGVyLFxuICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHRydWUsIC8vIEFsbG93IHJlY29uZmlndXJhdGlvbiBmb3IgdXBkYXRlc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc29sZS5sb2codGFnLCBgU3VjY2Vzc2Z1bGx5IG1vdW50ZWQgd2luZG93LiR7bmFtZX1gKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcih0YWcsIGBGYWlsZWQgdG8gbW91bnQgd2luZG93LiR7bmFtZX06YCwgZSk7XG4gICAgICAgIGluamVjdGlvblN0YXRlLmxhc3RFcnJvciA9IGBGYWlsZWQgdG8gbW91bnQgJHtuYW1lfWA7XG4gICAgICB9XG4gICAgfTtcblxuICAgIC8vIE1vdW50IHByb3ZpZGVyc1xuICAgIG1vdW50UHJvdmlkZXIoJ2V0aGVyZXVtJywgZXRoZXJldW0pO1xuICAgIG1vdW50UHJvdmlkZXIoJ3hmaScsIHhmaSk7XG4gICAgbW91bnRQcm92aWRlcigna2VlcGtleScsIGtlZXBrZXkpO1xuXG4gICAgLy8gQ1JJVElDQUw6IFNldCB1cCBFSVAtNjk2MyBsaXN0ZW5lciBCRUZPUkUgYW5ub3VuY2luZ1xuICAgIC8vIFRoaXMgZW5zdXJlcyB3ZSBjYXRjaCBhbnkgaW1tZWRpYXRlIHJlcXVlc3RzXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2VpcDY5NjM6cmVxdWVzdFByb3ZpZGVyJywgKCkgPT4ge1xuICAgICAgY29uc29sZS5sb2codGFnLCAnUmUtYW5ub3VuY2luZyBwcm92aWRlciBvbiByZXF1ZXN0Jyk7XG4gICAgICBhbm5vdW5jZVByb3ZpZGVyKGV0aGVyZXVtKTtcbiAgICB9KTtcblxuICAgIC8vIEFubm91bmNlIEVJUC02OTYzIHByb3ZpZGVyIGltbWVkaWF0ZWx5XG4gICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG5cbiAgICAvLyBBbHNvIGFubm91bmNlIHdpdGggYSBzbGlnaHQgZGVsYXkgdG8gY2F0Y2ggbGF0ZS1sb2FkaW5nIGRBcHBzXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyh0YWcsICdEZWxheWVkIEVJUC02OTYzIGFubm91bmNlbWVudCBmb3IgbGF0ZS1sb2FkaW5nIGRBcHBzJyk7XG4gICAgICBhbm5vdW5jZVByb3ZpZGVyKGV0aGVyZXVtKTtcbiAgICB9LCAxMDApO1xuXG4gICAgLy8gSGFuZGxlIGNoYWluIGNoYW5nZXMgYW5kIG90aGVyIGV2ZW50c1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgKGV2ZW50OiBNZXNzYWdlRXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAnQ0hBSU5fQ0hBTkdFRCcpIHtcbiAgICAgICAgY29uc29sZS5sb2codGFnLCAnQ2hhaW4gY2hhbmdlZDonLCBldmVudC5kYXRhKTtcbiAgICAgICAgZXRoZXJldW0uZW1pdCgnY2hhaW5DaGFuZ2VkJywgZXZlbnQuZGF0YS5wcm92aWRlcj8uY2hhaW5JZCk7XG4gICAgICB9XG4gICAgICBpZiAoZXZlbnQuZGF0YT8udHlwZSA9PT0gJ0FDQ09VTlRTX0NIQU5HRUQnKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHRhZywgJ0FjY291bnRzIGNoYW5nZWQ6JywgZXZlbnQuZGF0YSk7XG4gICAgICAgIGlmIChldGhlcmV1bS5faGFuZGxlQWNjb3VudHNDaGFuZ2VkKSB7XG4gICAgICAgICAgZXRoZXJldW0uX2hhbmRsZUFjY291bnRzQ2hhbmdlZChldmVudC5kYXRhLmFjY291bnRzIHx8IFtdKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gTm93IHZlcmlmeSBpbmplY3Rpb24gZm9yIGNvbnRlbnQgc2NyaXB0IGNvbW11bmljYXRpb25cbiAgICAvLyBUaGlzIGlzIG5vbi1ibG9ja2luZyBmb3IgRUlQLTY5NjNcbiAgICB2ZXJpZnlJbmplY3Rpb24oKS50aGVuKHZlcmlmaWVkID0+IHtcbiAgICAgIGlmICghdmVyaWZpZWQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcih0YWcsICdGYWlsZWQgdG8gdmVyaWZ5IGluamVjdGlvbiwgd2FsbGV0IGZlYXR1cmVzIG1heSBub3Qgd29yaycpO1xuICAgICAgICBpbmplY3Rpb25TdGF0ZS5sYXN0RXJyb3IgPSAnSW5qZWN0aW9uIG5vdCB2ZXJpZmllZCc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyh0YWcsICdJbmplY3Rpb24gdmVyaWZpZWQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zb2xlLmxvZyh0YWcsICdXYWxsZXQgbW91bnQgY29tcGxldGUnKTtcbiAgfVxuXG4gIC8vIEluaXRpYWxpemUgaW1tZWRpYXRlbHkgZm9yIEVJUC02OTYzIGNvbXBsaWFuY2VcbiAgLy8gVGhlIHNwZWMgcmVxdWlyZXMgYW5ub3VuY2VtZW50IGFzIGVhcmx5IGFzIHBvc3NpYmxlXG4gIG1vdW50V2FsbGV0KCk7XG5cbiAgLy8gQWxzbyByZS1ydW4gd2hlbiBET00gaXMgcmVhZHkgaW4gY2FzZSBkQXBwIGxvYWRzIGxhdGVyXG4gIGlmIChkb2N1bWVudC5yZWFkeVN0YXRlID09PSAnbG9hZGluZycpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdET01Db250ZW50TG9hZGVkJywgKCkgPT4ge1xuICAgICAgY29uc29sZS5sb2coVEFHLCAnRE9NIGxvYWRlZCwgcmUtYW5ub3VuY2luZyBwcm92aWRlciBmb3IgbGF0ZS1sb2FkaW5nIGRBcHBzJyk7XG4gICAgICAvLyBSZS1hbm5vdW5jZSB3aGVuIERPTSBpcyByZWFkeVxuICAgICAgaWYgKGtXaW5kb3cuZXRoZXJldW0gJiYgdHlwZW9mIGtXaW5kb3cuZGlzcGF0Y2hFdmVudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCBldGhlcmV1bSA9IGtXaW5kb3cuZXRoZXJldW0gYXMgV2FsbGV0UHJvdmlkZXI7XG4gICAgICAgIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgY29uc29sZS5sb2coVEFHLCAnSW5qZWN0aW9uIHNjcmlwdCBsb2FkZWQgYW5kIGluaXRpYWxpemVkJyk7XG59KSgpO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBV0EsR0FBQyxXQUFZO0FBQ1gsVUFBTSxNQUFNO0FBQ1osVUFBTSxVQUFVO0FBQ2hCLFVBQU0sa0JBQWtCO0FBQ3hCLFVBQU0sY0FBYztBQUNwQixVQUFNLG1CQUFtQjtBQUN6QixVQUFN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
