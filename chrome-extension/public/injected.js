'use strict';
(() => {
  var O = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function K(i) {
    let a = [0];
    for (let c of i) {
      let u = O.indexOf(c);
      if (u === -1) throw new Error('Invalid base58 character');
      let g = u;
      for (let h = 0; h < a.length; h++) ((g += a[h] * 58), (a[h] = g & 255), (g >>= 8));
      for (; g > 0; ) (a.push(g & 255), (g >>= 8));
    }
    for (let c of i) {
      if (c !== '1') break;
      a.push(0);
    }
    return new Uint8Array(a.reverse());
  }
  var I = class {
    #o;
    #e = [];
    #t = new Set();
    version = '1.0.0';
    name = 'KeepKey';
    icon =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==';
    chains = ['solana:mainnet'];
    get accounts() {
      return this.#e;
    }
    features = {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          let a = await this.#n('solana_connect', []);
          if (a) {
            let c = K(a);
            ((this.#e = [
              {
                address: a,
                publicKey: c,
                chains: ['solana:mainnet'],
                features: ['solana:signTransaction', 'solana:signMessage'],
              },
            ]),
              this.#s());
          }
          return { accounts: this.#e };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          (await this.#n('solana_disconnect', []).catch(() => {}), (this.#e = []), this.#s());
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (a, c) => (
          a === 'change' && this.#t.add(c),
          () => {
            this.#t.delete(c);
          }
        ),
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...a) => {
          let c = [];
          for (let { message: u } of a) {
            let g = await this.#n('solana_signMessage', [Array.from(u)]);
            c.push({ signedMessage: u, signature: new Uint8Array(g) });
          }
          return c;
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...a) => {
          let c = [];
          for (let { transaction: u } of a) {
            let g = await this.#n('solana_signTransaction', [Array.from(u)]);
            c.push({ signedTransaction: new Uint8Array(g) });
          }
          return c;
        },
      },
    };
    constructor(a) {
      this.#o = a;
    }
    #s() {
      let a = this.#e;
      this.#t.forEach(c => {
        try {
          c({ accounts: a });
        } catch {}
      });
    }
    #n(a, c) {
      return new Promise((u, g) => {
        this.#o(a, c, 'solana', (h, f) => {
          h ? g(h) : u(f);
        });
      });
    }
  };
  function W(i) {
    var c, u;
    let a = ({ register: g }) => {
      g(i);
    };
    try {
      (u = (c = window.navigator.wallets) == null ? void 0 : c.register) == null || u.call(c, i);
    } catch {}
    (window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: a })),
      window.addEventListener('wallet-standard:app-ready', g => {
        var f;
        let h = g;
        try {
          (f = h.detail) == null || f.call(h, { register: w => (w == null ? void 0 : w(i)) });
        } catch {}
      }));
  }
  (function () {
    let i = ' | KeepKeyInjected | ',
      a = '2.1.0',
      f = window,
      w = { isInjected: !1, version: a, injectedAt: Date.now(), retryCount: 0 };
    if (f.keepkeyInjectionState) {
      let o = f.keepkeyInjectionState;
      if ((console.warn(i, `Existing injection detected v${o.version}, current v${a}`), o.version >= a)) {
        console.log(i, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(i, 'Upgrading injection to newer version');
    }
    ((f.keepkeyInjectionState = w), console.log(i, `Initializing KeepKey Injection v${a}`));
    let k = {
        siteUrl: window.location.href,
        scriptSource: 'KeepKey Extension',
        version: a,
        injectedTime: new Date().toISOString(),
        origin: window.location.origin,
        protocol: window.location.protocol,
      },
      b = 0,
      y = new Map(),
      p = [],
      E = !1;
    setInterval(() => {
      let o = Date.now();
      y.forEach((n, t) => {
        o - n.timestamp > 3e5 &&
          (console.warn(i, `Callback timeout for request ${t} (${n.method})`),
          n.callback(new Error('Request timeout')),
          y.delete(t));
      });
    }, 5e3);
    let M = o => {
        (p.length >= 100 && (console.warn(i, 'Message queue full, removing oldest message'), p.shift()), p.push(o));
      },
      R = () => {
        if (E)
          for (; p.length > 0; ) {
            let o = p.shift();
            o && window.postMessage(o, window.location.origin);
          }
      },
      T = (o = 0) =>
        new Promise(n => {
          let t = ++b,
            e = setTimeout(() => {
              o < 3
                ? (console.log(i, `Verification attempt ${o + 1} failed, retrying...`),
                  setTimeout(
                    () => {
                      T(o + 1).then(n);
                    },
                    100 * Math.pow(2, o),
                  ))
                : (console.error(i, 'Failed to verify injection after max retries'),
                  (w.lastError = 'Failed to verify injection'),
                  n(!1));
            }, 1e3),
            r = s => {
              var A, d, m;
              s.source === window &&
                ((A = s.data) == null ? void 0 : A.source) === 'keepkey-content' &&
                ((d = s.data) == null ? void 0 : d.type) === 'INJECTION_CONFIRMED' &&
                ((m = s.data) == null ? void 0 : m.requestId) === t &&
                (clearTimeout(e),
                window.removeEventListener('message', r),
                (E = !0),
                (w.isInjected = !0),
                console.log(i, 'Injection verified successfully'),
                R(),
                n(!0));
            };
          (window.addEventListener('message', r),
            window.postMessage(
              { source: 'keepkey-injected', type: 'INJECTION_VERIFY', requestId: t, version: a, timestamp: Date.now() },
              window.location.origin,
            ));
        });
    function v(o, n = [], t, e) {
      let r = i + ' | walletRequest | ';
      if (!o || typeof o != 'string') {
        (console.error(r, 'Invalid method:', o), e(new Error('Invalid method')));
        return;
      }
      Array.isArray(n) || (console.warn(r, 'Params not an array, wrapping:', n), (n = [n]));
      try {
        let s = ++b,
          A = {
            id: s,
            method: o,
            params: n,
            chain: t,
            siteUrl: k.siteUrl,
            scriptSource: k.scriptSource,
            version: k.version,
            requestTime: new Date().toISOString(),
            referrer: document.referrer,
            href: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
          };
        y.set(s, { callback: e, timestamp: Date.now(), method: o });
        let d = {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId: s,
          requestInfo: A,
          timestamp: Date.now(),
        };
        E
          ? window.postMessage(d, window.location.origin)
          : (console.log(r, 'Content script not ready, queueing request'), M(d));
      } catch (s) {
        (console.error(r, 'Error in walletRequest:', s), e(s));
      }
    }
    window.addEventListener('message', o => {
      let n = i + ' | message | ';
      if (o.source !== window) return;
      let t = o.data;
      if (!(!t || typeof t != 'object')) {
        if (t.source === 'keepkey-content' && t.type === 'INJECTION_CONFIRMED') {
          ((E = !0), R());
          return;
        }
        if (t.source === 'keepkey-content' && t.type === 'WALLET_RESPONSE' && t.requestId) {
          let e = y.get(t.requestId);
          e
            ? (t.error ? e.callback(t.error) : e.callback(null, t.result), y.delete(t.requestId))
            : console.warn(n, 'No callback found for requestId:', t.requestId);
        }
      }
    });
    class j {
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
          e.forEach(r => {
            try {
              r(...t);
            } catch (s) {
              console.error(i, `Error in event handler for ${n}:`, s);
            }
          });
      }
      once(n, t) {
        let e = (...r) => {
          (t(...r), this.off(n, e));
        };
        this.on(n, e);
      }
    }
    function l(o) {
      console.log(i, 'Creating wallet object for chain:', o);
      let n = new j(),
        t = {
          network: 'mainnet',
          isKeepKey: !0,
          isMetaMask: !0,
          isConnected: () => E,
          request: ({ method: e, params: r = [] }) =>
            new Promise((s, A) => {
              v(e, r, o, (d, m) => {
                d ? A(d) : s(m);
              });
            }),
          send: (e, r, s) => {
            if ((e.chain || (e.chain = o), typeof s == 'function')) {
              v(e.method, e.params || r, o, (A, d) => {
                A ? s(A) : s(null, { id: e.id, jsonrpc: '2.0', result: d });
              });
              return;
            } else
              return (
                console.warn(i, 'Synchronous send is deprecated and may not work properly'),
                { id: e.id, jsonrpc: '2.0', result: null }
              );
          },
          sendAsync: (e, r, s) => {
            e.chain || (e.chain = o);
            let A = s || r;
            if (typeof A != 'function') {
              console.error(i, 'sendAsync requires a callback function');
              return;
            }
            v(e.method, e.params || r, o, (d, m) => {
              d ? A(d) : A(null, { id: e.id, jsonrpc: '2.0', result: m });
            });
          },
          on: (e, r) => (n.on(e, r), t),
          off: (e, r) => (n.off(e, r), t),
          removeListener: (e, r) => (n.removeListener(e, r), t),
          removeAllListeners: e => (n.removeAllListeners(e), t),
          emit: (e, ...r) => (n.emit(e, ...r), t),
          once: (e, r) => (n.once(e, r), t),
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
    function C(o) {
      let n = {
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          name: 'KeepKey',
          icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==',
          rdns: 'com.keepkey.client',
        },
        t = new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: n, provider: o }) });
      (console.log(i, 'Announcing EIP-6963 provider'), window.dispatchEvent(t));
    }
    async function B() {
      let o = i + ' | mountWallet | ';
      console.log(o, 'Starting wallet mount process');
      let n = l('ethereum'),
        t = {
          binance: l('binance'),
          bitcoin: l('bitcoin'),
          bitcoincash: l('bitcoincash'),
          dogecoin: l('dogecoin'),
          dash: l('dash'),
          ethereum: n,
          keplr: l('keplr'),
          litecoin: l('litecoin'),
          thorchain: l('thorchain'),
          mayachain: l('mayachain'),
        },
        e = {
          binance: l('binance'),
          bitcoin: l('bitcoin'),
          bitcoincash: l('bitcoincash'),
          dogecoin: l('dogecoin'),
          dash: l('dash'),
          ethereum: n,
          osmosis: l('osmosis'),
          cosmos: l('cosmos'),
          litecoin: l('litecoin'),
          thorchain: l('thorchain'),
          mayachain: l('mayachain'),
          ripple: l('ripple'),
        },
        r = (s, A) => {
          f[s] && console.warn(o, `${s} already exists, checking if override is allowed`);
          try {
            (Object.defineProperty(f, s, { value: A, writable: !1, configurable: !0 }),
              console.log(o, `Successfully mounted window.${s}`));
          } catch (d) {
            (console.error(o, `Failed to mount window.${s}:`, d), (w.lastError = `Failed to mount ${s}`));
          }
        };
      (r('ethereum', n),
        r('xfi', t),
        r('keepkey', e),
        window.addEventListener('eip6963:requestProvider', () => {
          (console.log(o, 'Re-announcing provider on request'), C(n));
        }),
        C(n),
        setTimeout(() => {
          (console.log(o, 'Delayed EIP-6963 announcement for late-loading dApps'), C(n));
        }, 100));
      try {
        let s = new I(v);
        (W(s), console.log(o, 'Solana wallet registered via Wallet Standard'));
      } catch (s) {
        console.error(o, 'Failed to register Solana wallet:', s);
      }
      (window.addEventListener('message', s => {
        var A, d, m;
        (((A = s.data) == null ? void 0 : A.type) === 'CHAIN_CHANGED' &&
          (console.log(o, 'Chain changed:', s.data),
          n.emit('chainChanged', (d = s.data.provider) == null ? void 0 : d.chainId)),
          ((m = s.data) == null ? void 0 : m.type) === 'ACCOUNTS_CHANGED' &&
            (console.log(o, 'Accounts changed:', s.data),
            n._handleAccountsChanged && n._handleAccountsChanged(s.data.accounts || [])));
      }),
        T().then(s => {
          s
            ? console.log(o, 'Injection verified successfully')
            : (console.error(o, 'Failed to verify injection, wallet features may not work'),
              (w.lastError = 'Injection not verified'));
        }),
        console.log(o, 'Wallet mount complete'));
    }
    (B(),
      document.readyState === 'loading' &&
        document.addEventListener('DOMContentLoaded', () => {
          if (
            (console.log(i, 'DOM loaded, re-announcing provider for late-loading dApps'),
            f.ethereum && typeof f.dispatchEvent == 'function')
          ) {
            let o = f.ethereum;
            C(o);
          }
        }),
      console.log(i, 'Injection script loaded and initialized'));
  })();
})();
