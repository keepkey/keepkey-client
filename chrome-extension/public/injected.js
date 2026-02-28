'use strict';
(() => {
  var K = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function M(l) {
    let a = [0];
    for (let i of l) {
      let d = K.indexOf(i);
      if (d === -1) throw new Error('Invalid base58 character');
      let n = d;
      for (let h = 0; h < a.length; h++) ((n += a[h] * 58), (a[h] = n & 255), (n >>= 8));
      for (; n > 0; ) (a.push(n & 255), (n >>= 8));
    }
    for (let i of l) {
      if (i !== '1') break;
      a.push(0);
    }
    return new Uint8Array(a.reverse());
  }
  var U = class l {
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
          let a = this.#t || (await this.#n('solana_connect', []));
          return (a && this.#a(a), { accounts: this.#e });
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          (await this.#n('solana_disconnect', []).catch(() => {}), (this.#e = []));
          try {
            localStorage.removeItem('keepkey-solana');
          } catch {}
          this.#r();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (a, i) => (
          a === 'change' && this.#s.add(i),
          () => {
            this.#s.delete(i);
          }
        ),
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...a) => {
          let i = [];
          for (let { message: d } of a) {
            let n = await this.#n('solana_signMessage', [Array.from(d)]);
            i.push({ signedMessage: d, signature: new Uint8Array(n) });
          }
          return i;
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: new Set(['legacy', 0]),
        signTransaction: async (...a) => {
          let i = [];
          for (let { transaction: d } of a) {
            let n = await this.#n('solana_signTransaction', [Array.from(d)]);
            i.push({ signedTransaction: new Uint8Array(n) });
          }
          return i;
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: new Set(['legacy', 0]),
        signAndSendTransaction: async (...a) => {
          let i = [];
          for (let { transaction: d } of a) {
            let n = await this.#n('solana_signAndSendTransaction', [Array.from(d)]);
            i.push({ signature: M(n) });
          }
          return i;
        },
      },
      'solana:signIn': {
        version: '1.0.0',
        signIn: async (...a) => {
          var d;
          let i = [];
          for (let n of a) {
            if (this.#e.length === 0) {
              let w = this.#t || (await this.#n('solana_connect', []));
              w && this.#a(w);
            }
            let h = this.#e[0];
            if (!h) throw new Error('Not connected');
            let y = (n == null ? void 0 : n.domain) || location.host,
              p = (n == null ? void 0 : n.address) || h.address,
              C = (n == null ? void 0 : n.uri) || location.href,
              b = (n == null ? void 0 : n.version) || '1',
              E = (n == null ? void 0 : n.chainId) || 'mainnet',
              v = (n == null ? void 0 : n.nonce) || Math.random().toString(36).substring(2),
              I = (n == null ? void 0 : n.issuedAt) || new Date().toISOString(),
              R = (n == null ? void 0 : n.statement) || '',
              f = `${y} wants you to sign in with your Solana account:
${p}`;
            if (
              (R &&
                (f += `

${R}`),
              (f += `

URI: ${C}`),
              (f += `
Version: ${b}`),
              (f += `
Chain ID: ${E}`),
              (f += `
Nonce: ${v}`),
              (f += `
Issued At: ${I}`),
              n != null &&
                n.expirationTime &&
                (f += `
Expiration Time: ${n.expirationTime}`),
              n != null &&
                n.notBefore &&
                (f += `
Not Before: ${n.notBefore}`),
              n != null &&
                n.requestId &&
                (f += `
Request ID: ${n.requestId}`),
              (d = n == null ? void 0 : n.resources) != null && d.length)
            ) {
              f += `
Resources:`;
              for (let w of n.resources)
                f += `
- ${w}`;
            }
            let k = new TextEncoder().encode(f),
              T = await this.#n('solana_signMessage', [Array.from(k)]);
            i.push({ account: h, signedMessage: k, signature: new Uint8Array(T) });
          }
          return i;
        },
      },
    };
    constructor(a) {
      this.#o = a;
      try {
        let i = localStorage.getItem('keepkey-solana');
        if (i) {
          let { address: d } = JSON.parse(i);
          d && typeof d == 'string' && (this.#t = d);
        }
      } catch {}
      this.#c();
    }
    #i(a) {
      return { address: a, publicKey: M(a), chains: ['solana:mainnet'], features: [...l.ACCOUNT_FEATURES] };
    }
    #a(a) {
      this.#e = [this.#i(a)];
      try {
        localStorage.setItem('keepkey-solana', JSON.stringify({ address: a }));
      } catch {}
      this.#r();
    }
    async #c() {
      try {
        let a = await this.#n('solana_connect', []);
        if (a && typeof a == 'string') {
          this.#t = a;
          try {
            localStorage.setItem('keepkey-solana', JSON.stringify({ address: a }));
          } catch {}
        }
      } catch {}
    }
    #r() {
      let a = this.#e,
        i = this.features;
      this.#s.forEach(d => {
        try {
          d({ accounts: a, features: i });
        } catch {}
      });
    }
    #n(a, i) {
      return new Promise((d, n) => {
        this.#o(a, i, 'solana', (h, y) => {
          h ? n(h) : d(y);
        });
      });
    }
  };
  function O(l) {
    let a = ({ register: i }) => {
      i(l);
    };
    try {
      let i = window.navigator;
      (i.wallets || (i.wallets = []),
        Array.isArray(i.wallets)
          ? i.wallets.push(a)
          : typeof i.wallets.register == 'function' && i.wallets.register(l));
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: a }));
    } catch {}
    window.addEventListener('wallet-standard:app-ready', i => {
      let d = i;
      try {
        typeof d.detail == 'function' && d.detail(a);
      } catch {}
    });
  }
  (function () {
    let l = ' | KeepKeyInjected | ',
      a = '2.1.0',
      y = window,
      p = { isInjected: !1, version: a, injectedAt: Date.now(), retryCount: 0 };
    if (y.keepkeyInjectionState) {
      let o = y.keepkeyInjectionState;
      if ((console.warn(l, `Existing injection detected v${o.version}, current v${a}`), o.version >= a)) {
        console.log(l, 'Skipping injection, newer or same version already present');
        return;
      }
      console.log(l, 'Upgrading injection to newer version');
    }
    ((y.keepkeyInjectionState = p), console.log(l, `Initializing KeepKey Injection v${a}`));
    let C = {
        siteUrl: window.location.href,
        scriptSource: 'KeepKey Extension',
        version: a,
        injectedTime: new Date().toISOString(),
        origin: window.location.origin,
        protocol: window.location.protocol,
      },
      b = 0,
      E = new Map(),
      v = [],
      I = !1;
    setInterval(() => {
      let o = Date.now();
      E.forEach((t, s) => {
        o - t.timestamp > 3e5 &&
          (console.warn(l, `Callback timeout for request ${s} (${t.method})`),
          t.callback(new Error('Request timeout')),
          E.delete(s));
      });
    }, 5e3);
    let f = o => {
        (v.length >= 100 && (console.warn(l, 'Message queue full, removing oldest message'), v.shift()), v.push(o));
      },
      k = () => {
        if (I)
          for (; v.length > 0; ) {
            let o = v.shift();
            o && window.postMessage(o, window.location.origin);
          }
      },
      T = (o = 0) =>
        new Promise(t => {
          let s = ++b,
            e = setTimeout(() => {
              o < 3
                ? (console.log(l, `Verification attempt ${o + 1} failed, retrying...`),
                  setTimeout(
                    () => {
                      T(o + 1).then(t);
                    },
                    100 * Math.pow(2, o),
                  ))
                : (console.error(l, 'Failed to verify injection after max retries'),
                  (p.lastError = 'Failed to verify injection'),
                  t(!1));
            }, 1e3),
            c = r => {
              var g, u, m;
              r.source === window &&
                ((g = r.data) == null ? void 0 : g.source) === 'keepkey-content' &&
                ((u = r.data) == null ? void 0 : u.type) === 'INJECTION_CONFIRMED' &&
                ((m = r.data) == null ? void 0 : m.requestId) === s &&
                (clearTimeout(e),
                window.removeEventListener('message', c),
                (I = !0),
                (p.isInjected = !0),
                console.log(l, 'Injection verified successfully'),
                k(),
                t(!0));
            };
          (window.addEventListener('message', c),
            window.postMessage(
              { source: 'keepkey-injected', type: 'INJECTION_VERIFY', requestId: s, version: a, timestamp: Date.now() },
              window.location.origin,
            ));
        });
    function w(o, t = [], s, e) {
      let c = l + ' | walletRequest | ';
      if (!o || typeof o != 'string') {
        (console.error(c, 'Invalid method:', o), e(new Error('Invalid method')));
        return;
      }
      Array.isArray(t) || (console.warn(c, 'Params not an array, wrapping:', t), (t = [t]));
      try {
        let r = ++b,
          g = {
            id: r,
            method: o,
            params: t,
            chain: s,
            siteUrl: C.siteUrl,
            scriptSource: C.scriptSource,
            version: C.version,
            requestTime: new Date().toISOString(),
            referrer: document.referrer,
            href: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
          };
        E.set(r, { callback: e, timestamp: Date.now(), method: o });
        let u = {
          source: 'keepkey-injected',
          type: 'WALLET_REQUEST',
          requestId: r,
          requestInfo: g,
          timestamp: Date.now(),
        };
        I
          ? window.postMessage(u, window.location.origin)
          : (console.log(c, 'Content script not ready, queueing request'), f(u));
      } catch (r) {
        (console.error(c, 'Error in walletRequest:', r), e(r));
      }
    }
    window.addEventListener('message', o => {
      let t = l + ' | message | ';
      if (o.source !== window) return;
      let s = o.data;
      if (!(!s || typeof s != 'object')) {
        if (s.source === 'keepkey-content' && s.type === 'INJECTION_CONFIRMED') {
          ((I = !0), k());
          return;
        }
        if (s.source === 'keepkey-content' && s.type === 'WALLET_RESPONSE' && s.requestId) {
          let e = E.get(s.requestId);
          e
            ? (s.error ? e.callback(s.error) : e.callback(null, s.result), E.delete(s.requestId))
            : console.warn(t, 'No callback found for requestId:', s.requestId);
        }
      }
    });
    class B {
      events = new Map();
      on(t, s) {
        (this.events.has(t) || this.events.set(t, new Set()), this.events.get(t).add(s));
      }
      off(t, s) {
        var e;
        (e = this.events.get(t)) == null || e.delete(s);
      }
      removeListener(t, s) {
        this.off(t, s);
      }
      removeAllListeners(t) {
        t ? this.events.delete(t) : this.events.clear();
      }
      emit(t, ...s) {
        var e;
        (e = this.events.get(t)) == null ||
          e.forEach(c => {
            try {
              c(...s);
            } catch (r) {
              console.error(l, `Error in event handler for ${t}:`, r);
            }
          });
      }
      once(t, s) {
        let e = (...c) => {
          (s(...c), this.off(t, e));
        };
        this.on(t, e);
      }
    }
    function A(o) {
      console.log(l, 'Creating wallet object for chain:', o);
      let t = new B(),
        s = {
          network: 'mainnet',
          isKeepKey: !0,
          isMetaMask: !0,
          isConnected: () => I,
          request: ({ method: e, params: c = [] }) =>
            new Promise((r, g) => {
              w(e, c, o, (u, m) => {
                u ? g(u) : r(m);
              });
            }),
          send: (e, c, r) => {
            if ((e.chain || (e.chain = o), typeof r == 'function')) {
              w(e.method, e.params || c, o, (g, u) => {
                g ? r(g) : r(null, { id: e.id, jsonrpc: '2.0', result: u });
              });
              return;
            } else
              return (
                console.warn(l, 'Synchronous send is deprecated and may not work properly'),
                { id: e.id, jsonrpc: '2.0', result: null }
              );
          },
          sendAsync: (e, c, r) => {
            e.chain || (e.chain = o);
            let g = r || c;
            if (typeof g != 'function') {
              console.error(l, 'sendAsync requires a callback function');
              return;
            }
            w(e.method, e.params || c, o, (u, m) => {
              u ? g(u) : g(null, { id: e.id, jsonrpc: '2.0', result: m });
            });
          },
          on: (e, c) => (t.on(e, c), s),
          off: (e, c) => (t.off(e, c), s),
          removeListener: (e, c) => (t.removeListener(e, c), s),
          removeAllListeners: e => (t.removeAllListeners(e), s),
          emit: (e, ...c) => (t.emit(e, ...c), s),
          once: (e, c) => (t.once(e, c), s),
          enable: () => s.request({ method: 'eth_requestAccounts' }),
          _metamask: { isUnlocked: () => Promise.resolve(!0) },
        };
      return (
        o === 'ethereum' &&
          ((s.chainId = '0x1'),
          (s.networkVersion = '1'),
          (s.selectedAddress = null),
          (s._handleAccountsChanged = e => {
            ((s.selectedAddress = e[0] || null), t.emit('accountsChanged', e));
          }),
          (s._handleChainChanged = e => {
            ((s.chainId = e), t.emit('chainChanged', e));
          }),
          (s._handleConnect = e => {
            t.emit('connect', e);
          }),
          (s._handleDisconnect = e => {
            ((s.selectedAddress = null), t.emit('disconnect', e));
          })),
        s
      );
    }
    function S(o) {
      let t = {
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          name: 'KeepKey',
          icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==',
          rdns: 'com.keepkey.client',
        },
        s = new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: t, provider: o }) });
      (console.log(l, 'Announcing EIP-6963 provider'), window.dispatchEvent(s));
    }
    async function j() {
      let o = l + ' | mountWallet | ';
      console.log(o, 'Starting wallet mount process');
      let t = A('ethereum'),
        s = {
          binance: A('binance'),
          bitcoin: A('bitcoin'),
          bitcoincash: A('bitcoincash'),
          dogecoin: A('dogecoin'),
          dash: A('dash'),
          ethereum: t,
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
          ethereum: t,
          osmosis: A('osmosis'),
          cosmos: A('cosmos'),
          litecoin: A('litecoin'),
          thorchain: A('thorchain'),
          mayachain: A('mayachain'),
          ripple: A('ripple'),
        },
        c = (r, g) => {
          y[r] && console.warn(o, `${r} already exists, checking if override is allowed`);
          try {
            (Object.defineProperty(y, r, { value: g, writable: !1, configurable: !0 }),
              console.log(o, `Successfully mounted window.${r}`));
          } catch (u) {
            (console.error(o, `Failed to mount window.${r}:`, u), (p.lastError = `Failed to mount ${r}`));
          }
        };
      (c('ethereum', t),
        c('xfi', s),
        c('keepkey', e),
        window.addEventListener('eip6963:requestProvider', () => {
          (console.log(o, 'Re-announcing provider on request'), S(t));
        }),
        S(t),
        setTimeout(() => {
          (console.log(o, 'Delayed EIP-6963 announcement for late-loading dApps'), S(t));
        }, 100));
      try {
        let r = new U(w);
        (O(r), console.log(o, 'Solana wallet registered via Wallet Standard'));
      } catch (r) {
        console.error(o, 'Failed to register Solana wallet:', r);
      }
      (window.addEventListener('message', r => {
        var g, u, m;
        (((g = r.data) == null ? void 0 : g.type) === 'CHAIN_CHANGED' &&
          (console.log(o, 'Chain changed:', r.data),
          t.emit('chainChanged', (u = r.data.provider) == null ? void 0 : u.chainId)),
          ((m = r.data) == null ? void 0 : m.type) === 'ACCOUNTS_CHANGED' &&
            (console.log(o, 'Accounts changed:', r.data),
            t._handleAccountsChanged && t._handleAccountsChanged(r.data.accounts || [])));
      }),
        T().then(r => {
          r
            ? console.log(o, 'Injection verified successfully')
            : (console.error(o, 'Failed to verify injection, wallet features may not work'),
              (p.lastError = 'Injection not verified'));
        }),
        console.log(o, 'Wallet mount complete'));
    }
    (j(),
      document.readyState === 'loading' &&
        document.addEventListener('DOMContentLoaded', () => {
          if (
            (console.log(l, 'DOM loaded, re-announcing provider for late-loading dApps'),
            y.ethereum && typeof y.dispatchEvent == 'function')
          ) {
            let o = y.ethereum;
            S(o);
          }
        }),
      console.log(l, 'Injection script loaded and initialized'));
  })();
})();
