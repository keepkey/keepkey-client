'use strict';
(() => {
  (function () {
    let c = ' | KeepKeyInjected | ',
      g = '2.0.0',
      u = window,
      A = { isInjected: !1, version: g, injectedAt: Date.now(), retryCount: 0 };
    if (u.keepkeyInjectionState) {
      let o = u.keepkeyInjectionState;
      if ((console.warn(c, `Existing injection detected v${o.version}, current v${g}`), o.version >= g)) {
        console.log(c, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(c, 'Upgrading injection to newer version');
    }
    ((u.keepkeyInjectionState = A), console.log(c, `Initializing KeepKey Injection v${g}`));
    let m = {
        siteUrl: window.location.href,
        scriptSource: 'KeepKey Extension',
        version: g,
        injectedTime: new Date().toISOString(),
        origin: window.location.origin,
        protocol: window.location.protocol,
      },
      y = 0,
      h = new Map(),
      J = [],
      f = !1;
    setInterval(() => {
      let o = Date.now();
      h.forEach((n, t) => {
        o - n.timestamp > 3e4 &&
          (console.warn(c, `Callback timeout for request ${t} (${n.method})`),
          n.callback(new Error('Request timeout')),
          h.delete(t));
      });
    }, 5e3);
    let p = o => {
        (J.length >= 100 && (console.warn(c, 'Message queue full, removing oldest message'), J.shift()), J.push(o));
      },
      Q = () => {
        if (f)
          for (; J.length > 0; ) {
            let o = J.shift();
            o && window.postMessage(o, window.location.origin);
          }
      },
      C = (o = 0) =>
        new Promise(n => {
          let t = ++y,
            e = setTimeout(() => {
              o < 3
                ? (console.log(c, `Verification attempt ${o + 1} failed, retrying...`),
                  setTimeout(
                    () => {
                      C(o + 1).then(n);
                    },
                    100 * Math.pow(2, o),
                  ))
                : (console.error(c, 'Failed to verify injection after max retries'),
                  (A.lastError = 'Failed to verify injection'),
                  n(!1));
            }, 1e3),
            s = i => {
              var a, l, d;
              i.source === window &&
                ((a = i.data) == null ? void 0 : a.source) === 'keepkey-content' &&
                ((l = i.data) == null ? void 0 : l.type) === 'INJECTION_CONFIRMED' &&
                ((d = i.data) == null ? void 0 : d.requestId) === t &&
                (clearTimeout(e),
                window.removeEventListener('message', s),
                (f = !0),
                (A.isInjected = !0),
                console.log(c, 'Injection verified successfully'),
                Q(),
                n(!0));
            };
          (window.addEventListener('message', s),
            window.postMessage(
              { source: 'keepkey-injected', type: 'INJECTION_VERIFY', requestId: t, version: g, timestamp: Date.now() },
              window.location.origin,
            ));
        });
    function E(o, n = [], t, e) {
      let s = c + ' | walletRequest | ';
      if (!o || typeof o != 'string') {
        (console.error(s, 'Invalid method:', o), e(new Error('Invalid method')));
        return;
      }
      Array.isArray(n) || (console.warn(s, 'Params not an array, wrapping:', n), (n = [n]));
      try {
        let i = ++y,
          a = {
            id: i,
            method: o,
            params: n,
            chain: t,
            siteUrl: m.siteUrl,
            scriptSource: m.scriptSource,
            version: m.version,
            requestTime: new Date().toISOString(),
            referrer: document.referrer,
            href: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
          };
        h.set(i, { callback: e, timestamp: Date.now(), method: o });
        let l = {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId: i,
          requestInfo: a,
          timestamp: Date.now(),
        };
        f
          ? window.postMessage(l, window.location.origin)
          : (console.log(s, 'Content script not ready, queueing request'), p(l));
      } catch (i) {
        (console.error(s, 'Error in walletRequest:', i), e(i));
      }
    }
    window.addEventListener('message', o => {
      let n = c + ' | message | ';
      if (o.source !== window) return;
      let t = o.data;
      if (!(!t || typeof t != 'object')) {
        if (t.source === 'keepkey-content' && t.type === 'INJECTION_CONFIRMED') {
          ((f = !0), Q());
          return;
        }
        if (t.source === 'keepkey-content' && t.type === 'WALLET_RESPONSE' && t.requestId) {
          let e = h.get(t.requestId);
          e
            ? (t.error ? e.callback(t.error) : e.callback(null, t.result), h.delete(t.requestId))
            : console.warn(n, 'No callback found for requestId:', t.requestId);
        }
      }
    });
    class M {
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
              console.error(c, `Error in event handler for ${n}:`, i);
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
      console.log(c, 'Creating wallet object for chain:', o);
      let n = new M(),
        t = {
          network: 'mainnet',
          isKeepKey: !0,
          isMetaMask: !0,
          isConnected: () => f,
          request: ({ method: e, params: s = [] }) =>
            new Promise((i, a) => {
              E(e, s, o, (l, d) => {
                l ? a(l) : i(d);
              });
            }),
          send: (e, s, i) => {
            if ((e.chain || (e.chain = o), typeof i == 'function'))
              E(e.method, e.params || s, o, (a, l) => {
                a ? i(a) : i(null, { id: e.id, jsonrpc: '2.0', result: l });
              });
            else
              return (
                console.warn(c, 'Synchronous send is deprecated and may not work properly'),
                { id: e.id, jsonrpc: '2.0', result: null }
              );
          },
          sendAsync: (e, s, i) => {
            e.chain || (e.chain = o);
            let a = i || s;
            if (typeof a != 'function') {
              console.error(c, 'sendAsync requires a callback function');
              return;
            }
            E(e.method, e.params || s, o, (l, d) => {
              l ? a(l) : a(null, { id: e.id, jsonrpc: '2.0', result: d });
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
    function w(o) {
      let n = {
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          name: 'KeepKey',
          icon: 'data:image/png;base64,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',
          rdns: 'com.keepkey.client',
        },
        t = new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: n, provider: o }) });
      (console.log(c, 'Announcing EIP-6963 provider'), window.dispatchEvent(t));
    }
    async function I() {
      let o = c + ' | mountWallet | ';
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
        s = (i, a) => {
          u[i] && console.warn(o, `${i} already exists, checking if override is allowed`);
          try {
            (Object.defineProperty(u, i, { value: a, writable: !1, configurable: !0 }),
              console.log(o, `Successfully mounted window.${i}`));
          } catch (l) {
            (console.error(o, `Failed to mount window.${i}:`, l), (A.lastError = `Failed to mount ${i}`));
          }
        };
      (s('ethereum', n),
        s('xfi', t),
        s('keepkey', e),
        window.addEventListener('eip6963:requestProvider', () => {
          (console.log(o, 'Re-announcing provider on request'), w(n));
        }),
        w(n),
        setTimeout(() => {
          (console.log(o, 'Delayed EIP-6963 announcement for late-loading dApps'), w(n));
        }, 100),
        window.addEventListener('message', i => {
          var a, l, d;
          (((a = i.data) == null ? void 0 : a.type) === 'CHAIN_CHANGED' &&
            (console.log(o, 'Chain changed:', i.data),
            n.emit('chainChanged', (l = i.data.provider) == null ? void 0 : l.chainId)),
            ((d = i.data) == null ? void 0 : d.type) === 'ACCOUNTS_CHANGED' &&
              (console.log(o, 'Accounts changed:', i.data),
              n._handleAccountsChanged && n._handleAccountsChanged(i.data.accounts || [])));
        }),
        C().then(i => {
          i
            ? console.log(o, 'Injection verified successfully')
            : (console.error(o, 'Failed to verify injection, wallet features may not work'),
              (A.lastError = 'Injection not verified'));
        }),
        console.log(o, 'Wallet mount complete'));
    }
    (I(),
      document.readyState === 'loading' &&
        document.addEventListener('DOMContentLoaded', () => {
          if (
            (console.log(c, 'DOM loaded, re-announcing provider for late-loading dApps'),
            u.ethereum && typeof u.dispatchEvent == 'function')
          ) {
            let o = u.ethereum;
            w(o);
          }
        }),
      console.log(c, 'Injection script loaded and initialized'));
  })();
})();
