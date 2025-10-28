'use strict';
(() => {
  (function () {
    let a = ' | KeepKeyInjected | ',
      A = '2.0.0',
      u = window,
      g = { isInjected: !1, version: A, injectedAt: Date.now(), retryCount: 0 };
    if (u.keepkeyInjectionState) {
      let o = u.keepkeyInjectionState;
      if ((console.warn(a, `Existing injection detected v${o.version}, current v${A}`), o.version >= A)) {
        console.log(a, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(a, 'Upgrading injection to newer version');
    }
    ((u.keepkeyInjectionState = g), console.log(a, `Initializing KeepKey Injection v${A}`));
    let p = {
        siteUrl: window.location.href,
        scriptSource: 'KeepKey Extension',
        version: A,
        injectedTime: new Date().toISOString(),
        origin: window.location.origin,
        protocol: window.location.protocol,
      },
      v = 0,
      f = new Map(),
      w = [],
      m = !1;
    setInterval(() => {
      let o = Date.now();
      f.forEach((n, t) => {
        o - n.timestamp > 3e4 &&
          (console.warn(a, `Callback timeout for request ${t} (${n.method})`),
          n.callback(new Error('Request timeout')),
          f.delete(t));
      });
    }, 5e3);
    let C = o => {
        (w.length >= 100 && (console.warn(a, 'Message queue full, removing oldest message'), w.shift()), w.push(o));
      },
      y = () => {
        if (m)
          for (; w.length > 0; ) {
            let o = w.shift();
            o && window.postMessage(o, window.location.origin);
          }
      },
      I = (o = 0) =>
        new Promise(n => {
          let t = ++v,
            e = setTimeout(() => {
              o < 3
                ? (console.log(a, `Verification attempt ${o + 1} failed, retrying...`),
                  setTimeout(
                    () => {
                      I(o + 1).then(n);
                    },
                    100 * Math.pow(2, o),
                  ))
                : (console.error(a, 'Failed to verify injection after max retries'),
                  (g.lastError = 'Failed to verify injection'),
                  n(!1));
            }, 1e3),
            s = i => {
              var c, l, d;
              i.source === window &&
                ((c = i.data) == null ? void 0 : c.source) === 'keepkey-content' &&
                ((l = i.data) == null ? void 0 : l.type) === 'INJECTION_CONFIRMED' &&
                ((d = i.data) == null ? void 0 : d.requestId) === t &&
                (clearTimeout(e),
                window.removeEventListener('message', s),
                (m = !0),
                (g.isInjected = !0),
                console.log(a, 'Injection verified successfully'),
                y(),
                n(!0));
            };
          (window.addEventListener('message', s),
            window.postMessage(
              { source: 'keepkey-injected', type: 'INJECTION_VERIFY', requestId: t, version: A, timestamp: Date.now() },
              window.location.origin,
            ));
        });
    function E(o, n = [], t, e) {
      let s = a + ' | walletRequest | ';
      if (!o || typeof o != 'string') {
        (console.error(s, 'Invalid method:', o), e(new Error('Invalid method')));
        return;
      }
      Array.isArray(n) || (console.warn(s, 'Params not an array, wrapping:', n), (n = [n]));
      try {
        let i = ++v,
          c = {
            id: i,
            method: o,
            params: n,
            chain: t,
            siteUrl: p.siteUrl,
            scriptSource: p.scriptSource,
            version: p.version,
            requestTime: new Date().toISOString(),
            referrer: document.referrer,
            href: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
          };
        f.set(i, { callback: e, timestamp: Date.now(), method: o });
        let l = {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId: i,
          requestInfo: c,
          timestamp: Date.now(),
        };
        m
          ? window.postMessage(l, window.location.origin)
          : (console.log(s, 'Content script not ready, queueing request'), C(l));
      } catch (i) {
        (console.error(s, 'Error in walletRequest:', i), e(i));
      }
    }
    window.addEventListener('message', o => {
      let n = a + ' | message | ';
      if (o.source !== window) return;
      let t = o.data;
      if (!(!t || typeof t != 'object')) {
        if (t.source === 'keepkey-content' && t.type === 'INJECTION_CONFIRMED') {
          ((m = !0), y());
          return;
        }
        if (t.source === 'keepkey-content' && t.type === 'WALLET_RESPONSE' && t.requestId) {
          let e = f.get(t.requestId);
          e
            ? (t.error ? e.callback(t.error) : e.callback(null, t.result), f.delete(t.requestId))
            : console.warn(n, 'No callback found for requestId:', t.requestId);
        }
      }
    });
    class k {
      events = new Map();
      on(n, t) {
        (this.events.has(n) || this.events.set(n, new Set()), this.events.get(n).add(t));
      }
      off(n, t) {
        var e;
        (e = this.events.get(n)) == null || e.delete(t);
      }
      removeListener(n, t) {
        this.off(n, t);
      }
      removeAllListeners(n) {
        n ? this.events.delete(n) : this.events.clear();
      }
      emit(n, ...t) {
        var e;
        (e = this.events.get(n)) == null ||
          e.forEach(s => {
            try {
              s(...t);
            } catch (i) {
              console.error(a, `Error in event handler for ${n}:`, i);
            }
          });
      }
      once(n, t) {
        let e = (...s) => {
          (t(...s), this.off(n, e));
        };
        this.on(n, e);
      }
    }
    function r(o) {
      console.log(a, 'Creating wallet object for chain:', o);
      let n = new k(),
        t = {
          network: 'mainnet',
          isKeepKey: !0,
          isMetaMask: !0,
          isConnected: () => m,
          request: ({ method: e, params: s = [] }) =>
            new Promise((i, c) => {
              E(e, s, o, (l, d) => {
                l ? c(l) : i(d);
              });
            }),
          send: (e, s, i) => {
            if ((e.chain || (e.chain = o), typeof i == 'function'))
              E(e.method, e.params || s, o, (c, l) => {
                c ? i(c) : i(null, { id: e.id, jsonrpc: '2.0', result: l });
              });
            else
              return (
                console.warn(a, 'Synchronous send is deprecated and may not work properly'),
                { id: e.id, jsonrpc: '2.0', result: null }
              );
          },
          sendAsync: (e, s, i) => {
            e.chain || (e.chain = o);
            let c = i || s;
            if (typeof c != 'function') {
              console.error(a, 'sendAsync requires a callback function');
              return;
            }
            E(e.method, e.params || s, o, (l, d) => {
              l ? c(l) : c(null, { id: e.id, jsonrpc: '2.0', result: d });
            });
          },
          on: (e, s) => (n.on(e, s), t),
          off: (e, s) => (n.off(e, s), t),
          removeListener: (e, s) => (n.removeListener(e, s), t),
          removeAllListeners: e => (n.removeAllListeners(e), t),
          emit: (e, ...s) => (n.emit(e, ...s), t),
          once: (e, s) => (n.once(e, s), t),
          enable: () => t.request({ method: 'eth_requestAccounts' }),
          _metamask: { isUnlocked: () => Promise.resolve(!0) },
        };
      return (
        o === 'ethereum' &&
          ((t.chainId = '0x1'),
          (t.networkVersion = '1'),
          (t.selectedAddress = null),
          (t._handleAccountsChanged = e => {
            ((t.selectedAddress = e[0] || null), n.emit('accountsChanged', e));
          }),
          (t._handleChainChanged = e => {
            ((t.chainId = e), n.emit('chainChanged', e));
          }),
          (t._handleConnect = e => {
            n.emit('connect', e);
          }),
          (t._handleDisconnect = e => {
            ((t.selectedAddress = null), n.emit('disconnect', e));
          })),
        t
      );
    }
    function h(o) {
      let n = {
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          name: 'KeepKey',
          icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==',
          rdns: 'com.keepkey.client',
        },
        t = new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: n, provider: o }) });
      (console.log(a, 'Announcing EIP-6963 provider'), window.dispatchEvent(t));
    }
    async function b() {
      let o = a + ' | mountWallet | ';
      console.log(o, 'Starting wallet mount process');
      let n = r('ethereum'),
        t = {
          binance: r('binance'),
          bitcoin: r('bitcoin'),
          bitcoincash: r('bitcoincash'),
          dogecoin: r('dogecoin'),
          dash: r('dash'),
          ethereum: n,
          keplr: r('keplr'),
          litecoin: r('litecoin'),
          thorchain: r('thorchain'),
          mayachain: r('mayachain'),
        },
        e = {
          binance: r('binance'),
          bitcoin: r('bitcoin'),
          bitcoincash: r('bitcoincash'),
          dogecoin: r('dogecoin'),
          dash: r('dash'),
          ethereum: n,
          osmosis: r('osmosis'),
          cosmos: r('cosmos'),
          litecoin: r('litecoin'),
          thorchain: r('thorchain'),
          mayachain: r('mayachain'),
          ripple: r('ripple'),
        },
        s = (i, c) => {
          u[i] && console.warn(o, `${i} already exists, checking if override is allowed`);
          try {
            (Object.defineProperty(u, i, { value: c, writable: !1, configurable: !0 }),
              console.log(o, `Successfully mounted window.${i}`));
          } catch (l) {
            (console.error(o, `Failed to mount window.${i}:`, l), (g.lastError = `Failed to mount ${i}`));
          }
        };
      (s('ethereum', n),
        s('xfi', t),
        s('keepkey', e),
        window.addEventListener('eip6963:requestProvider', () => {
          (console.log(o, 'Re-announcing provider on request'), h(n));
        }),
        h(n),
        setTimeout(() => {
          (console.log(o, 'Delayed EIP-6963 announcement for late-loading dApps'), h(n));
        }, 100),
        window.addEventListener('message', i => {
          var c, l, d;
          (((c = i.data) == null ? void 0 : c.type) === 'CHAIN_CHANGED' &&
            (console.log(o, 'Chain changed:', i.data),
            n.emit('chainChanged', (l = i.data.provider) == null ? void 0 : l.chainId)),
            ((d = i.data) == null ? void 0 : d.type) === 'ACCOUNTS_CHANGED' &&
              (console.log(o, 'Accounts changed:', i.data),
              n._handleAccountsChanged && n._handleAccountsChanged(i.data.accounts || [])));
        }),
        I().then(i => {
          i
            ? console.log(o, 'Injection verified successfully')
            : (console.error(o, 'Failed to verify injection, wallet features may not work'),
              (g.lastError = 'Injection not verified'));
        }),
        console.log(o, 'Wallet mount complete'));
    }
    (b(),
      document.readyState === 'loading' &&
        document.addEventListener('DOMContentLoaded', () => {
          if (
            (console.log(a, 'DOM loaded, re-announcing provider for late-loading dApps'),
            u.ethereum && typeof u.dispatchEvent == 'function')
          ) {
            let o = u.ethereum;
            h(o);
          }
        }),
      console.log(a, 'Injection script loaded and initialized'));
  })();
})();
