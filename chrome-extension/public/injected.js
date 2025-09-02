'use strict';
(() => {
  (function () {
    let c = ' | KeepKeyInjected | ',
      u = '2.0.0',
      g = window,
      f = { isInjected: !1, version: u, injectedAt: Date.now(), retryCount: 0 };
    if (g.keepkeyInjectionState) {
      let o = g.keepkeyInjectionState;
      if ((console.warn(c, `Existing injection detected v${o.version}, current v${u}`), o.version >= u)) {
        console.log(c, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(c, 'Upgrading injection to newer version');
    }
    (g.keepkeyInjectionState = f), console.log(c, `Initializing KeepKey Injection v${u}`);
    let p = {
        siteUrl: window.location.href,
        scriptSource: 'KeepKey Extension',
        version: u,
        injectedTime: new Date().toISOString(),
        origin: window.location.origin,
        protocol: window.location.protocol,
      },
      v = 0,
      w = new Map(),
      m = [],
      h = !1;
    setInterval(() => {
      let o = Date.now();
      w.forEach((t, e) => {
        o - t.timestamp > 3e4 &&
          (console.warn(c, `Callback timeout for request ${e} (${t.method})`),
          t.callback(new Error('Request timeout')),
          w.delete(e));
      });
    }, 5e3);
    let b = o => {
        m.length >= 100 && (console.warn(c, 'Message queue full, removing oldest message'), m.shift()), m.push(o);
      },
      E = () => {
        if (h)
          for (; m.length > 0; ) {
            let o = m.shift();
            o && window.postMessage(o, window.location.origin);
          }
      },
      I = (o = 0) =>
        new Promise(t => {
          let e = ++v,
            n = setTimeout(() => {
              o < 3
                ? (console.log(c, `Verification attempt ${o + 1} failed, retrying...`),
                  setTimeout(
                    () => {
                      I(o + 1).then(t);
                    },
                    100 * Math.pow(2, o),
                  ))
                : (console.error(c, 'Failed to verify injection after max retries'),
                  (f.lastError = 'Failed to verify injection'),
                  t(!1));
            }, 1e3),
            i = r => {
              var s, l, d;
              r.source === window &&
                ((s = r.data) == null ? void 0 : s.source) === 'keepkey-content' &&
                ((l = r.data) == null ? void 0 : l.type) === 'INJECTION_CONFIRMED' &&
                ((d = r.data) == null ? void 0 : d.requestId) === e &&
                (clearTimeout(n),
                window.removeEventListener('message', i),
                (h = !0),
                (f.isInjected = !0),
                console.log(c, 'Injection verified successfully'),
                E(),
                t(!0));
            };
          window.addEventListener('message', i),
            window.postMessage(
              { source: 'keepkey-injected', type: 'INJECTION_VERIFY', requestId: e, version: u, timestamp: Date.now() },
              window.location.origin,
            );
        });
    function y(o, t = [], e, n) {
      let i = c + ' | walletRequest | ';
      if (!o || typeof o != 'string') {
        console.error(i, 'Invalid method:', o), n(new Error('Invalid method'));
        return;
      }
      Array.isArray(t) || (console.warn(i, 'Params not an array, wrapping:', t), (t = [t]));
      try {
        let r = ++v,
          s = {
            id: r,
            method: o,
            params: t,
            chain: e,
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
        w.set(r, { callback: n, timestamp: Date.now(), method: o });
        let l = {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId: r,
          requestInfo: s,
          timestamp: Date.now(),
        };
        h
          ? window.postMessage(l, window.location.origin)
          : (console.log(i, 'Content script not ready, queueing request'), b(l));
      } catch (r) {
        console.error(i, 'Error in walletRequest:', r), n(r);
      }
    }
    window.addEventListener('message', o => {
      let t = c + ' | message | ';
      if (o.source !== window) return;
      let e = o.data;
      if (!(!e || typeof e != 'object')) {
        if (e.source === 'keepkey-content' && e.type === 'INJECTION_CONFIRMED') {
          (h = !0), E();
          return;
        }
        if (e.source === 'keepkey-content' && e.type === 'WALLET_RESPONSE' && e.requestId) {
          let n = w.get(e.requestId);
          n
            ? (e.error ? n.callback(e.error) : n.callback(null, e.result), w.delete(e.requestId))
            : console.warn(t, 'No callback found for requestId:', e.requestId);
        }
      }
    });
    class j {
      events = new Map();
      on(t, e) {
        this.events.has(t) || this.events.set(t, new Set()), this.events.get(t).add(e);
      }
      off(t, e) {
        var n;
        (n = this.events.get(t)) == null || n.delete(e);
      }
      removeListener(t, e) {
        this.off(t, e);
      }
      removeAllListeners(t) {
        t ? this.events.delete(t) : this.events.clear();
      }
      emit(t, ...e) {
        var n;
        (n = this.events.get(t)) == null ||
          n.forEach(i => {
            try {
              i(...e);
            } catch (r) {
              console.error(c, `Error in event handler for ${t}:`, r);
            }
          });
      }
      once(t, e) {
        let n = (...i) => {
          e(...i), this.off(t, n);
        };
        this.on(t, n);
      }
    }
    function a(o) {
      console.log(c, 'Creating wallet object for chain:', o);
      let t = new j(),
        e = {
          network: 'mainnet',
          isKeepKey: !0,
          isMetaMask: !0,
          isConnected: () => h,
          request: ({ method: n, params: i = [] }) =>
            new Promise((r, s) => {
              y(n, i, o, (l, d) => {
                l ? s(l) : r(d);
              });
            }),
          send: (n, i, r) => {
            if ((n.chain || (n.chain = o), typeof r == 'function'))
              y(n.method, n.params || i, o, (s, l) => {
                s ? r(s) : r(null, { id: n.id, jsonrpc: '2.0', result: l });
              });
            else
              return (
                console.warn(c, 'Synchronous send is deprecated and may not work properly'),
                { id: n.id, jsonrpc: '2.0', result: null }
              );
          },
          sendAsync: (n, i, r) => {
            n.chain || (n.chain = o);
            let s = r || i;
            if (typeof s != 'function') {
              console.error(c, 'sendAsync requires a callback function');
              return;
            }
            y(n.method, n.params || i, o, (l, d) => {
              l ? s(l) : s(null, { id: n.id, jsonrpc: '2.0', result: d });
            });
          },
          on: (n, i) => (t.on(n, i), e),
          off: (n, i) => (t.off(n, i), e),
          removeListener: (n, i) => (t.removeListener(n, i), e),
          removeAllListeners: n => (t.removeAllListeners(n), e),
          emit: (n, ...i) => (t.emit(n, ...i), e),
          once: (n, i) => (t.once(n, i), e),
          enable: () => e.request({ method: 'eth_requestAccounts' }),
          _metamask: { isUnlocked: () => Promise.resolve(!0) },
        };
      return (
        o === 'ethereum' &&
          ((e.chainId = '0x1'),
          (e.networkVersion = '1'),
          (e.selectedAddress = null),
          (e._handleAccountsChanged = n => {
            (e.selectedAddress = n[0] || null), t.emit('accountsChanged', n);
          }),
          (e._handleChainChanged = n => {
            (e.chainId = n), t.emit('chainChanged', n);
          }),
          (e._handleConnect = n => {
            t.emit('connect', n);
          }),
          (e._handleDisconnect = n => {
            (e.selectedAddress = null), t.emit('disconnect', n);
          })),
        e
      );
    }
    function k(o) {
      let t = {
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          name: 'KeepKey Client',
          icon: 'https://pioneers.dev/coins/keepkey.png',
          rdns: 'com.keepkey',
        },
        e = new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: t, provider: o }) });
      console.log(c, 'Announcing EIP-6963 provider'), window.dispatchEvent(e);
    }
    async function C() {
      let o = c + ' | mountWallet | ';
      console.log(o, 'Starting wallet mount process'),
        (await I()) ||
          (console.error(o, 'Failed to verify injection, wallet features may not work'),
          (f.lastError = 'Injection not verified'));
      let e = a('ethereum'),
        n = {
          binance: a('binance'),
          bitcoin: a('bitcoin'),
          bitcoincash: a('bitcoincash'),
          dogecoin: a('dogecoin'),
          dash: a('dash'),
          ethereum: e,
          keplr: a('keplr'),
          litecoin: a('litecoin'),
          thorchain: a('thorchain'),
          mayachain: a('mayachain'),
        },
        i = {
          binance: a('binance'),
          bitcoin: a('bitcoin'),
          bitcoincash: a('bitcoincash'),
          dogecoin: a('dogecoin'),
          dash: a('dash'),
          ethereum: e,
          osmosis: a('osmosis'),
          cosmos: a('cosmos'),
          litecoin: a('litecoin'),
          thorchain: a('thorchain'),
          mayachain: a('mayachain'),
          ripple: a('ripple'),
        },
        r = (s, l) => {
          g[s] && console.warn(o, `${s} already exists, checking if override is allowed`);
          try {
            Object.defineProperty(g, s, { value: l, writable: !1, configurable: !0 }),
              console.log(o, `Successfully mounted window.${s}`);
          } catch (d) {
            console.error(o, `Failed to mount window.${s}:`, d), (f.lastError = `Failed to mount ${s}`);
          }
        };
      r('ethereum', e),
        r('xfi', n),
        r('keepkey', i),
        k(e),
        window.addEventListener('eip6963:requestProvider', () => {
          console.log(o, 'Re-announcing provider on request'), k(e);
        }),
        window.addEventListener('message', s => {
          var l, d, A;
          ((l = s.data) == null ? void 0 : l.type) === 'CHAIN_CHANGED' &&
            (console.log(o, 'Chain changed:', s.data),
            e.emit('chainChanged', (d = s.data.provider) == null ? void 0 : d.chainId)),
            ((A = s.data) == null ? void 0 : A.type) === 'ACCOUNTS_CHANGED' &&
              (console.log(o, 'Accounts changed:', s.data),
              e._handleAccountsChanged && e._handleAccountsChanged(s.data.accounts || []));
        }),
        console.log(o, 'Wallet mount complete');
    }
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', C) : C(),
      console.log(c, 'Injection script loaded and initialized');
  })();
})();
