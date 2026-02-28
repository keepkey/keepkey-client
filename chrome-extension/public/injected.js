'use strict';
(() => {
  var B = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function S(c) {
    let o = [0];
    for (let r of c) {
      let l = B.indexOf(r);
      if (l === -1) throw new Error('Invalid base58 character');
      let u = l;
      for (let y = 0; y < o.length; y++) ((u += o[y] * 58), (o[y] = u & 255), (u >>= 8));
      for (; u > 0; ) (o.push(u & 255), (u >>= 8));
    }
    for (let r of c) {
      if (r !== '1') break;
      o.push(0);
    }
    return new Uint8Array(o.reverse());
  }
  var I = class c {
    #o;
    #e = [];
    #t = null;
    #s = new Set();
    version = '1.0.0';
    name = 'KeepKey';
    icon =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==';
    chains = ['solana:mainnet'];
    static ACCOUNT_FEATURES = ['solana:signTransaction', 'solana:signAndSendTransaction', 'solana:signMessage'];
    get accounts() {
      return this.#e;
    }
    features = {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          if (this.#e.length > 0) return { accounts: this.#e };
          let o = this.#t || (await this.#n('solana_connect', []));
          return (o && this.#i(o), { accounts: this.#e });
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          (await this.#n('solana_disconnect', []).catch(() => {}), (this.#e = []));
          try {
            localStorage.removeItem('keepkey-solana');
          } catch {}
          this.#a();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (o, r) => (
          o === 'change' && this.#s.add(r),
          () => {
            this.#s.delete(r);
          }
        ),
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...o) => {
          let r = [];
          for (let { message: l } of o) {
            let u = await this.#n('solana_signMessage', [Array.from(l)]);
            r.push({ signedMessage: l, signature: new Uint8Array(u) });
          }
          return r;
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: new Set(['legacy', 0]),
        signTransaction: async (...o) => {
          let r = [];
          for (let { transaction: l } of o) {
            let u = await this.#n('solana_signTransaction', [Array.from(l)]);
            r.push({ signedTransaction: new Uint8Array(u) });
          }
          return r;
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: new Set(['legacy', 0]),
        signAndSendTransaction: async (...o) => {
          let r = [];
          for (let { transaction: l } of o) {
            let u = await this.#n('solana_signAndSendTransaction', [Array.from(l)]);
            r.push({ signature: S(u) });
          }
          return r;
        },
      },
    };
    constructor(o) {
      this.#o = o;
      try {
        let r = localStorage.getItem('keepkey-solana');
        if (r) {
          let { address: l } = JSON.parse(r);
          l && typeof l == 'string' && (this.#t = l);
        }
      } catch {}
      this.#c();
    }
    #r(o) {
      return { address: o, publicKey: S(o), chains: ['solana:mainnet'], features: [...c.ACCOUNT_FEATURES] };
    }
    #i(o) {
      this.#e = [this.#r(o)];
      try {
        localStorage.setItem('keepkey-solana', JSON.stringify({ address: o }));
      } catch {}
      this.#a();
    }
    async #c() {
      try {
        let o = await this.#n('solana_connect', []);
        if (o && typeof o == 'string') {
          this.#t = o;
          try {
            localStorage.setItem('keepkey-solana', JSON.stringify({ address: o }));
          } catch {}
        }
      } catch {}
    }
    #a() {
      let o = this.#e,
        r = this.features;
      this.#s.forEach(l => {
        try {
          l({ accounts: o, features: r });
        } catch {}
      });
    }
    #n(o, r) {
      return new Promise((l, u) => {
        this.#o(o, r, 'solana', (y, f) => {
          y ? u(y) : l(f);
        });
      });
    }
  };
  function W(c) {
    let o = ({ register: r }) => {
      r(c);
    };
    try {
      let r = window.navigator;
      (r.wallets || (r.wallets = []),
        Array.isArray(r.wallets)
          ? r.wallets.push(o)
          : typeof r.wallets.register == 'function' && r.wallets.register(c));
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: o }));
    } catch {}
    window.addEventListener('wallet-standard:app-ready', r => {
      let l = r;
      try {
        typeof l.detail == 'function' && l.detail(o);
      } catch {}
    });
  }
  (function () {
    let c = ' | KeepKeyInjected | ',
      o = '2.1.0',
      f = window,
      w = { isInjected: !1, version: o, injectedAt: Date.now(), retryCount: 0 };
    if (f.keepkeyInjectionState) {
      let s = f.keepkeyInjectionState;
      if ((console.warn(c, `Existing injection detected v${s.version}, current v${o}`), s.version >= o)) {
        console.log(c, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(c, 'Upgrading injection to newer version');
    }
    ((f.keepkeyInjectionState = w), console.log(c, `Initializing KeepKey Injection v${o}`));
    let k = {
        siteUrl: window.location.href,
        scriptSource: 'KeepKey Extension',
        version: o,
        injectedTime: new Date().toISOString(),
        origin: window.location.origin,
        protocol: window.location.protocol,
      },
      b = 0,
      p = new Map(),
      m = [],
      E = !1;
    setInterval(() => {
      let s = Date.now();
      p.forEach((n, t) => {
        s - n.timestamp > 3e5 &&
          (console.warn(c, `Callback timeout for request ${t} (${n.method})`),
          n.callback(new Error('Request timeout')),
          p.delete(t));
      });
    }, 5e3);
    let O = s => {
        (m.length >= 100 && (console.warn(c, 'Message queue full, removing oldest message'), m.shift()), m.push(s));
      },
      T = () => {
        if (E)
          for (; m.length > 0; ) {
            let s = m.shift();
            s && window.postMessage(s, window.location.origin);
          }
      },
      R = (s = 0) =>
        new Promise(n => {
          let t = ++b,
            e = setTimeout(() => {
              s < 3
                ? (console.log(c, `Verification attempt ${s + 1} failed, retrying...`),
                  setTimeout(
                    () => {
                      R(s + 1).then(n);
                    },
                    100 * Math.pow(2, s),
                  ))
                : (console.error(c, 'Failed to verify injection after max retries'),
                  (w.lastError = 'Failed to verify injection'),
                  n(!1));
            }, 1e3),
            i = a => {
              var d, g, h;
              a.source === window &&
                ((d = a.data) == null ? void 0 : d.source) === 'keepkey-content' &&
                ((g = a.data) == null ? void 0 : g.type) === 'INJECTION_CONFIRMED' &&
                ((h = a.data) == null ? void 0 : h.requestId) === t &&
                (clearTimeout(e),
                window.removeEventListener('message', i),
                (E = !0),
                (w.isInjected = !0),
                console.log(c, 'Injection verified successfully'),
                T(),
                n(!0));
            };
          (window.addEventListener('message', i),
            window.postMessage(
              { source: 'keepkey-injected', type: 'INJECTION_VERIFY', requestId: t, version: o, timestamp: Date.now() },
              window.location.origin,
            ));
        });
    function v(s, n = [], t, e) {
      let i = c + ' | walletRequest | ';
      if (!s || typeof s != 'string') {
        (console.error(i, 'Invalid method:', s), e(new Error('Invalid method')));
        return;
      }
      Array.isArray(n) || (console.warn(i, 'Params not an array, wrapping:', n), (n = [n]));
      try {
        let a = ++b,
          d = {
            id: a,
            method: s,
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
        p.set(a, { callback: e, timestamp: Date.now(), method: s });
        let g = {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId: a,
          requestInfo: d,
          timestamp: Date.now(),
        };
        E
          ? window.postMessage(g, window.location.origin)
          : (console.log(i, 'Content script not ready, queueing request'), O(g));
      } catch (a) {
        (console.error(i, 'Error in walletRequest:', a), e(a));
      }
    }
    window.addEventListener('message', s => {
      let n = c + ' | message | ';
      if (s.source !== window) return;
      let t = s.data;
      if (!(!t || typeof t != 'object')) {
        if (t.source === 'keepkey-content' && t.type === 'INJECTION_CONFIRMED') {
          ((E = !0), T());
          return;
        }
        if (t.source === 'keepkey-content' && t.type === 'WALLET_RESPONSE' && t.requestId) {
          let e = p.get(t.requestId);
          e
            ? (t.error ? e.callback(t.error) : e.callback(null, t.result), p.delete(t.requestId))
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
          e.forEach(i => {
            try {
              i(...t);
            } catch (a) {
              console.error(c, `Error in event handler for ${n}:`, a);
            }
          });
      }
      once(n, t) {
        let e = (...i) => {
          (t(...i), this.off(n, e));
        };
        this.on(n, e);
      }
    }
    function A(s) {
      console.log(c, 'Creating wallet object for chain:', s);
      let n = new M(),
        t = {
          network: 'mainnet',
          isKeepKey: !0,
          isMetaMask: !0,
          isConnected: () => E,
          request: ({ method: e, params: i = [] }) =>
            new Promise((a, d) => {
              v(e, i, s, (g, h) => {
                g ? d(g) : a(h);
              });
            }),
          send: (e, i, a) => {
            if ((e.chain || (e.chain = s), typeof a == 'function')) {
              v(e.method, e.params || i, s, (d, g) => {
                d ? a(d) : a(null, { id: e.id, jsonrpc: '2.0', result: g });
              });
              return;
            } else
              return (
                console.warn(c, 'Synchronous send is deprecated and may not work properly'),
                { id: e.id, jsonrpc: '2.0', result: null }
              );
          },
          sendAsync: (e, i, a) => {
            e.chain || (e.chain = s);
            let d = a || i;
            if (typeof d != 'function') {
              console.error(c, 'sendAsync requires a callback function');
              return;
            }
            v(e.method, e.params || i, s, (g, h) => {
              g ? d(g) : d(null, { id: e.id, jsonrpc: '2.0', result: h });
            });
          },
          on: (e, i) => (n.on(e, i), t),
          off: (e, i) => (n.off(e, i), t),
          removeListener: (e, i) => (n.removeListener(e, i), t),
          removeAllListeners: e => (n.removeAllListeners(e), t),
          emit: (e, ...i) => (n.emit(e, ...i), t),
          once: (e, i) => (n.once(e, i), t),
          enable: () => t.request({ method: 'eth_requestAccounts' }),
          _metamask: { isUnlocked: () => Promise.resolve(!0) },
        };
      return (
        s === 'ethereum' &&
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
    function C(s) {
      let n = {
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          name: 'KeepKey',
          icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==',
          rdns: 'com.keepkey.client',
        },
        t = new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: n, provider: s }) });
      (console.log(c, 'Announcing EIP-6963 provider'), window.dispatchEvent(t));
    }
    async function j() {
      let s = c + ' | mountWallet | ';
      console.log(s, 'Starting wallet mount process');
      let n = A('ethereum'),
        t = {
          binance: A('binance'),
          bitcoin: A('bitcoin'),
          bitcoincash: A('bitcoincash'),
          dogecoin: A('dogecoin'),
          dash: A('dash'),
          ethereum: n,
          keplr: A('keplr'),
          litecoin: A('litecoin'),
          thorchain: A('thorchain'),
          mayachain: A('mayachain'),
        },
        e = {
          binance: A('binance'),
          bitcoin: A('bitcoin'),
          bitcoincash: A('bitcoincash'),
          dogecoin: A('dogecoin'),
          dash: A('dash'),
          ethereum: n,
          osmosis: A('osmosis'),
          cosmos: A('cosmos'),
          litecoin: A('litecoin'),
          thorchain: A('thorchain'),
          mayachain: A('mayachain'),
          ripple: A('ripple'),
        },
        i = (a, d) => {
          f[a] && console.warn(s, `${a} already exists, checking if override is allowed`);
          try {
            (Object.defineProperty(f, a, { value: d, writable: !1, configurable: !0 }),
              console.log(s, `Successfully mounted window.${a}`));
          } catch (g) {
            (console.error(s, `Failed to mount window.${a}:`, g), (w.lastError = `Failed to mount ${a}`));
          }
        };
      (i('ethereum', n),
        i('xfi', t),
        i('keepkey', e),
        window.addEventListener('eip6963:requestProvider', () => {
          (console.log(s, 'Re-announcing provider on request'), C(n));
        }),
        C(n),
        setTimeout(() => {
          (console.log(s, 'Delayed EIP-6963 announcement for late-loading dApps'), C(n));
        }, 100));
      try {
        let a = new I(v);
        (W(a), console.log(s, 'Solana wallet registered via Wallet Standard'));
      } catch (a) {
        console.error(s, 'Failed to register Solana wallet:', a);
      }
      (window.addEventListener('message', a => {
        var d, g, h;
        (((d = a.data) == null ? void 0 : d.type) === 'CHAIN_CHANGED' &&
          (console.log(s, 'Chain changed:', a.data),
          n.emit('chainChanged', (g = a.data.provider) == null ? void 0 : g.chainId)),
          ((h = a.data) == null ? void 0 : h.type) === 'ACCOUNTS_CHANGED' &&
            (console.log(s, 'Accounts changed:', a.data),
            n._handleAccountsChanged && n._handleAccountsChanged(a.data.accounts || [])));
      }),
        R().then(a => {
          a
            ? console.log(s, 'Injection verified successfully')
            : (console.error(s, 'Failed to verify injection, wallet features may not work'),
              (w.lastError = 'Injection not verified'));
        }),
        console.log(s, 'Wallet mount complete'));
    }
    (j(),
      document.readyState === 'loading' &&
        document.addEventListener('DOMContentLoaded', () => {
          if (
            (console.log(c, 'DOM loaded, re-announcing provider for late-loading dApps'),
            f.ethereum && typeof f.dispatchEvent == 'function')
          ) {
            let s = f.ethereum;
            C(s);
          }
        }),
      console.log(c, 'Injection script loaded and initialized'));
  })();
})();
