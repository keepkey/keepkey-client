"use strict";
(() => {
  // src/injected/solana-wallet-standard.ts
  var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58Decode(str) {
    const bytes = [0];
    for (const char of str) {
      const idx = BASE58_ALPHABET.indexOf(char);
      if (idx === -1) throw new Error("Invalid base58 character");
      let carry = idx;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 255;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 255);
        carry >>= 8;
      }
    }
    for (const char of str) {
      if (char !== "1") break;
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }
  var KeepKeySolanaWallet = class _KeepKeySolanaWallet {
    #walletRequest;
    #accounts = [];
    #cachedAddress = null;
    #listeners = /* @__PURE__ */ new Set();
    // Wallet Standard required fields
    version = "1.0.0";
    name = "KeepKey";
    icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==";
    chains = ["solana:mainnet"];
    static ACCOUNT_FEATURES = [
      "solana:signTransaction",
      "solana:signAndSendTransaction",
      "solana:signMessage"
    ];
    get accounts() {
      return this.#accounts;
    }
    features = {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          if (this.#accounts.length > 0) {
            return { accounts: this.#accounts };
          }
          let list = await this.#rpc("solana_getAccounts", []).catch(() => null);
          if (!Array.isArray(list) || list.length === 0) {
            const address = this.#cachedAddress || await this.#rpc("solana_connect", []);
            list = address ? [{ address }] : [];
          }
          this.#setAccounts(list);
          return { accounts: this.#accounts };
        }
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          await this.#rpc("solana_disconnect", []).catch(() => {
          });
          this.#accounts = [];
          try {
            localStorage.removeItem("keepkey-solana");
          } catch {
          }
          this.#emitChange();
        }
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          if (event === "change") {
            this.#listeners.add(listener);
          }
          return () => {
            this.#listeners.delete(listener);
          };
        }
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) => {
          const outputs = [];
          for (const { message, account } of inputs) {
            const sigArray = await this.#rpc("solana_signMessage", [
              Array.from(message),
              { accountAddress: account == null ? void 0 : account.address }
            ]);
            outputs.push({
              signedMessage: message,
              signature: new Uint8Array(sigArray)
            });
          }
          return outputs;
        }
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: /* @__PURE__ */ new Set(["legacy", 0]),
        signTransaction: async (...inputs) => {
          const outputs = [];
          for (const { transaction, account } of inputs) {
            const signedArray = await this.#rpc("solana_signTransaction", [
              Array.from(transaction),
              { accountAddress: account == null ? void 0 : account.address }
            ]);
            outputs.push({
              signedTransaction: new Uint8Array(signedArray)
            });
          }
          return outputs;
        }
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: /* @__PURE__ */ new Set(["legacy", 0]),
        signAndSendTransaction: async (...inputs) => {
          const outputs = [];
          for (const { transaction, account } of inputs) {
            const txSig = await this.#rpc("solana_signAndSendTransaction", [
              Array.from(transaction),
              { accountAddress: account == null ? void 0 : account.address }
            ]);
            outputs.push({
              signature: base58Decode(txSig)
            });
          }
          return outputs;
        }
      },
      // ── Vendor-namespaced extension: off-chain message signing ──
      //
      // The Solana Wallet Standard reserves the `solana:` namespace for
      // the canonical signing surface (signMessage / signTransaction /
      // signAndSendTransaction / signIn). Off-chain message signing
      // (https://github.com/solana-labs/solana/blob/master/docs/src/proposals/off-chain-message-signing.md)
      // is a different primitive — the signature is over a domain-
      // separated envelope, not the bare message — and is not part of
      // the standard. We expose it under our wallet's namespace so dApps
      // can feature-detect:
      //
      //   const f = wallet.features['keepkey:signOffchainMessage']
      //   if (f) await f.signOffchainMessage({ message, version?, messageFormat? })
      //
      // Returns hex `publicKey` + hex `signature` — verifiers MUST
      // reconstruct the envelope to verify (see the handler comment in
      // background/chains/solanaHandler.ts for the byte layout).
      "keepkey:signOffchainMessage": {
        version: "1.0.0",
        signOffchainMessage: async (input) => {
          const messageBytes = typeof input.message === "string" ? Array.from(new TextEncoder().encode(input.message)) : Array.from(input.message);
          return await this.#rpc("solana_signOffchainMessage", [
            {
              message: messageBytes,
              version: input.version,
              messageFormat: input.messageFormat
            }
          ]);
        }
      },
      "solana:signIn": {
        version: "1.0.0",
        signIn: async (...inputs) => {
          var _a;
          const outputs = [];
          for (const input of inputs) {
            if (this.#accounts.length === 0) {
              const address2 = this.#cachedAddress || await this.#rpc("solana_connect", []);
              if (address2) this.#setConnected(address2);
            }
            const account = (input == null ? void 0 : input.address) && this.#accounts.find((a) => a.address === input.address) || this.#accounts[0];
            if (!account) throw new Error("Not connected");
            const domain = (input == null ? void 0 : input.domain) || location.host;
            const address = (input == null ? void 0 : input.address) || account.address;
            const uri = (input == null ? void 0 : input.uri) || location.href;
            const version = (input == null ? void 0 : input.version) || "1";
            const chainId = (input == null ? void 0 : input.chainId) || "mainnet";
            const nonce = (input == null ? void 0 : input.nonce) || Math.random().toString(36).substring(2);
            const issuedAt = (input == null ? void 0 : input.issuedAt) || (/* @__PURE__ */ new Date()).toISOString();
            const statement = (input == null ? void 0 : input.statement) || "";
            let msg = `${domain} wants you to sign in with your Solana account:
${address}`;
            if (statement) msg += `

${statement}`;
            msg += `

URI: ${uri}`;
            msg += `
Version: ${version}`;
            msg += `
Chain ID: ${chainId}`;
            msg += `
Nonce: ${nonce}`;
            msg += `
Issued At: ${issuedAt}`;
            if (input == null ? void 0 : input.expirationTime) msg += `
Expiration Time: ${input.expirationTime}`;
            if (input == null ? void 0 : input.notBefore) msg += `
Not Before: ${input.notBefore}`;
            if (input == null ? void 0 : input.requestId) msg += `
Request ID: ${input.requestId}`;
            if ((_a = input == null ? void 0 : input.resources) == null ? void 0 : _a.length) {
              msg += `
Resources:`;
              for (const r of input.resources) msg += `
- ${r}`;
            }
            const messageBytes = new TextEncoder().encode(msg);
            const sigArray = await this.#rpc("solana_signMessage", [
              Array.from(messageBytes),
              { accountAddress: account.address }
            ]);
            outputs.push({
              account,
              signedMessage: messageBytes,
              signature: new Uint8Array(sigArray)
            });
          }
          return outputs;
        }
      }
    };
    constructor(walletRequest) {
      this.#walletRequest = walletRequest;
      try {
        const cached = localStorage.getItem("keepkey-solana");
        if (cached) {
          const { address } = JSON.parse(cached);
          if (address && typeof address === "string") {
            this.#cachedAddress = address;
          }
        }
      } catch {
      }
      this.#silentConnect();
    }
    // ---------- Internal helpers ----------
    #makeAccount(address) {
      return {
        address,
        publicKey: base58Decode(address),
        chains: ["solana:mainnet"],
        features: [..._KeepKeySolanaWallet.ACCOUNT_FEATURES]
      };
    }
    #setConnected(address) {
      this.#accounts = [this.#makeAccount(address)];
      try {
        localStorage.setItem("keepkey-solana", JSON.stringify({ address }));
      } catch {
      }
      this.#emitChange();
    }
    // Populate accounts from the enumerated list (multi-account). The dApp picks
    // an account and hands it back on each sign call; the background maps its
    // address to the right derivation path.
    #setAccounts(list) {
      var _a;
      this.#accounts = list.filter((a) => a == null ? void 0 : a.address).map((a) => this.#makeAccount(a.address));
      try {
        const primary = (_a = this.#accounts[0]) == null ? void 0 : _a.address;
        if (primary) localStorage.setItem("keepkey-solana", JSON.stringify({ address: primary }));
      } catch {
      }
      this.#emitChange();
    }
    async #silentConnect() {
      try {
        const address = await this.#rpc("solana_connect", []);
        if (address && typeof address === "string") {
          this.#cachedAddress = address;
          try {
            localStorage.setItem("keepkey-solana", JSON.stringify({ address }));
          } catch {
          }
        }
      } catch {
      }
    }
    #emitChange() {
      const accounts = this.#accounts;
      const features = this.features;
      this.#listeners.forEach((fn) => {
        try {
          fn({ accounts, features });
        } catch {
        }
      });
    }
    #rpc(method, params) {
      return new Promise((resolve, reject) => {
        this.#walletRequest(method, params, "solana", (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    }
  };

  // src/injected/solana-wallet-register.ts
  function registerSolanaWallet(wallet) {
    const callback = ({ register }) => {
      register(wallet);
    };
    try {
      const nav = window.navigator;
      if (!nav.wallets) {
        nav.wallets = [];
      }
      if (Array.isArray(nav.wallets)) {
        nav.wallets.push(callback);
      } else if (typeof nav.wallets.register === "function") {
        nav.wallets.register(wallet);
      }
    } catch {
    }
    const announce = () => {
      try {
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback }));
      } catch {
      }
    };
    announce();
    setTimeout(announce, 100);
    setTimeout(announce, 1e3);
    window.addEventListener("wallet-standard:app-ready", (event) => {
      const api = event.detail;
      try {
        if (api && typeof api.register === "function") {
          callback(api);
        } else if (typeof api === "function") {
          api(callback);
        }
      } catch {
      }
    });
  }

  // src/injected/solana-provider.ts
  var BASE58_ALPHABET2 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58Decode2(str) {
    const bytes = [0];
    for (const char of str) {
      const idx = BASE58_ALPHABET2.indexOf(char);
      if (idx === -1) throw new Error("Invalid base58 character");
      let carry = idx;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 255;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 255);
        carry >>= 8;
      }
    }
    for (const char of str) {
      if (char !== "1") break;
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }
  function makePublicKey(address) {
    const bytes = base58Decode2(address);
    return {
      toString: () => address,
      toBase58: () => address,
      toBytes: () => bytes,
      toBuffer: () => bytes,
      equals: (other) => {
        var _a, _b;
        try {
          return ((_a = other == null ? void 0 : other.toBase58) == null ? void 0 : _a.call(other)) === address || ((_b = other == null ? void 0 : other.toString) == null ? void 0 : _b.call(other)) === address;
        } catch {
          return false;
        }
      }
    };
  }
  function isVersionedTransaction(tx) {
    return tx != null && typeof tx === "object" && "version" in tx && tx.message != null;
  }
  function serializeForSigning(tx) {
    if (!tx || typeof tx.serialize !== "function") {
      throw new Error("Unsupported transaction: missing serialize()");
    }
    if (isVersionedTransaction(tx)) {
      return new Uint8Array(tx.serialize());
    }
    return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  }
  function extractFeePayerSignature(signed) {
    const count = signed[0];
    if (!count) throw new Error("Signed transaction has no signatures");
    if (count & 128) throw new Error("Unexpected multi-byte signature count");
    return signed.slice(1, 1 + 64);
  }
  function feePayerKey(tx) {
    var _a, _b;
    if (isVersionedTransaction(tx)) {
      const keys = (_a = tx.message) == null ? void 0 : _a.staticAccountKeys;
      if (keys && keys.length) return keys[0];
      throw new Error("Versioned transaction missing account keys");
    }
    if (tx.feePayer) return tx.feePayer;
    const sig0 = (_b = tx.signatures) == null ? void 0 : _b[0];
    if (sig0 == null ? void 0 : sig0.publicKey) return sig0.publicKey;
    throw new Error("Legacy transaction missing fee payer");
  }
  var KeepKeySolanaProvider = class {
    #walletRequest;
    #listeners = /* @__PURE__ */ new Map();
    #publicKey = null;
    #cachedAddress = null;
    // Identity flags. `isPhantom` is the impersonation that legacy
    // wallet-adapter-phantom dApps gate on; it is only ever set because the
    // user left Phantom masking enabled (see injected.ts mount gate).
    isPhantom = true;
    isKeepKey = true;
    constructor(walletRequest) {
      this.#walletRequest = walletRequest;
      try {
        const cached = localStorage.getItem("keepkey-solana");
        if (cached) {
          const { address } = JSON.parse(cached);
          if (address && typeof address === "string") this.#cachedAddress = address;
        }
      } catch {
      }
      this.#silentConnect();
    }
    get publicKey() {
      return this.#publicKey;
    }
    get isConnected() {
      return this.#publicKey !== null;
    }
    // ---- Connection ----
    async connect(_opts) {
      if (this.#publicKey) return { publicKey: this.#publicKey };
      const address = this.#cachedAddress || await this.#rpc("solana_connect", []);
      if (!address) throw new Error("Failed to connect to KeepKey");
      this.#setConnected(address);
      return { publicKey: this.#publicKey };
    }
    async disconnect() {
      await this.#rpc("solana_disconnect", []).catch(() => {
      });
      this.#publicKey = null;
      try {
        localStorage.removeItem("keepkey-solana");
      } catch {
      }
      this.#emit("disconnect");
    }
    // ---- Signing ----
    async signMessage(message, _display) {
      await this.#ensureConnected();
      const sigArray = await this.#rpc("solana_signMessage", [Array.from(message)]);
      return { signature: new Uint8Array(sigArray), publicKey: this.#publicKey };
    }
    async signTransaction(transaction) {
      await this.#ensureConnected();
      const bytes = serializeForSigning(transaction);
      const signedArray = await this.#rpc("solana_signTransaction", [Array.from(bytes)]);
      const signed = new Uint8Array(signedArray);
      const signature = extractFeePayerSignature(signed);
      transaction.addSignature(feePayerKey(transaction), signature);
      return transaction;
    }
    async signAllTransactions(transactions) {
      const out = [];
      for (const tx of transactions) {
        out.push(await this.signTransaction(tx));
      }
      return out;
    }
    async signAndSendTransaction(transaction, _options) {
      await this.#ensureConnected();
      const bytes = serializeForSigning(transaction);
      const signature = await this.#rpc("solana_signAndSendTransaction", [Array.from(bytes)]);
      return { signature, publicKey: this.#publicKey };
    }
    // Generic dispatcher for dApps that drive the provider via request().
    async request({ method, params }) {
      var _a, _b, _c, _d, _e, _f;
      const p = Array.isArray(params) ? params : params != null ? [params] : [];
      switch (method) {
        case "connect":
          return this.connect(p[0]);
        case "disconnect":
          return this.disconnect();
        case "signTransaction":
          return this.signTransaction(((_a = p[0]) == null ? void 0 : _a.transaction) ?? p[0]);
        case "signAllTransactions":
          return this.signAllTransactions(((_b = p[0]) == null ? void 0 : _b.transactions) ?? p[0]);
        case "signAndSendTransaction":
          return this.signAndSendTransaction(((_c = p[0]) == null ? void 0 : _c.transaction) ?? p[0], ((_d = p[0]) == null ? void 0 : _d.options) ?? p[1]);
        case "signMessage":
          return this.signMessage(((_e = p[0]) == null ? void 0 : _e.message) ?? p[0], (_f = p[0]) == null ? void 0 : _f.display);
        default:
          throw new Error(`KeepKey (Solana): unsupported method "${method}"`);
      }
    }
    // ---- Events (EventEmitter-ish, Phantom surface) ----
    on(event, handler) {
      if (!this.#listeners.has(event)) this.#listeners.set(event, /* @__PURE__ */ new Set());
      this.#listeners.get(event).add(handler);
      return this;
    }
    off(event, handler) {
      var _a;
      (_a = this.#listeners.get(event)) == null ? void 0 : _a.delete(handler);
      return this;
    }
    removeListener(event, handler) {
      return this.off(event, handler);
    }
    removeAllListeners(event) {
      if (event) this.#listeners.delete(event);
      else this.#listeners.clear();
      return this;
    }
    // ---- Internal ----
    #emit(event, ...args) {
      var _a;
      (_a = this.#listeners.get(event)) == null ? void 0 : _a.forEach((fn) => {
        try {
          fn(...args);
        } catch {
        }
      });
    }
    #setConnected(address) {
      this.#publicKey = makePublicKey(address);
      this.#cachedAddress = address;
      try {
        localStorage.setItem("keepkey-solana", JSON.stringify({ address }));
      } catch {
      }
      this.#emit("connect", this.#publicKey);
    }
    async #ensureConnected() {
      if (this.#publicKey) return;
      await this.connect();
    }
    async #silentConnect() {
      try {
        const address = await this.#rpc("solana_connect", []);
        if (address && typeof address === "string") {
          this.#cachedAddress = address;
          try {
            localStorage.setItem("keepkey-solana", JSON.stringify({ address }));
          } catch {
          }
        }
      } catch {
      }
    }
    #rpc(method, params) {
      return new Promise((resolve, reject) => {
        this.#walletRequest(method, params, "solana", (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    }
  };

  // src/injected/tron-provider.ts
  var TRONGRID_URL = "https://api.trongrid.io";
  var B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58Decode3(str) {
    const bytes = [0];
    for (const char of str) {
      const idx = B58_ALPHABET.indexOf(char);
      if (idx === -1) throw new Error("Invalid base58 character");
      let carry = idx;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 255;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 255);
        carry >>= 8;
      }
    }
    for (const char of str) {
      if (char !== "1") break;
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }
  function toHexString(bytes) {
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out;
  }
  function base58ToHex(addr) {
    const bytes = base58Decode3(addr);
    if (bytes.length !== 25 || bytes[0] !== 65) {
      throw new Error(`Invalid Tron address: ${addr}`);
    }
    return toHexString(bytes.slice(0, 21));
  }
  function isTronBase58(addr) {
    if (typeof addr !== "string" || addr.length !== 34 || !addr.startsWith("T")) return false;
    try {
      base58ToHex(addr);
      return true;
    } catch {
      return false;
    }
  }
  var EventEmitter = class {
    events = /* @__PURE__ */ new Map();
    on(event, handler) {
      if (!this.events.has(event)) this.events.set(event, /* @__PURE__ */ new Set());
      this.events.get(event).add(handler);
    }
    off(event, handler) {
      var _a;
      (_a = this.events.get(event)) == null ? void 0 : _a.delete(handler);
    }
    emit(event, ...args) {
      var _a;
      (_a = this.events.get(event)) == null ? void 0 : _a.forEach((h) => {
        try {
          h(...args);
        } catch {
        }
      });
    }
  };
  function promisifyRequest(walletRequest, method, params) {
    return new Promise((resolve, reject) => {
      walletRequest(method, params, "tron", (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }
  var TRONGRID_TIMEOUT_MS = 8e3;
  var TRONGRID_BROADCAST_TIMEOUT_MS = 12e3;
  var isTransientTronStatus = (status) => status >= 500 && status < 600;
  async function tronGridPost(path, body) {
    const isBroadcast = path.includes("broadcasttransaction");
    const timeoutMs = isBroadcast ? TRONGRID_BROADCAST_TIMEOUT_MS : TRONGRID_TIMEOUT_MS;
    const maxAttempts = 2;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(`${TRONGRID_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!resp.ok) {
          if (isTransientTronStatus(resp.status) && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 200 * attempt));
            continue;
          }
          const text = await resp.text().catch(() => "");
          throw new Error(`TronGrid ${path} failed (${resp.status}): ${text}`);
        }
        return await resp.json();
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
          continue;
        }
      }
    }
    throw lastErr;
  }
  var KeepKeyTronProvider = class {
    tronWeb;
    tronLink;
    address = null;
    hexAddress = null;
    emitter = new EventEmitter();
    walletRequest;
    constructor(walletRequest) {
      this.walletRequest = walletRequest;
      this.tronWeb = this.buildTronWeb();
      this.tronLink = this.buildTronLink();
    }
    /** Populate cached address state — called after a successful connect. */
    setAddress(address) {
      if (!address || !isTronBase58(address)) return;
      this.address = address;
      this.hexAddress = base58ToHex(address);
      this.tronWeb.ready = true;
      this.tronWeb.defaultAddress = {
        base58: address,
        hex: this.hexAddress,
        name: "KeepKey",
        type: 1
      };
      this.tronLink.ready = true;
      this.fireMessage("setAccount", { address, name: "KeepKey", type: 1 });
      this.fireMessage("accountsChanged", { address });
    }
    /** Emit a TronLink-compatible `message` event on the window. */
    fireMessage(action, data) {
      try {
        window.postMessage(
          {
            message: {
              action,
              data
            },
            isTronLink: true
          },
          window.location.origin
        );
      } catch {
      }
      this.emitter.emit(action, data);
    }
    buildTronLink() {
      return {
        // Tron dApps have no multi-wallet discovery standard, so most
        // gate on this flag to decide whether to surface a "Connect
        // TronLink" button vs. a deep-link to install TronLink. We set
        // it to true to be treated as the compatible provider — our
        // approval UI still identifies as KeepKey, so there's no UX
        // deception, just detection-bypass.
        isTronLink: true,
        ready: false,
        tronWeb: null,
        // Populated below, after tronWeb exists.
        request: async ({ method, params }) => {
          switch (method) {
            case "tron_requestAccounts":
            case "tron_accounts": {
              const address = await promisifyRequest(this.walletRequest, "tron_requestAccounts", []);
              if (!address || typeof address !== "string") {
                return { code: 4001, message: "User denied account access" };
              }
              this.setAddress(address);
              return { code: 200, message: "ok" };
            }
            default:
              return promisifyRequest(this.walletRequest, method, Array.isArray(params) ? params : [params]);
          }
        },
        on: (event, handler) => this.emitter.on(event, handler),
        off: (event, handler) => this.emitter.off(event, handler)
      };
    }
    buildTronWeb() {
      const self = this;
      const trx = {
        sign: async (tx, privateKey, useTronHeader, options) => {
          if (typeof tx === "string") {
            throw new Error("tronWeb.trx.sign(message) not supported \u2014 use tronWeb.trx.signMessage()");
          }
          if (!tx || !tx.raw_data_hex) {
            throw new Error("tronWeb.trx.sign expects a built transaction with raw_data_hex");
          }
          const signed = await promisifyRequest(self.walletRequest, "tron_sign", [tx]);
          return signed;
        },
        // TIP-191 V1 — message is hex (with or without 0x).
        // privateKey arg is ignored (signing always happens on the device).
        signMessage: async (message, privateKey) => {
          return await promisifyRequest(self.walletRequest, "tron_signMessage", [message]);
        },
        // TIP-191 V2 — message is UTF-8 string.
        signMessageV2: async (message, privateKey) => {
          return await promisifyRequest(self.walletRequest, "signMessageV2", [message]);
        },
        // verifyMessage / verifyMessageV2 deliberately NOT exposed here.
        // TronWeb V2's verifyMessageV2(message, signature) returns the
        // recovered base58 address; our endpoint shape (address required,
        // boolean returned) doesn't match. Use TronWeb's static
        // verification utilities, or call tronLink.request({ method:
        // 'tron_verifyMessage', params: [{ address, signature, message,
        // isText? }] }) explicitly.
        sendRawTransaction: async (signedTx) => {
          return tronGridPost("/wallet/broadcasttransaction", signedTx);
        },
        broadcast: async (signedTx) => trx.sendRawTransaction(signedTx),
        getBalance: async (address) => {
          const addr = address || self.address;
          if (!addr) throw new Error("No address \u2014 call tron_requestAccounts first");
          const result = await tronGridPost("/wallet/getaccount", { address: addr, visible: true });
          return typeof (result == null ? void 0 : result.balance) === "number" ? result.balance : 0;
        },
        getAccount: async (address) => {
          const addr = address || self.address;
          if (!addr) throw new Error("No address \u2014 call tron_requestAccounts first");
          return tronGridPost("/wallet/getaccount", { address: addr, visible: true });
        },
        getUnconfirmedAccount: async (address) => {
          const addr = address || self.address;
          if (!addr) throw new Error("No address \u2014 call tron_requestAccounts first");
          return tronGridPost("/wallet/getaccount", { address: addr, visible: true });
        },
        getTransaction: async (txId) => tronGridPost("/wallet/gettransactionbyid", { value: txId })
      };
      const transactionBuilder = {
        sendTrx: async (to, amount, from) => {
          const owner = from || self.address;
          if (!owner) throw new Error("No address \u2014 call tron_requestAccounts first");
          return tronGridPost("/wallet/createtransaction", {
            owner_address: owner,
            to_address: to,
            amount,
            visible: true
          });
        },
        triggerSmartContract: async (contractAddress, functionSelector, options = {}, parameters = [], issuerAddress) => {
          const owner = issuerAddress || self.address;
          if (!owner) throw new Error("No address \u2014 call tron_requestAccounts first");
          return tronGridPost("/wallet/triggersmartcontract", {
            contract_address: contractAddress,
            function_selector: functionSelector,
            parameter: buildTriggerParameter(parameters),
            fee_limit: options.feeLimit ?? 1e8,
            call_value: options.callValue ?? 0,
            owner_address: owner,
            visible: true
          });
        }
      };
      const utils = {
        isAddress: (addr) => isTronBase58(addr),
        fromSun: (sun) => String(Number(sun) / 1e6),
        toSun: (trx2) => String(Math.round(Number(trx2) * 1e6)),
        toHex: (addr) => base58ToHex(addr)
      };
      const tronWeb = {
        // Mirror the TronLink-compatibility flag — some dApps check here
        // rather than on window.tronLink.
        isTronLink: true,
        ready: false,
        defaultAddress: {
          base58: false,
          hex: false,
          name: false,
          type: -1
        },
        fullNode: { host: TRONGRID_URL },
        solidityNode: { host: TRONGRID_URL },
        eventServer: { host: TRONGRID_URL },
        trx,
        transactionBuilder,
        utils,
        on: (event, handler) => this.emitter.on(event, handler),
        off: (event, handler) => this.emitter.off(event, handler),
        setAddress: (_addr) => {
        },
        isConnected: () => this.address !== null
      };
      queueMicrotask(() => {
        if (this.tronLink) this.tronLink.tronWeb = tronWeb;
      });
      return tronWeb;
    }
  };
  function buildTriggerParameter(parameters) {
    if (!Array.isArray(parameters) || parameters.length === 0) return "";
    let out = "";
    for (const p of parameters) {
      if (p.type === "address") {
        const addr = String(p.value);
        const hex = addr.startsWith("T") ? base58ToHex(addr).slice(2) : addr.replace(/^0x/, "").replace(/^41/, "");
        out += hex.padStart(64, "0");
      } else if (p.type === "uint256" || p.type === "uint") {
        const v = BigInt(p.value);
        out += v.toString(16).padStart(64, "0");
      } else {
        const v = String(p.value).replace(/^0x/, "");
        out += v.padStart(64, "0");
      }
    }
    return out;
  }

  // src/injected/injected.ts
  (function() {
    const VERSION = "2.1.0";
    const MAX_RETRY_COUNT = 3;
    const RETRY_DELAY = 100;
    const CALLBACK_TIMEOUT = 3e5;
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
      if (existing.version >= VERSION) {
        return;
      }
    }
    kWindow.keepkeyInjectionState = injectionState;
    const masking = (() => {
      var _a;
      const fallback = {
        enableMetaMaskMasking: false,
        enableXfiMasking: false,
        enableKeplrMasking: false,
        enablePhantomMasking: false
      };
      try {
        const cs = document.currentScript;
        const byId = document.getElementById("keepkey-injected-script");
        const el = ((_a = cs == null ? void 0 : cs.dataset) == null ? void 0 : _a.masking) ? cs : byId;
        const raw = el == null ? void 0 : el.dataset.masking;
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return {
          enableMetaMaskMasking: parsed.enableMetaMaskMasking === true,
          enableXfiMasking: parsed.enableXfiMasking === true,
          enableKeplrMasking: parsed.enableKeplrMasking === true,
          enablePhantomMasking: parsed.enablePhantomMasking === true
        };
      } catch {
        return fallback;
      }
    })();
    console.log(
      `[KeepKey] masking: metamask=${masking.enableMetaMaskMasking ? "on" : "off"} xfi=${masking.enableXfiMasking ? "on" : "off"} keplr=${masking.enableKeplrMasking ? "on" : "off"} phantom=${masking.enablePhantomMasking ? "on" : "off"}`
    );
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
          callback.callback(new Error("Request timeout"));
          callbacks.delete(id);
        }
      });
    };
    setInterval(cleanupCallbacks, 5e3);
    const addToQueue = (message) => {
      if (messageQueue.length >= MESSAGE_QUEUE_MAX) {
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
            setTimeout(
              () => {
                verifyInjection(retryCount + 1).then(resolve);
              },
              RETRY_DELAY * Math.pow(2, retryCount)
            );
          } else {
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
      if (!method || typeof method !== "string") {
        callback(new Error("Invalid method"));
        return;
      }
      if (!Array.isArray(params)) {
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
          addToQueue(message);
        }
      } catch (error) {
        callback(error);
      }
    }
    window.addEventListener("message", (event) => {
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
        }
      }
    });
    class EventEmitter2 {
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
          } catch (_error) {
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
      const eventEmitter = new EventEmitter2();
      const wallet = {
        network: "mainnet",
        isKeepKey: true,
        // Only claim to be MetaMask when the user explicitly opts in via
        // Settings → Masking. Stripe and other legacy dApps gate on this
        // flag; claiming it by default would misrepresent the wallet and
        // shadow EIP-6963 discovery on dApps that prefer MetaMask.
        isMetaMask: masking.enableMetaMaskMasking,
        isConnected: () => isContentScriptReady,
        request: ({ method, params = [] }) => {
          return new Promise((resolve, reject) => {
            walletRequest(method, params, chain, (error, result) => {
              if (error) {
                console.log(
                  `[HANDOFF] dApp \u2190 KeepKey (${chain}/${method}) REJECT
  params=${JSON.stringify(params)}
  error=`,
                  error
                );
                reject(error);
              } else {
                const resultType = typeof result;
                const resultPreview = resultType === "string" ? `len=${result.length} value=${result}` : `value=${JSON.stringify(result)}`;
                console.log(
                  `[HANDOFF] dApp \u2190 KeepKey (${chain}/${method}) RESOLVE
  params=${JSON.stringify(params)}
  type=${resultType} ${resultPreview}`
                );
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
            return { id: payload.id, jsonrpc: "2.0", result: null };
          }
        },
        sendAsync: (payload, param1, callback) => {
          if (!payload.chain) {
            payload.chain = chain;
          }
          const cb = callback || param1;
          if (typeof cb !== "function") {
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
    const KEEPKEY_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ22W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==";
    const METAMASK_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#F6851B"/><text x="16" y="21" font-family="Arial,sans-serif" font-weight="bold" font-size="14" fill="#fff" text-anchor="middle">MM</text></svg>'
    );
    function announceProvider(ethereumProvider) {
      const keepkeyInfo = {
        uuid: "350670db-19fa-4704-a166-e52e178b59d4",
        name: "KeepKey",
        icon: KEEPKEY_ICON,
        rdns: "com.keepkey.client"
      };
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({ info: keepkeyInfo, provider: ethereumProvider })
        })
      );
      if (masking.enableMetaMaskMasking) {
        const metaMaskInfo = {
          uuid: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          name: "MetaMask",
          icon: METAMASK_ICON,
          rdns: "io.metamask"
        };
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info: metaMaskInfo, provider: ethereumProvider })
          })
        );
      }
    }
    async function mountWallet() {
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
      const mountProvider = (name, provider, { force = false } = {}) => {
        const existing = kWindow[name];
        if (existing && !force) {
          return;
        }
        try {
          Object.defineProperty(kWindow, name, {
            value: provider,
            writable: false,
            configurable: true
            // Allow reconfiguration for updates
          });
        } catch (_e) {
          injectionState.lastError = `Failed to mount ${name}`;
        }
      };
      if (masking.enableMetaMaskMasking) {
        mountProvider("ethereum", ethereum);
      }
      if (masking.enableXfiMasking) {
        mountProvider("xfi", xfi);
      }
      mountProvider("keepkey", keepkey, { force: true });
      window.addEventListener("eip6963:requestProvider", () => {
        announceProvider(ethereum);
      });
      announceProvider(ethereum);
      setTimeout(() => {
        announceProvider(ethereum);
      }, 100);
      try {
        const solanaWallet = new KeepKeySolanaWallet(walletRequest);
        registerSolanaWallet(solanaWallet);
      } catch (_e) {
      }
      if (masking.enablePhantomMasking) {
        try {
          if (!kWindow.solana) {
            const solanaProvider = new KeepKeySolanaProvider(walletRequest);
            Object.defineProperty(kWindow, "solana", {
              value: solanaProvider,
              writable: false,
              configurable: true
            });
          }
        } catch (_e) {
        }
      }
      try {
        const tronProvider = new KeepKeyTronProvider(walletRequest);
        if (!kWindow.tronLink) {
          Object.defineProperty(kWindow, "tronLink", {
            value: tronProvider.tronLink,
            writable: false,
            configurable: true
          });
        }
        if (!kWindow.tronWeb) {
          Object.defineProperty(kWindow, "tronWeb", {
            value: tronProvider.tronWeb,
            writable: false,
            configurable: true
          });
        }
      } catch (_e) {
      }
      window.addEventListener("message", (event) => {
        var _a, _b, _c;
        if (((_a = event.data) == null ? void 0 : _a.type) === "CHAIN_CHANGED") {
          ethereum.emit("chainChanged", (_b = event.data.provider) == null ? void 0 : _b.chainId);
        }
        if (((_c = event.data) == null ? void 0 : _c.type) === "ACCOUNTS_CHANGED") {
          if (ethereum._handleAccountsChanged) {
            ethereum._handleAccountsChanged(event.data.accounts || []);
          }
        }
      });
      verifyInjection().then((verified) => {
        if (!verified) {
          injectionState.lastError = "Injection not verified";
        }
      });
    }
    mountWallet();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        if (kWindow.ethereum && typeof kWindow.dispatchEvent === "function") {
          const ethereum = kWindow.ethereum;
          announceProvider(ethereum);
        }
      });
    }
  })();
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luamVjdGVkL3NvbGFuYS13YWxsZXQtc3RhbmRhcmQudHMiLCAiLi4vc3JjL2luamVjdGVkL3NvbGFuYS13YWxsZXQtcmVnaXN0ZXIudHMiLCAiLi4vc3JjL2luamVjdGVkL3NvbGFuYS1wcm92aWRlci50cyIsICIuLi9zcmMvaW5qZWN0ZWQvdHJvbi1wcm92aWRlci50cyIsICIuLi9zcmMvaW5qZWN0ZWQvaW5qZWN0ZWQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogS2VlcEtleSBTb2xhbmEgV2FsbGV0IFN0YW5kYXJkIGltcGxlbWVudGF0aW9uLlxuICpcbiAqIENvbXBsZXRlbHkgaXNvbGF0ZWQgZnJvbSBFdGhlcmV1bSBFSVAtMTE5MyAvIEVJUC02OTYzIGNvZGUuXG4gKiBSZWdpc3RlcnMgdmlhIHRoZSBXYWxsZXQgU3RhbmRhcmQgcmVnaXN0cnkgc28gZEFwcHMgZGlzY292ZXIgdGhlIHdhbGxldFxuICogd2l0aG91dCB0b3VjaGluZyB3aW5kb3cuc29sYW5hLlxuICovXG5cbmltcG9ydCB0eXBlIHsgQ2hhaW5UeXBlIH0gZnJvbSAnLi90eXBlcyc7XG5cbi8vIC0tLS0tLS0tLS0gQmFzZTU4IChpbmxpbmUsIG5vIGV4dGVybmFsIGRlcCkgLS0tLS0tLS0tLVxuXG5jb25zdCBCQVNFNThfQUxQSEFCRVQgPSAnMTIzNDU2Nzg5QUJDREVGR0hKS0xNTlBRUlNUVVZXWFlaYWJjZGVmZ2hpamttbm9wcXJzdHV2d3h5eic7XG5cbmZ1bmN0aW9uIGJhc2U1OERlY29kZShzdHI6IHN0cmluZyk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBieXRlczogbnVtYmVyW10gPSBbMF07XG4gIGZvciAoY29uc3QgY2hhciBvZiBzdHIpIHtcbiAgICBjb25zdCBpZHggPSBCQVNFNThfQUxQSEFCRVQuaW5kZXhPZihjaGFyKTtcbiAgICBpZiAoaWR4ID09PSAtMSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGJhc2U1OCBjaGFyYWN0ZXInKTtcbiAgICBsZXQgY2FycnkgPSBpZHg7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBieXRlcy5sZW5ndGg7IGorKykge1xuICAgICAgY2FycnkgKz0gYnl0ZXNbal0gKiA1ODtcbiAgICAgIGJ5dGVzW2pdID0gY2FycnkgJiAweGZmO1xuICAgICAgY2FycnkgPj49IDg7XG4gICAgfVxuICAgIHdoaWxlIChjYXJyeSA+IDApIHtcbiAgICAgIGJ5dGVzLnB1c2goY2FycnkgJiAweGZmKTtcbiAgICAgIGNhcnJ5ID4+PSA4O1xuICAgIH1cbiAgfVxuICAvLyBMZWFkaW5nIHplcm9zXG4gIGZvciAoY29uc3QgY2hhciBvZiBzdHIpIHtcbiAgICBpZiAoY2hhciAhPT0gJzEnKSBicmVhaztcbiAgICBieXRlcy5wdXNoKDApO1xuICB9XG4gIHJldHVybiBuZXcgVWludDhBcnJheShieXRlcy5yZXZlcnNlKCkpO1xufVxuXG4vLyAtLS0tLS0tLS0tIFR5cGVzICh3YWxsZXQtc3RhbmRhcmQgc2hhcGVzKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBXYWxsZXRBY2NvdW50IHtcbiAgYWRkcmVzczogc3RyaW5nO1xuICBwdWJsaWNLZXk6IFVpbnQ4QXJyYXk7XG4gIGNoYWluczogcmVhZG9ubHkgc3RyaW5nW107XG4gIGZlYXR1cmVzOiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxudHlwZSBDaGFuZ2VMaXN0ZW5lciA9IChwcm9wczogeyBhY2NvdW50cz86IHJlYWRvbmx5IFdhbGxldEFjY291bnRbXTsgZmVhdHVyZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9KSA9PiB2b2lkO1xuXG4vLyAtLS0tLS0tLS0tIFdhbGxldCBjbGFzcyAtLS0tLS0tLS0tXG5cbmV4cG9ydCBjbGFzcyBLZWVwS2V5U29sYW5hV2FsbGV0IHtcbiAgcmVhZG9ubHkgI3dhbGxldFJlcXVlc3Q6IChcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBwYXJhbXM6IGFueVtdLFxuICAgIGNoYWluOiBDaGFpblR5cGUsXG4gICAgY2FsbGJhY2s6IChlcnJvcjogYW55LCByZXN1bHQ/OiBhbnkpID0+IHZvaWQsXG4gICkgPT4gdm9pZDtcblxuICAjYWNjb3VudHM6IFdhbGxldEFjY291bnRbXSA9IFtdO1xuICAjY2FjaGVkQWRkcmVzczogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHJlYWRvbmx5ICNsaXN0ZW5lcnMgPSBuZXcgU2V0PENoYW5nZUxpc3RlbmVyPigpO1xuXG4gIC8vIFdhbGxldCBTdGFuZGFyZCByZXF1aXJlZCBmaWVsZHNcbiAgcmVhZG9ubHkgdmVyc2lvbiA9ICcxLjAuMCcgYXMgY29uc3Q7XG4gIHJlYWRvbmx5IG5hbWUgPSAnS2VlcEtleSc7XG4gIHJlYWRvbmx5IGljb24gPVxuICAgICdkYXRhOmltYWdlL3BuZztiYXNlNjQsaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUNBQUFBQWdDQVlBQUFCemVucjBBQUFBQVhOU1IwSUFyczRjNlFBQUFFUmxXRWxtVFUwQUtnQUFBQWdBQVlkcEFBUUFBQUFCQUFBQUdnQUFBQUFBQTZBQkFBTUFBQUFCQUFFQUFLQUNBQVFBQUFBQkFBQUFJS0FEQUFRQUFBQUJBQUFBSUFBQUFBQ3NobUx6QUFBRFVrbEVRVlJZQ2IxWFRVZ1VZUmllM2JYRVdoVkxRYVVzZ3dWTG9VdEVRalVKaVpYMEEwR1g3QklaWHVya09UU3ZkbzJrdkVUSEFzT3NoRmdxT3FobFJEOUM3U0dTMUpUQ3NqMWtyVTdQTSt3N3pNek96dXpNcWk4OCs3M3Y5ejd2ejN6enpUZXppdUlnbXFiRmdHNWdCUGd1Rk9ncTRDWExJTXdDbzBBWEVKTjR6eEhrRXVBNmtBSU1rVUJNcU1aazdzby9VRzhBVWNuak9JS3dGWGdIWklnRXdLRm1PSE9mWU80YXlTVmptQW9jN080UjBFQjdsWVM1aDlLMWpCSjZBN0N1QWZYRzdPb3BiS0xYa2g0ZGNjTlo3amxzaTBnQUpsV0xJNWpCUFdGc1RLNUFHeENSSW1zd0ZxREdXYW5EQm82SXNZYmpVYW5GYm1yRldJSHhEM0lzbWZKc2dCNHkyYUp1RjRVclVDNUdudU50eEplRVFxRW9BYjNMSlYrRjRjdGxId2taWERVTHY4ZkVLUUNIQjQrckNKOW5nS2NJR1VUVlJ1YlQwMjd5OHlSOWJPTTRtaEtUVHdOSlpENG1pYURYQUc4ZHF6bE1TaHczWVJDWlJWQXI3dlU0ZzVGL0Q0WkJvSksySCtFbTlDc2ZFZEJvS240SzlqUEFkM0c5c01QcVpFenBSUHpBd1JmV0pwTjlFZlpTUmtBT0U1TEQ3d3J3OGRrcHdSaDU1Vk1tMjdmcXQ0RmlWQmpHQlRheEVtNERiOGQrNEJQdElPSzNBZGJZQ1BDMXFoL2hhR0lTOWdIZ0RlQmJnalRBSWtYQWZUUnhrZ2FhbU1Od0NIZ0IrQk1rNERlY3EwaEdrRlFia2EvV015Wi9FZXlITm82VHVTd3gzTm44Z0hRVklZT2tPaEI1R3A0emNkYkJIaUR2WjJwUnV6b3pydTJldUt1RE91Y2cvS2xpVEFqS0tNYTlrc0JweEJMcmJ6UndWZmlmT25CNFJSMmczUVNIM0NmeDVGUmRjMktvR3N0cm9VZVFLaDQ3dm5Bd1d2VUtqc1BjQS93V2RCVWtqUkFnWmRzem5POEQ1eExHQy9PcHhjM05pUWVWOXVJc2drTkRhVW9NRnBORExsZUFuMGNUUU5CakdhRlc2Zm4yV3JreS9kSTZhYlBPbDllTjlkZW9XaGpMbG9DdjMrYlB5N3czLzlremZ2algxMjBnMWN1U2RzSjQ3eG0xQ2dTOUFheENFcmxiVjZxSjAyVzFucTIybEc3NUF0SUhXUUVlSnBPWWFBVDZnQlFRV0M1WE5DamM3ZGtrSEZLV2U2djNGY0xmYnpSQU1sY0M2SUM2QytnR3hnQ2VjdFpuQ1JNdW9wVkcxditOeDA0c1lJTmx4TEg0d0k2VzUyVUZoVCtRNDFiMk5sMHFlTG53WlBHUXVjTkhyWE42WkRHOTRSUXVPNjg4WGJ3TkZ6dmpsU3V3SDAzd0VXOEgrQmYvZHhyVU9XZGMrSDhtS1h0RXBHcFkzQUFBQUFCSlJVNUVya0pnZ2c9PScgYXMgYGRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCwke3N0cmluZ31gO1xuXG4gIHJlYWRvbmx5IGNoYWlucyA9IFsnc29sYW5hOm1haW5uZXQnXSBhcyBjb25zdDtcblxuICBzdGF0aWMgcmVhZG9ubHkgQUNDT1VOVF9GRUFUVVJFUyA9IFtcbiAgICAnc29sYW5hOnNpZ25UcmFuc2FjdGlvbicsXG4gICAgJ3NvbGFuYTpzaWduQW5kU2VuZFRyYW5zYWN0aW9uJyxcbiAgICAnc29sYW5hOnNpZ25NZXNzYWdlJyxcbiAgXSBhcyBjb25zdDtcblxuICBnZXQgYWNjb3VudHMoKTogcmVhZG9ubHkgV2FsbGV0QWNjb3VudFtdIHtcbiAgICByZXR1cm4gdGhpcy4jYWNjb3VudHM7XG4gIH1cblxuICByZWFkb25seSBmZWF0dXJlcyA9IHtcbiAgICAnc3RhbmRhcmQ6Y29ubmVjdCc6IHtcbiAgICAgIHZlcnNpb246ICcxLjAuMCcgYXMgY29uc3QsXG4gICAgICBjb25uZWN0OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIElmIGFscmVhZHkgY29ubmVjdGVkLCBqdXN0IHJldHVyblxuICAgICAgICBpZiAodGhpcy4jYWNjb3VudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHJldHVybiB7IGFjY291bnRzOiB0aGlzLiNhY2NvdW50cyB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIEVudW1lcmF0ZSBldmVyeSBkZXJpdmVkIGFjY291bnQgc28gdGhlIGRBcHAgY2FuIHBpY2sgYW1vbmcgdGhlbS5cbiAgICAgICAgLy8gRmFsbCBiYWNrIHRvIGEgc2luZ2xlLWFjY291bnQgY29ubmVjdCAoY2FjaGVkL3ZhdWx0KSBpZiBlbnVtZXJhdGlvblxuICAgICAgICAvLyBpcyB1bmF2YWlsYWJsZSAob2xkZXIgYmFja2dyb3VuZCwgZGV2aWNlIG9mZmxpbmUpLlxuICAgICAgICBsZXQgbGlzdDogeyBhZGRyZXNzOiBzdHJpbmcgfVtdIHwgbnVsbCA9IGF3YWl0IHRoaXMuI3JwYygnc29sYW5hX2dldEFjY291bnRzJywgW10pLmNhdGNoKCgpID0+IG51bGwpO1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobGlzdCkgfHwgbGlzdC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBjb25zdCBhZGRyZXNzID0gdGhpcy4jY2FjaGVkQWRkcmVzcyB8fCAoYXdhaXQgdGhpcy4jcnBjKCdzb2xhbmFfY29ubmVjdCcsIFtdKSk7XG4gICAgICAgICAgbGlzdCA9IGFkZHJlc3MgPyBbeyBhZGRyZXNzIH1dIDogW107XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy4jc2V0QWNjb3VudHMobGlzdCk7XG4gICAgICAgIHJldHVybiB7IGFjY291bnRzOiB0aGlzLiNhY2NvdW50cyB9O1xuICAgICAgfSxcbiAgICB9LFxuXG4gICAgJ3N0YW5kYXJkOmRpc2Nvbm5lY3QnOiB7XG4gICAgICB2ZXJzaW9uOiAnMS4wLjAnIGFzIGNvbnN0LFxuICAgICAgZGlzY29ubmVjdDogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLiNycGMoJ3NvbGFuYV9kaXNjb25uZWN0JywgW10pLmNhdGNoKCgpID0+IHt9KTtcbiAgICAgICAgdGhpcy4jYWNjb3VudHMgPSBbXTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSgna2VlcGtleS1zb2xhbmEnKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLyogaWdub3JlICovXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy4jZW1pdENoYW5nZSgpO1xuICAgICAgfSxcbiAgICB9LFxuXG4gICAgJ3N0YW5kYXJkOmV2ZW50cyc6IHtcbiAgICAgIHZlcnNpb246ICcxLjAuMCcgYXMgY29uc3QsXG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGxpc3RlbmVyOiBDaGFuZ2VMaXN0ZW5lcikgPT4ge1xuICAgICAgICBpZiAoZXZlbnQgPT09ICdjaGFuZ2UnKSB7XG4gICAgICAgICAgdGhpcy4jbGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICB0aGlzLiNsaXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG4gICAgfSxcblxuICAgICdzb2xhbmE6c2lnbk1lc3NhZ2UnOiB7XG4gICAgICB2ZXJzaW9uOiAnMS4wLjAnIGFzIGNvbnN0LFxuICAgICAgc2lnbk1lc3NhZ2U6IGFzeW5jICguLi5pbnB1dHM6IHsgbWVzc2FnZTogVWludDhBcnJheTsgYWNjb3VudDogV2FsbGV0QWNjb3VudCB9W10pID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0czogeyBzaWduZWRNZXNzYWdlOiBVaW50OEFycmF5OyBzaWduYXR1cmU6IFVpbnQ4QXJyYXkgfVtdID0gW107XG4gICAgICAgIGZvciAoY29uc3QgeyBtZXNzYWdlLCBhY2NvdW50IH0gb2YgaW5wdXRzKSB7XG4gICAgICAgICAgY29uc3Qgc2lnQXJyYXk6IG51bWJlcltdID0gYXdhaXQgdGhpcy4jcnBjKCdzb2xhbmFfc2lnbk1lc3NhZ2UnLCBbXG4gICAgICAgICAgICBBcnJheS5mcm9tKG1lc3NhZ2UpLFxuICAgICAgICAgICAgeyBhY2NvdW50QWRkcmVzczogYWNjb3VudD8uYWRkcmVzcyB9LFxuICAgICAgICAgIF0pO1xuICAgICAgICAgIG91dHB1dHMucHVzaCh7XG4gICAgICAgICAgICBzaWduZWRNZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgICAgICAgc2lnbmF0dXJlOiBuZXcgVWludDhBcnJheShzaWdBcnJheSksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG91dHB1dHM7XG4gICAgICB9LFxuICAgIH0sXG5cbiAgICAnc29sYW5hOnNpZ25UcmFuc2FjdGlvbic6IHtcbiAgICAgIHZlcnNpb246ICcxLjAuMCcgYXMgY29uc3QsXG4gICAgICBzdXBwb3J0ZWRUcmFuc2FjdGlvblZlcnNpb25zOiBuZXcgU2V0KFsnbGVnYWN5JywgMF0gYXMgY29uc3QpLFxuICAgICAgc2lnblRyYW5zYWN0aW9uOiBhc3luYyAoLi4uaW5wdXRzOiB7IHRyYW5zYWN0aW9uOiBVaW50OEFycmF5OyBhY2NvdW50OiBXYWxsZXRBY2NvdW50OyBjaGFpbj86IHN0cmluZyB9W10pID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0czogeyBzaWduZWRUcmFuc2FjdGlvbjogVWludDhBcnJheSB9W10gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCB7IHRyYW5zYWN0aW9uLCBhY2NvdW50IH0gb2YgaW5wdXRzKSB7XG4gICAgICAgICAgY29uc3Qgc2lnbmVkQXJyYXk6IG51bWJlcltdID0gYXdhaXQgdGhpcy4jcnBjKCdzb2xhbmFfc2lnblRyYW5zYWN0aW9uJywgW1xuICAgICAgICAgICAgQXJyYXkuZnJvbSh0cmFuc2FjdGlvbiksXG4gICAgICAgICAgICB7IGFjY291bnRBZGRyZXNzOiBhY2NvdW50Py5hZGRyZXNzIH0sXG4gICAgICAgICAgXSk7XG4gICAgICAgICAgb3V0cHV0cy5wdXNoKHtcbiAgICAgICAgICAgIHNpZ25lZFRyYW5zYWN0aW9uOiBuZXcgVWludDhBcnJheShzaWduZWRBcnJheSksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG91dHB1dHM7XG4gICAgICB9LFxuICAgIH0sXG5cbiAgICAnc29sYW5hOnNpZ25BbmRTZW5kVHJhbnNhY3Rpb24nOiB7XG4gICAgICB2ZXJzaW9uOiAnMS4wLjAnIGFzIGNvbnN0LFxuICAgICAgc3VwcG9ydGVkVHJhbnNhY3Rpb25WZXJzaW9uczogbmV3IFNldChbJ2xlZ2FjeScsIDBdIGFzIGNvbnN0KSxcbiAgICAgIHNpZ25BbmRTZW5kVHJhbnNhY3Rpb246IGFzeW5jIChcbiAgICAgICAgLi4uaW5wdXRzOiB7IHRyYW5zYWN0aW9uOiBVaW50OEFycmF5OyBhY2NvdW50OiBXYWxsZXRBY2NvdW50OyBjaGFpbj86IHN0cmluZzsgb3B0aW9ucz86IGFueSB9W11cbiAgICAgICkgPT4ge1xuICAgICAgICBjb25zdCBvdXRwdXRzOiB7IHNpZ25hdHVyZTogVWludDhBcnJheSB9W10gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCB7IHRyYW5zYWN0aW9uLCBhY2NvdW50IH0gb2YgaW5wdXRzKSB7XG4gICAgICAgICAgY29uc3QgdHhTaWc6IHN0cmluZyA9IGF3YWl0IHRoaXMuI3JwYygnc29sYW5hX3NpZ25BbmRTZW5kVHJhbnNhY3Rpb24nLCBbXG4gICAgICAgICAgICBBcnJheS5mcm9tKHRyYW5zYWN0aW9uKSxcbiAgICAgICAgICAgIHsgYWNjb3VudEFkZHJlc3M6IGFjY291bnQ/LmFkZHJlc3MgfSxcbiAgICAgICAgICBdKTtcbiAgICAgICAgICAvLyB0eFNpZyBpcyBhIGJhc2U1OCB0cmFuc2FjdGlvbiBzaWduYXR1cmUgc3RyaW5nIFx1MjAxNCBkZWNvZGUgdG8gYnl0ZXNcbiAgICAgICAgICBvdXRwdXRzLnB1c2goe1xuICAgICAgICAgICAgc2lnbmF0dXJlOiBiYXNlNThEZWNvZGUodHhTaWcpLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvdXRwdXRzO1xuICAgICAgfSxcbiAgICB9LFxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFZlbmRvci1uYW1lc3BhY2VkIGV4dGVuc2lvbjogb2ZmLWNoYWluIG1lc3NhZ2Ugc2lnbmluZyBcdTI1MDBcdTI1MDBcbiAgICAvL1xuICAgIC8vIFRoZSBTb2xhbmEgV2FsbGV0IFN0YW5kYXJkIHJlc2VydmVzIHRoZSBgc29sYW5hOmAgbmFtZXNwYWNlIGZvclxuICAgIC8vIHRoZSBjYW5vbmljYWwgc2lnbmluZyBzdXJmYWNlIChzaWduTWVzc2FnZSAvIHNpZ25UcmFuc2FjdGlvbiAvXG4gICAgLy8gc2lnbkFuZFNlbmRUcmFuc2FjdGlvbiAvIHNpZ25JbikuIE9mZi1jaGFpbiBtZXNzYWdlIHNpZ25pbmdcbiAgICAvLyAoaHR0cHM6Ly9naXRodWIuY29tL3NvbGFuYS1sYWJzL3NvbGFuYS9ibG9iL21hc3Rlci9kb2NzL3NyYy9wcm9wb3NhbHMvb2ZmLWNoYWluLW1lc3NhZ2Utc2lnbmluZy5tZClcbiAgICAvLyBpcyBhIGRpZmZlcmVudCBwcmltaXRpdmUgXHUyMDE0IHRoZSBzaWduYXR1cmUgaXMgb3ZlciBhIGRvbWFpbi1cbiAgICAvLyBzZXBhcmF0ZWQgZW52ZWxvcGUsIG5vdCB0aGUgYmFyZSBtZXNzYWdlIFx1MjAxNCBhbmQgaXMgbm90IHBhcnQgb2ZcbiAgICAvLyB0aGUgc3RhbmRhcmQuIFdlIGV4cG9zZSBpdCB1bmRlciBvdXIgd2FsbGV0J3MgbmFtZXNwYWNlIHNvIGRBcHBzXG4gICAgLy8gY2FuIGZlYXR1cmUtZGV0ZWN0OlxuICAgIC8vXG4gICAgLy8gICBjb25zdCBmID0gd2FsbGV0LmZlYXR1cmVzWydrZWVwa2V5OnNpZ25PZmZjaGFpbk1lc3NhZ2UnXVxuICAgIC8vICAgaWYgKGYpIGF3YWl0IGYuc2lnbk9mZmNoYWluTWVzc2FnZSh7IG1lc3NhZ2UsIHZlcnNpb24/LCBtZXNzYWdlRm9ybWF0PyB9KVxuICAgIC8vXG4gICAgLy8gUmV0dXJucyBoZXggYHB1YmxpY0tleWAgKyBoZXggYHNpZ25hdHVyZWAgXHUyMDE0IHZlcmlmaWVycyBNVVNUXG4gICAgLy8gcmVjb25zdHJ1Y3QgdGhlIGVudmVsb3BlIHRvIHZlcmlmeSAoc2VlIHRoZSBoYW5kbGVyIGNvbW1lbnQgaW5cbiAgICAvLyBiYWNrZ3JvdW5kL2NoYWlucy9zb2xhbmFIYW5kbGVyLnRzIGZvciB0aGUgYnl0ZSBsYXlvdXQpLlxuICAgICdrZWVwa2V5OnNpZ25PZmZjaGFpbk1lc3NhZ2UnOiB7XG4gICAgICB2ZXJzaW9uOiAnMS4wLjAnIGFzIGNvbnN0LFxuICAgICAgc2lnbk9mZmNoYWluTWVzc2FnZTogYXN5bmMgKGlucHV0OiB7XG4gICAgICAgIG1lc3NhZ2U6IFVpbnQ4QXJyYXkgfCBzdHJpbmc7XG4gICAgICAgIHZlcnNpb24/OiBudW1iZXI7XG4gICAgICAgIG1lc3NhZ2VGb3JtYXQ/OiBudW1iZXI7XG4gICAgICB9KSA9PiB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2VCeXRlcyA9XG4gICAgICAgICAgdHlwZW9mIGlucHV0Lm1lc3NhZ2UgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IEFycmF5LmZyb20obmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGlucHV0Lm1lc3NhZ2UpKVxuICAgICAgICAgICAgOiBBcnJheS5mcm9tKGlucHV0Lm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm4gKGF3YWl0IHRoaXMuI3JwYygnc29sYW5hX3NpZ25PZmZjaGFpbk1lc3NhZ2UnLCBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbWVzc2FnZTogbWVzc2FnZUJ5dGVzLFxuICAgICAgICAgICAgdmVyc2lvbjogaW5wdXQudmVyc2lvbixcbiAgICAgICAgICAgIG1lc3NhZ2VGb3JtYXQ6IGlucHV0Lm1lc3NhZ2VGb3JtYXQsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSkpIGFzIHsgcHVibGljS2V5OiBzdHJpbmc7IHNpZ25hdHVyZTogc3RyaW5nIH07XG4gICAgICB9LFxuICAgIH0sXG5cbiAgICAnc29sYW5hOnNpZ25Jbic6IHtcbiAgICAgIHZlcnNpb246ICcxLjAuMCcgYXMgY29uc3QsXG4gICAgICBzaWduSW46IGFzeW5jICguLi5pbnB1dHM6IGFueVtdKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dHM6IHsgYWNjb3VudDogV2FsbGV0QWNjb3VudDsgc2lnbmVkTWVzc2FnZTogVWludDhBcnJheTsgc2lnbmF0dXJlOiBVaW50OEFycmF5IH1bXSA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGlucHV0IG9mIGlucHV0cykge1xuICAgICAgICAgIC8vIEVuc3VyZSBjb25uZWN0ZWRcbiAgICAgICAgICBpZiAodGhpcy4jYWNjb3VudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBjb25zdCBhZGRyZXNzID0gdGhpcy4jY2FjaGVkQWRkcmVzcyB8fCAoYXdhaXQgdGhpcy4jcnBjKCdzb2xhbmFfY29ubmVjdCcsIFtdKSk7XG4gICAgICAgICAgICBpZiAoYWRkcmVzcykgdGhpcy4jc2V0Q29ubmVjdGVkKGFkZHJlc3MpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBIb25vciBhIHJlcXVlc3RlZCBzaWduLWluIGFjY291bnQgd2hlbiBpdCBtYXRjaGVzIG9uZSB3ZSBob2xkLlxuICAgICAgICAgIGNvbnN0IGFjY291bnQgPVxuICAgICAgICAgICAgKGlucHV0Py5hZGRyZXNzICYmIHRoaXMuI2FjY291bnRzLmZpbmQoYSA9PiBhLmFkZHJlc3MgPT09IGlucHV0LmFkZHJlc3MpKSB8fCB0aGlzLiNhY2NvdW50c1swXTtcbiAgICAgICAgICBpZiAoIWFjY291bnQpIHRocm93IG5ldyBFcnJvcignTm90IGNvbm5lY3RlZCcpO1xuXG4gICAgICAgICAgLy8gQnVpbGQgU0lXUyBtZXNzYWdlIHBlciBDQUlQLTEyMiAvIEVJUC00MzYxXG4gICAgICAgICAgY29uc3QgZG9tYWluID0gaW5wdXQ/LmRvbWFpbiB8fCBsb2NhdGlvbi5ob3N0O1xuICAgICAgICAgIGNvbnN0IGFkZHJlc3MgPSBpbnB1dD8uYWRkcmVzcyB8fCBhY2NvdW50LmFkZHJlc3M7XG4gICAgICAgICAgY29uc3QgdXJpID0gaW5wdXQ/LnVyaSB8fCBsb2NhdGlvbi5ocmVmO1xuICAgICAgICAgIGNvbnN0IHZlcnNpb24gPSBpbnB1dD8udmVyc2lvbiB8fCAnMSc7XG4gICAgICAgICAgY29uc3QgY2hhaW5JZCA9IGlucHV0Py5jaGFpbklkIHx8ICdtYWlubmV0JztcbiAgICAgICAgICBjb25zdCBub25jZSA9IGlucHV0Py5ub25jZSB8fCBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMik7XG4gICAgICAgICAgY29uc3QgaXNzdWVkQXQgPSBpbnB1dD8uaXNzdWVkQXQgfHwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgIGNvbnN0IHN0YXRlbWVudCA9IGlucHV0Py5zdGF0ZW1lbnQgfHwgJyc7XG5cbiAgICAgICAgICBsZXQgbXNnID0gYCR7ZG9tYWlufSB3YW50cyB5b3UgdG8gc2lnbiBpbiB3aXRoIHlvdXIgU29sYW5hIGFjY291bnQ6XFxuJHthZGRyZXNzfWA7XG4gICAgICAgICAgaWYgKHN0YXRlbWVudCkgbXNnICs9IGBcXG5cXG4ke3N0YXRlbWVudH1gO1xuICAgICAgICAgIG1zZyArPSBgXFxuXFxuVVJJOiAke3VyaX1gO1xuICAgICAgICAgIG1zZyArPSBgXFxuVmVyc2lvbjogJHt2ZXJzaW9ufWA7XG4gICAgICAgICAgbXNnICs9IGBcXG5DaGFpbiBJRDogJHtjaGFpbklkfWA7XG4gICAgICAgICAgbXNnICs9IGBcXG5Ob25jZTogJHtub25jZX1gO1xuICAgICAgICAgIG1zZyArPSBgXFxuSXNzdWVkIEF0OiAke2lzc3VlZEF0fWA7XG4gICAgICAgICAgaWYgKGlucHV0Py5leHBpcmF0aW9uVGltZSkgbXNnICs9IGBcXG5FeHBpcmF0aW9uIFRpbWU6ICR7aW5wdXQuZXhwaXJhdGlvblRpbWV9YDtcbiAgICAgICAgICBpZiAoaW5wdXQ/Lm5vdEJlZm9yZSkgbXNnICs9IGBcXG5Ob3QgQmVmb3JlOiAke2lucHV0Lm5vdEJlZm9yZX1gO1xuICAgICAgICAgIGlmIChpbnB1dD8ucmVxdWVzdElkKSBtc2cgKz0gYFxcblJlcXVlc3QgSUQ6ICR7aW5wdXQucmVxdWVzdElkfWA7XG4gICAgICAgICAgaWYgKGlucHV0Py5yZXNvdXJjZXM/Lmxlbmd0aCkge1xuICAgICAgICAgICAgbXNnICs9IGBcXG5SZXNvdXJjZXM6YDtcbiAgICAgICAgICAgIGZvciAoY29uc3QgciBvZiBpbnB1dC5yZXNvdXJjZXMpIG1zZyArPSBgXFxuLSAke3J9YDtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBtZXNzYWdlQnl0ZXMgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUobXNnKTtcbiAgICAgICAgICBjb25zdCBzaWdBcnJheTogbnVtYmVyW10gPSBhd2FpdCB0aGlzLiNycGMoJ3NvbGFuYV9zaWduTWVzc2FnZScsIFtcbiAgICAgICAgICAgIEFycmF5LmZyb20obWVzc2FnZUJ5dGVzKSxcbiAgICAgICAgICAgIHsgYWNjb3VudEFkZHJlc3M6IGFjY291bnQuYWRkcmVzcyB9LFxuICAgICAgICAgIF0pO1xuXG4gICAgICAgICAgb3V0cHV0cy5wdXNoKHtcbiAgICAgICAgICAgIGFjY291bnQsXG4gICAgICAgICAgICBzaWduZWRNZXNzYWdlOiBtZXNzYWdlQnl0ZXMsXG4gICAgICAgICAgICBzaWduYXR1cmU6IG5ldyBVaW50OEFycmF5KHNpZ0FycmF5KSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3V0cHV0cztcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICB3YWxsZXRSZXF1ZXN0OiAoXG4gICAgICBtZXRob2Q6IHN0cmluZyxcbiAgICAgIHBhcmFtczogYW55W10sXG4gICAgICBjaGFpbjogQ2hhaW5UeXBlLFxuICAgICAgY2FsbGJhY2s6IChlcnJvcjogYW55LCByZXN1bHQ/OiBhbnkpID0+IHZvaWQsXG4gICAgKSA9PiB2b2lkLFxuICApIHtcbiAgICB0aGlzLiN3YWxsZXRSZXF1ZXN0ID0gd2FsbGV0UmVxdWVzdDtcblxuICAgIC8vIFJlc3RvcmUgY2FjaGVkIGFkZHJlc3MgZnJvbSBwcmV2aW91cyBzZXNzaW9uIGZvciBpbnN0YW50IGNvbm5lY3RcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkID0gbG9jYWxTdG9yYWdlLmdldEl0ZW0oJ2tlZXBrZXktc29sYW5hJyk7XG4gICAgICBpZiAoY2FjaGVkKSB7XG4gICAgICAgIGNvbnN0IHsgYWRkcmVzcyB9ID0gSlNPTi5wYXJzZShjYWNoZWQpO1xuICAgICAgICBpZiAoYWRkcmVzcyAmJiB0eXBlb2YgYWRkcmVzcyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICB0aGlzLiNjYWNoZWRBZGRyZXNzID0gYWRkcmVzcztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLyogaWdub3JlICovXG4gICAgfVxuXG4gICAgLy8gU2lsZW50IGNvbm5lY3Q6IHByZS1mZXRjaCBhZGRyZXNzIGZyb20gdmF1bHQgKG5vIHBvcHVwIG5lZWRlZCkuXG4gICAgLy8gT25seSBjYWNoZXMgdGhlIGFkZHJlc3MgXHUyMDE0IGRvZXMgTk9UIHNldCBhY2NvdW50cyAoYWRhcHRlciBuZWVkcyB0b1xuICAgIC8vIGdvIHRocm91Z2ggaXRzIG93biBjb25uZWN0KCkgZmxvdyBmb3IgcHJvcGVyIFJlYWN0IGV2ZW50IGVtaXNzaW9uKS5cbiAgICB0aGlzLiNzaWxlbnRDb25uZWN0KCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tIEludGVybmFsIGhlbHBlcnMgLS0tLS0tLS0tLVxuXG4gICNtYWtlQWNjb3VudChhZGRyZXNzOiBzdHJpbmcpOiBXYWxsZXRBY2NvdW50IHtcbiAgICByZXR1cm4ge1xuICAgICAgYWRkcmVzcyxcbiAgICAgIHB1YmxpY0tleTogYmFzZTU4RGVjb2RlKGFkZHJlc3MpLFxuICAgICAgY2hhaW5zOiBbJ3NvbGFuYTptYWlubmV0J10gYXMgcmVhZG9ubHkgc3RyaW5nW10sXG4gICAgICBmZWF0dXJlczogWy4uLktlZXBLZXlTb2xhbmFXYWxsZXQuQUNDT1VOVF9GRUFUVVJFU10gYXMgcmVhZG9ubHkgc3RyaW5nW10sXG4gICAgfTtcbiAgfVxuXG4gICNzZXRDb25uZWN0ZWQoYWRkcmVzczogc3RyaW5nKSB7XG4gICAgdGhpcy4jYWNjb3VudHMgPSBbdGhpcy4jbWFrZUFjY291bnQoYWRkcmVzcyldO1xuICAgIHRyeSB7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgna2VlcGtleS1zb2xhbmEnLCBKU09OLnN0cmluZ2lmeSh7IGFkZHJlc3MgfSkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogaWdub3JlICovXG4gICAgfVxuICAgIHRoaXMuI2VtaXRDaGFuZ2UoKTtcbiAgfVxuXG4gIC8vIFBvcHVsYXRlIGFjY291bnRzIGZyb20gdGhlIGVudW1lcmF0ZWQgbGlzdCAobXVsdGktYWNjb3VudCkuIFRoZSBkQXBwIHBpY2tzXG4gIC8vIGFuIGFjY291bnQgYW5kIGhhbmRzIGl0IGJhY2sgb24gZWFjaCBzaWduIGNhbGw7IHRoZSBiYWNrZ3JvdW5kIG1hcHMgaXRzXG4gIC8vIGFkZHJlc3MgdG8gdGhlIHJpZ2h0IGRlcml2YXRpb24gcGF0aC5cbiAgI3NldEFjY291bnRzKGxpc3Q6IHsgYWRkcmVzczogc3RyaW5nIH1bXSkge1xuICAgIHRoaXMuI2FjY291bnRzID0gbGlzdC5maWx0ZXIoYSA9PiBhPy5hZGRyZXNzKS5tYXAoYSA9PiB0aGlzLiNtYWtlQWNjb3VudChhLmFkZHJlc3MpKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcHJpbWFyeSA9IHRoaXMuI2FjY291bnRzWzBdPy5hZGRyZXNzO1xuICAgICAgaWYgKHByaW1hcnkpIGxvY2FsU3RvcmFnZS5zZXRJdGVtKCdrZWVwa2V5LXNvbGFuYScsIEpTT04uc3RyaW5naWZ5KHsgYWRkcmVzczogcHJpbWFyeSB9KSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gICAgdGhpcy4jZW1pdENoYW5nZSgpO1xuICB9XG5cbiAgYXN5bmMgI3NpbGVudENvbm5lY3QoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFkZHJlc3M6IHN0cmluZyA9IGF3YWl0IHRoaXMuI3JwYygnc29sYW5hX2Nvbm5lY3QnLCBbXSk7XG4gICAgICBpZiAoYWRkcmVzcyAmJiB0eXBlb2YgYWRkcmVzcyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy4jY2FjaGVkQWRkcmVzcyA9IGFkZHJlc3M7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2tlZXBrZXktc29sYW5hJywgSlNPTi5zdHJpbmdpZnkoeyBhZGRyZXNzIH0pKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLyogaWdub3JlICovXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhdWx0IG5vdCByZWFkeSBvciBkZXZpY2Ugbm90IGNvbm5lY3RlZCBcdTIwMTQgaWdub3JlLlxuICAgICAgLy8gVXNlciBjYW4gbWFudWFsbHkgY29ubmVjdCBsYXRlciB2aWEgc3RhbmRhcmQ6Y29ubmVjdC5cbiAgICB9XG4gIH1cblxuICAjZW1pdENoYW5nZSgpIHtcbiAgICBjb25zdCBhY2NvdW50cyA9IHRoaXMuI2FjY291bnRzO1xuICAgIGNvbnN0IGZlYXR1cmVzID0gdGhpcy5mZWF0dXJlcztcbiAgICB0aGlzLiNsaXN0ZW5lcnMuZm9yRWFjaChmbiA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBmbih7IGFjY291bnRzLCBmZWF0dXJlcyB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBzd2FsbG93IGxpc3RlbmVyIGVycm9yc1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgI3JwYyhtZXRob2Q6IHN0cmluZywgcGFyYW1zOiBhbnlbXSk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuI3dhbGxldFJlcXVlc3QobWV0aG9kLCBwYXJhbXMsICdzb2xhbmEnIGFzIENoYWluVHlwZSwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpO1xuICAgICAgICBlbHNlIHJlc29sdmUocmVzdWx0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiLyoqXG4gKiBSZWdpc3RlciBhIFNvbGFuYSBXYWxsZXQgU3RhbmRhcmQgd2FsbGV0LlxuICpcbiAqIEZvbGxvd3MgdGhlIHdhbGxldC1zdGFuZGFyZCBzcGVjOlxuICogaHR0cHM6Ly9naXRodWIuY29tL3dhbGxldC1zdGFuZGFyZC93YWxsZXQtc3RhbmRhcmRcbiAqXG4gKiBSZWdpc3RyYXRpb24gc3RyYXRlZ3kgKDMgbGF5ZXJzIGZvciBtYXhpbXVtIGNvbXBhdGliaWxpdHkpOlxuICogMS4gUHVzaCByZWdpc3RyYXRpb24gY2FsbGJhY2sgaW50byBuYXZpZ2F0b3Iud2FsbGV0cyBhcnJheSAocXVldWUgcGF0dGVybilcbiAqIDIuIERpc3BhdGNoICd3YWxsZXQtc3RhbmRhcmQ6cmVnaXN0ZXItd2FsbGV0JyBldmVudCBmb3IgYWxyZWFkeS1saXN0ZW5pbmcgYXBwc1xuICogMy4gTGlzdGVuIGZvciAnd2FsbGV0LXN0YW5kYXJkOmFwcC1yZWFkeScgZm9yIGxhdGUtbG9hZGluZyBkQXBwc1xuICpcbiAqIFRoZSBhcnJheS1wdXNoIGFwcHJvYWNoIGlzIGNyaXRpY2FsOiB3YWxsZXQtc3RhbmRhcmQgY3JlYXRlc1xuICogd2luZG93Lm5hdmlnYXRvci53YWxsZXRzIGFzIGFuIGFycmF5LiBXYWxsZXRzIHB1c2ggY2FsbGJhY2tzIGludG8gaXQuXG4gKiBXaGVuIHRoZSBmcmFtZXdvcmsgbG9hZHMsIGl0IGRyYWlucyB0aGUgYXJyYXkgYW5kIGNhbGxzIGVhY2ggY2FsbGJhY2tcbiAqIHdpdGggeyByZWdpc3RlciB9LiBUaGlzIHdvcmtzIHJlZ2FyZGxlc3Mgb2YgbG9hZCBvcmRlci5cbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJTb2xhbmFXYWxsZXQod2FsbGV0OiBhbnkpOiB2b2lkIHtcbiAgLy8gUGVyIHRoZSB3YWxsZXQtc3RhbmRhcmQgc3BlYywgdGhlIGFwcCBwcm92aWRlcyBhbiBBUEkgb2JqZWN0XG4gIC8vIGB7IHJlZ2lzdGVyLCBvbiwgLi4uIH1gIGFuZCB0aGUgd2FsbGV0J3MgY2FsbGJhY2sgcHVsbHMgYHJlZ2lzdGVyYCBvZmYgaXQuXG4gIC8vIFRoaXMgc2FtZSBjYWxsYmFjayBpcyB1c2VkIGJ5IEJPVEggcGF0aHMgYmVsb3cgKHJlZ2lzdGVyLXdhbGxldCBkaXNwYXRjaFxuICAvLyBhbmQgYXBwLXJlYWR5KSwgc28gdGhlIHNoYXBlIGl0IHJlY2VpdmVzIG11c3QgYmUgdGhhdCBBUEkgb2JqZWN0LlxuICBjb25zdCBjYWxsYmFjayA9ICh7IHJlZ2lzdGVyIH06IHsgcmVnaXN0ZXI6ICh3OiBhbnkpID0+IHZvaWQgfSkgPT4ge1xuICAgIHJlZ2lzdGVyKHdhbGxldCk7XG4gIH07XG5cbiAgLy8gTGF5ZXIgMTogUHVzaCBjYWxsYmFjayBpbnRvIG5hdmlnYXRvci53YWxsZXRzIGFycmF5IChsZWdhY3kgcXVldWUgcGF0dGVybixcbiAgLy8gcHJlLXNwZWMpLiBIYXJtbGVzcyBmb3IgbW9kZXJuIGFwcHMgdGhhdCBpZ25vcmUgaXQ7IGhlbHBzIHZlcnkgb2xkIG9uZXMuXG4gIHRyeSB7XG4gICAgY29uc3QgbmF2ID0gd2luZG93Lm5hdmlnYXRvciBhcyBhbnk7XG4gICAgaWYgKCFuYXYud2FsbGV0cykge1xuICAgICAgbmF2LndhbGxldHMgPSBbXTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkobmF2LndhbGxldHMpKSB7XG4gICAgICBuYXYud2FsbGV0cy5wdXNoKGNhbGxiYWNrKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBuYXYud2FsbGV0cy5yZWdpc3RlciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgbmF2LndhbGxldHMucmVnaXN0ZXIod2FsbGV0KTtcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIC8vIGlnbm9yZSBcdTIwMTQgY29udGludWUgd2l0aCBldmVudC1iYXNlZCBmYWxsYmFja1xuICB9XG5cbiAgLy8gTGF5ZXIgMjogQW5ub3VuY2UgdG8gYXBwcyBhbHJlYWR5IGxpc3RlbmluZyBmb3IgYHJlZ2lzdGVyLXdhbGxldGAuIEFwcHNcbiAgLy8gdGhhdCBsb2FkZWQgYmVmb3JlIHVzIGhhdmUgdGhlaXIgcGVyc2lzdGVudCBsaXN0ZW5lciBhdHRhY2hlZCBhbmQgY2F0Y2hcbiAgLy8gdGhpcyBpbW1lZGlhdGVseS4gUmUtYW5ub3VuY2VkIG9uIGEgc2hvcnQgZGVsYXkgYmVjYXVzZSBoZWF2eSBTUEFzXG4gIC8vIChVbmlzd2FwKSBhdHRhY2ggdGhlaXIgbGlzdGVuZXIgQUZURVIgb3VyIGRvY3VtZW50X3N0YXJ0IGRpc3BhdGNoLiBBcHBzXG4gIC8vIGRlZHVwZSBieSB3YWxsZXQtb2JqZWN0IHJlZmVyZW5jZSwgc28gcmUtZGlzcGF0Y2hpbmcgdGhlIHNhbWUgaW5zdGFuY2UgaXNcbiAgLy8gYSBuby1vcCBmb3IgdGhvc2UgdGhhdCBhbHJlYWR5IGhhdmUgaXQuXG4gIGNvbnN0IGFubm91bmNlID0gKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoJ3dhbGxldC1zdGFuZGFyZDpyZWdpc3Rlci13YWxsZXQnLCB7IGRldGFpbDogY2FsbGJhY2sgfSkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gaWdub3JlXG4gICAgfVxuICB9O1xuICBhbm5vdW5jZSgpO1xuICBzZXRUaW1lb3V0KGFubm91bmNlLCAxMDApO1xuICBzZXRUaW1lb3V0KGFubm91bmNlLCAxMDAwKTtcblxuICAvLyBMYXllciAzOiBMYXRlLWxvYWRpbmcgYXBwcyBkaXNwYXRjaCBgd2FsbGV0LXN0YW5kYXJkOmFwcC1yZWFkeWAgd2l0aCB0aGVpclxuICAvLyBBUEkgb2JqZWN0IGFzIGBldmVudC5kZXRhaWxgLiBQZXIgc3BlYyB0aGUgd2FsbGV0IGNhbGxzIGBjYWxsYmFjayhkZXRhaWwpYFxuICAvLyBcdTIwMTQgZGV0YWlsIElTIHRoZSBgeyByZWdpc3Rlciwgb24gfWAgQVBJLCBOT1QgYSBmdW5jdGlvbi4gKFRoZSBwcmV2aW91c1xuICAvLyBgdHlwZW9mIGRldGFpbCA9PT0gJ2Z1bmN0aW9uJ2AgY2hlY2sgaW52ZXJ0ZWQgdGhpcyBhbmQgbmV2ZXIgZmlyZWQgZm9yXG4gIC8vIHNwZWMtY29tcGxpYW50IGFwcHMgbGlrZSBVbmlzd2FwLCBzbyB0aGUgd2FsbGV0IHdhcyBuZXZlciByZWdpc3RlcmVkIHdpdGhcbiAgLy8gZEFwcHMgdGhhdCBpbml0aWFsaXplIGFmdGVyIGluamVjdGlvbi4pXG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCd3YWxsZXQtc3RhbmRhcmQ6YXBwLXJlYWR5JywgKGV2ZW50OiBFdmVudCkgPT4ge1xuICAgIGNvbnN0IGFwaSA9IChldmVudCBhcyBDdXN0b21FdmVudCkuZGV0YWlsO1xuICAgIHRyeSB7XG4gICAgICBpZiAoYXBpICYmIHR5cGVvZiBhcGkucmVnaXN0ZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY2FsbGJhY2soYXBpKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGFwaSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyBUb2xlcmF0ZSBhIG5vbi1zdGFuZGFyZCBzaGFwZSB3aGVyZSBkZXRhaWwgaXMgaXRzZWxmIHRoZSBjYWxsYmFjay5cbiAgICAgICAgYXBpKGNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGlnbm9yZVxuICAgIH1cbiAgfSk7XG59XG4iLCAiLyoqXG4gKiBLZWVwS2V5IGxlZ2FjeSBgd2luZG93LnNvbGFuYWAgcHJvdmlkZXIgXHUyMDE0IGEgUGhhbnRvbS1jb21wYXRpYmxlIHNoaW0gZm9yXG4gKiBkQXBwcyB0aGF0IHByZWRhdGUgdGhlIFNvbGFuYSBXYWxsZXQgU3RhbmRhcmQgYW5kIHNuaWZmIHRoZSBnbG9iYWxcbiAqIGB3aW5kb3cuc29sYW5hYCBvYmplY3QgZGlyZWN0bHkgKG1vc3Qgb2YgdGhlbSB2aWFcbiAqIGBAc29sYW5hL3dhbGxldC1hZGFwdGVyLXBoYW50b21gLCB3aGljaCBnYXRlcyBkZXRlY3Rpb24gb25cbiAqIGB3aW5kb3cuc29sYW5hLmlzUGhhbnRvbSA9PT0gdHJ1ZWApLlxuICpcbiAqIFRoaXMgaXMgdGhlIFwibWFza2luZ1wiIGNvdW50ZXJwYXJ0IHRvIHRoZSBFVk0gYHdpbmRvdy5ldGhlcmV1bWAgL1xuICogYGlzTWV0YU1hc2tgIHNoaW06IGl0IGlzIG1vdW50ZWQgb25seSB3aGVuIFBoYW50b20gbWFza2luZyBpcyBlbmFibGVkXG4gKiAoZGVmYXVsdCBvbikgYW5kIG9ubHkgaWYgbm90aGluZyBlbHNlIGhhcyBhbHJlYWR5IGNsYWltZWRcbiAqIGB3aW5kb3cuc29sYW5hYC4gTW9kZXJuIGRBcHBzIGNvbnRpbnVlIHRvIGRpc2NvdmVyIEtlZXBLZXkgdmlhIHRoZVxuICogV2FsbGV0IFN0YW5kYXJkIHJlZ2lzdHJ5IChzZWUgc29sYW5hLXdhbGxldC1zdGFuZGFyZC50cykgcmVnYXJkbGVzcyBvZlxuICogdGhpcyBwcm92aWRlci5cbiAqXG4gKiBBbGwgc2lnbmluZyByb3V0ZXMgdGhyb3VnaCB0aGUgZXhhY3Qgc2FtZSBiYWNrZ3JvdW5kIFJQQyBtZXRob2RzIHRoZVxuICogV2FsbGV0IFN0YW5kYXJkIHdhbGxldCB1c2VzIChgc29sYW5hX2Nvbm5lY3RgLCBgc29sYW5hX3NpZ25NZXNzYWdlYCxcbiAqIGBzb2xhbmFfc2lnblRyYW5zYWN0aW9uYCwgYHNvbGFuYV9zaWduQW5kU2VuZFRyYW5zYWN0aW9uYCxcbiAqIGBzb2xhbmFfZGlzY29ubmVjdGApIFx1MjAxNCBubyBuZXcgYmFja2dyb3VuZCBoYW5kbGVycyBhcmUgcmVxdWlyZWQuXG4gKlxuICogVHJhbnNhY3Rpb24gaGFuZGxpbmcgaXMgZHVjay10eXBlZCBzbyB3ZSBuZXZlciBoYXZlIHRvIGJ1bmRsZVxuICogQHNvbGFuYS93ZWIzLmpzOiB0aGUgZEFwcCBoYW5kcyB1cyBhIGBUcmFuc2FjdGlvbmAgb3JcbiAqIGBWZXJzaW9uZWRUcmFuc2FjdGlvbmAsIHdlIHNlcmlhbGl6ZSBpdCB3aXRoIGl0cyBvd24gYHNlcmlhbGl6ZSgpYCxcbiAqIHNpZ24gdGhlIGJ5dGVzIHZpYSB0aGUgZGV2aWNlLCB0aGVuIGdyYWZ0IHRoZSByZXR1cm5lZCBmZWUtcGF5ZXJcbiAqIHNpZ25hdHVyZSBiYWNrIG9udG8gdGhlIG9yaWdpbmFsIG9iamVjdCB3aXRoIGl0cyBvd24gYGFkZFNpZ25hdHVyZSgpYC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IENoYWluVHlwZSB9IGZyb20gJy4vdHlwZXMnO1xuXG50eXBlIFdhbGxldFJlcXVlc3RGbiA9IChcbiAgbWV0aG9kOiBzdHJpbmcsXG4gIHBhcmFtczogYW55W10sXG4gIGNoYWluOiBDaGFpblR5cGUsXG4gIGNhbGxiYWNrOiAoZXJyb3I6IGFueSwgcmVzdWx0PzogYW55KSA9PiB2b2lkLFxuKSA9PiB2b2lkO1xuXG4vLyAtLS0tLS0tLS0tIEJhc2U1OCAoaW5saW5lLCBubyBleHRlcm5hbCBkZXApIC0tLS0tLS0tLS1cblxuY29uc3QgQkFTRTU4X0FMUEhBQkVUID0gJzEyMzQ1Njc4OUFCQ0RFRkdISktMTU5QUVJTVFVWV1hZWmFiY2RlZmdoaWprbW5vcHFyc3R1dnd4eXonO1xuXG5mdW5jdGlvbiBiYXNlNThEZWNvZGUoc3RyOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcbiAgY29uc3QgYnl0ZXM6IG51bWJlcltdID0gWzBdO1xuICBmb3IgKGNvbnN0IGNoYXIgb2Ygc3RyKSB7XG4gICAgY29uc3QgaWR4ID0gQkFTRTU4X0FMUEhBQkVULmluZGV4T2YoY2hhcik7XG4gICAgaWYgKGlkeCA9PT0gLTEpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBiYXNlNTggY2hhcmFjdGVyJyk7XG4gICAgbGV0IGNhcnJ5ID0gaWR4O1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgYnl0ZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgIGNhcnJ5ICs9IGJ5dGVzW2pdICogNTg7XG4gICAgICBieXRlc1tqXSA9IGNhcnJ5ICYgMHhmZjtcbiAgICAgIGNhcnJ5ID4+PSA4O1xuICAgIH1cbiAgICB3aGlsZSAoY2FycnkgPiAwKSB7XG4gICAgICBieXRlcy5wdXNoKGNhcnJ5ICYgMHhmZik7XG4gICAgICBjYXJyeSA+Pj0gODtcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBjaGFyIG9mIHN0cikge1xuICAgIGlmIChjaGFyICE9PSAnMScpIGJyZWFrO1xuICAgIGJ5dGVzLnB1c2goMCk7XG4gIH1cbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ5dGVzLnJldmVyc2UoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gUHVibGljS2V5LWxpa2Ugc2hhcGUgLS0tLS0tLS0tLVxuLy9cbi8vIGRBcHBzIHJlYWQgYHdpbmRvdy5zb2xhbmEucHVibGljS2V5YCBhbmQgdHlwaWNhbGx5IGNhbGwgYC50b1N0cmluZygpYCxcbi8vIGAudG9CYXNlNTgoKWAsIGAudG9CeXRlcygpYCBvciBgLmVxdWFscygpYC4gV2UgZXhwb3NlIGEgbGlnaHR3ZWlnaHRcbi8vIGR1Y2stdHlwZWQgb2JqZWN0IHJhdGhlciB0aGFuIGNvbnN0cnVjdGluZyBhIHdlYjMuanMgUHVibGljS2V5LlxuXG5pbnRlcmZhY2UgUHVibGljS2V5TGlrZSB7XG4gIHRvU3RyaW5nKCk6IHN0cmluZztcbiAgdG9CYXNlNTgoKTogc3RyaW5nO1xuICB0b0J5dGVzKCk6IFVpbnQ4QXJyYXk7XG4gIHRvQnVmZmVyKCk6IFVpbnQ4QXJyYXk7XG4gIGVxdWFscyhvdGhlcjogYW55KTogYm9vbGVhbjtcbn1cblxuZnVuY3Rpb24gbWFrZVB1YmxpY0tleShhZGRyZXNzOiBzdHJpbmcpOiBQdWJsaWNLZXlMaWtlIHtcbiAgY29uc3QgYnl0ZXMgPSBiYXNlNThEZWNvZGUoYWRkcmVzcyk7XG4gIHJldHVybiB7XG4gICAgdG9TdHJpbmc6ICgpID0+IGFkZHJlc3MsXG4gICAgdG9CYXNlNTg6ICgpID0+IGFkZHJlc3MsXG4gICAgdG9CeXRlczogKCkgPT4gYnl0ZXMsXG4gICAgdG9CdWZmZXI6ICgpID0+IGJ5dGVzLFxuICAgIGVxdWFsczogKG90aGVyOiBhbnkpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBvdGhlcj8udG9CYXNlNTg/LigpID09PSBhZGRyZXNzIHx8IG90aGVyPy50b1N0cmluZz8uKCkgPT09IGFkZHJlc3M7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gVHJhbnNhY3Rpb24gaGVscGVycyAoZHVjay10eXBlZCwgbm8gd2ViMy5qcykgLS0tLS0tLS0tLVxuXG4vLyBWZXJzaW9uZWRUcmFuc2FjdGlvbiBleHBvc2VzIGEgYHZlcnNpb25gIGdldHRlciAoJ2xlZ2FjeScgfCAwKSBhbmQgYVxuLy8gYC5tZXNzYWdlYDsgbGVnYWN5IHdlYjMuanMgVHJhbnNhY3Rpb24gaGFzIG5laXRoZXIuXG5mdW5jdGlvbiBpc1ZlcnNpb25lZFRyYW5zYWN0aW9uKHR4OiBhbnkpOiBib29sZWFuIHtcbiAgcmV0dXJuIHR4ICE9IG51bGwgJiYgdHlwZW9mIHR4ID09PSAnb2JqZWN0JyAmJiAndmVyc2lvbicgaW4gdHggJiYgdHgubWVzc2FnZSAhPSBudWxsO1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemVGb3JTaWduaW5nKHR4OiBhbnkpOiBVaW50OEFycmF5IHtcbiAgaWYgKCF0eCB8fCB0eXBlb2YgdHguc2VyaWFsaXplICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbnN1cHBvcnRlZCB0cmFuc2FjdGlvbjogbWlzc2luZyBzZXJpYWxpemUoKScpO1xuICB9XG4gIGlmIChpc1ZlcnNpb25lZFRyYW5zYWN0aW9uKHR4KSkge1xuICAgIC8vIHNlcmlhbGl6ZSgpIGluY2x1ZGVzIHRoZSAoZW1wdHkpIHNpZ25hdHVyZSBwbGFjZWhvbGRlcnMuXG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KHR4LnNlcmlhbGl6ZSgpKTtcbiAgfVxuICAvLyBMZWdhY3kgVHJhbnNhY3Rpb246IGFsbG93IHNlcmlhbGl6YXRpb24gYmVmb3JlIHRoZSBmZWUtcGF5ZXIgaGFzIHNpZ25lZC5cbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KHR4LnNlcmlhbGl6ZSh7IHJlcXVpcmVBbGxTaWduYXR1cmVzOiBmYWxzZSwgdmVyaWZ5U2lnbmF0dXJlczogZmFsc2UgfSkpO1xufVxuXG4vLyBFeHRyYWN0IHRoZSBmZWUtcGF5ZXIgKHNpZ25lciBpbmRleCAwKSBzaWduYXR1cmUgXHUyMDE0IHRoZSBmaXJzdCA2NCBieXRlc1xuLy8gYWZ0ZXIgdGhlIHNob3J0dmVjIHNpZ25hdHVyZSBjb3VudC4gRm9yIGFueSByZWFsaXN0aWMgdHJhbnNhY3Rpb24gdGhlXG4vLyBjb3VudCBpcyA8IDEyOCwgc28gdGhlIHNob3J0dmVjIHByZWZpeCBpcyBhIHNpbmdsZSBieXRlLlxuZnVuY3Rpb24gZXh0cmFjdEZlZVBheWVyU2lnbmF0dXJlKHNpZ25lZDogVWludDhBcnJheSk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBjb3VudCA9IHNpZ25lZFswXTtcbiAgaWYgKCFjb3VudCkgdGhyb3cgbmV3IEVycm9yKCdTaWduZWQgdHJhbnNhY3Rpb24gaGFzIG5vIHNpZ25hdHVyZXMnKTtcbiAgaWYgKGNvdW50ICYgMHg4MCkgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIG11bHRpLWJ5dGUgc2lnbmF0dXJlIGNvdW50Jyk7XG4gIHJldHVybiBzaWduZWQuc2xpY2UoMSwgMSArIDY0KTtcbn1cblxuLy8gVGhlIGZlZSBwYXllciBpcyB0aGUgc2lnbmVyIGF0IGFjY291bnQgaW5kZXggMC4gUHVsbCB0aGUgUHVibGljS2V5XG4vLyBzdHJhaWdodCBvZmYgdGhlIHRyYW5zYWN0aW9uIHRoZSBkQXBwIGdhdmUgdXMgc28gd2UgbmV2ZXIgY29uc3RydWN0IG9uZS5cbmZ1bmN0aW9uIGZlZVBheWVyS2V5KHR4OiBhbnkpOiBhbnkge1xuICBpZiAoaXNWZXJzaW9uZWRUcmFuc2FjdGlvbih0eCkpIHtcbiAgICBjb25zdCBrZXlzID0gdHgubWVzc2FnZT8uc3RhdGljQWNjb3VudEtleXM7XG4gICAgaWYgKGtleXMgJiYga2V5cy5sZW5ndGgpIHJldHVybiBrZXlzWzBdO1xuICAgIHRocm93IG5ldyBFcnJvcignVmVyc2lvbmVkIHRyYW5zYWN0aW9uIG1pc3NpbmcgYWNjb3VudCBrZXlzJyk7XG4gIH1cbiAgaWYgKHR4LmZlZVBheWVyKSByZXR1cm4gdHguZmVlUGF5ZXI7XG4gIGNvbnN0IHNpZzAgPSB0eC5zaWduYXR1cmVzPy5bMF07XG4gIGlmIChzaWcwPy5wdWJsaWNLZXkpIHJldHVybiBzaWcwLnB1YmxpY0tleTtcbiAgdGhyb3cgbmV3IEVycm9yKCdMZWdhY3kgdHJhbnNhY3Rpb24gbWlzc2luZyBmZWUgcGF5ZXInKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBQcm92aWRlciAtLS0tLS0tLS0tXG5cbnR5cGUgRXZlbnROYW1lID0gJ2Nvbm5lY3QnIHwgJ2Rpc2Nvbm5lY3QnIHwgJ2FjY291bnRDaGFuZ2VkJztcblxuZXhwb3J0IGNsYXNzIEtlZXBLZXlTb2xhbmFQcm92aWRlciB7XG4gIHJlYWRvbmx5ICN3YWxsZXRSZXF1ZXN0OiBXYWxsZXRSZXF1ZXN0Rm47XG4gIHJlYWRvbmx5ICNsaXN0ZW5lcnMgPSBuZXcgTWFwPEV2ZW50TmFtZSwgU2V0PEZ1bmN0aW9uPj4oKTtcblxuICAjcHVibGljS2V5OiBQdWJsaWNLZXlMaWtlIHwgbnVsbCA9IG51bGw7XG4gICNjYWNoZWRBZGRyZXNzOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAvLyBJZGVudGl0eSBmbGFncy4gYGlzUGhhbnRvbWAgaXMgdGhlIGltcGVyc29uYXRpb24gdGhhdCBsZWdhY3lcbiAgLy8gd2FsbGV0LWFkYXB0ZXItcGhhbnRvbSBkQXBwcyBnYXRlIG9uOyBpdCBpcyBvbmx5IGV2ZXIgc2V0IGJlY2F1c2UgdGhlXG4gIC8vIHVzZXIgbGVmdCBQaGFudG9tIG1hc2tpbmcgZW5hYmxlZCAoc2VlIGluamVjdGVkLnRzIG1vdW50IGdhdGUpLlxuICByZWFkb25seSBpc1BoYW50b20gPSB0cnVlO1xuICByZWFkb25seSBpc0tlZXBLZXkgPSB0cnVlO1xuXG4gIGNvbnN0cnVjdG9yKHdhbGxldFJlcXVlc3Q6IFdhbGxldFJlcXVlc3RGbikge1xuICAgIHRoaXMuI3dhbGxldFJlcXVlc3QgPSB3YWxsZXRSZXF1ZXN0O1xuXG4gICAgLy8gUmVzdG9yZSBjYWNoZWQgYWRkcmVzcyBmcm9tIGEgcHJldmlvdXMgc2Vzc2lvbiBmb3IgYW4gaW5zdGFudCBjb25uZWN0LlxuICAgIC8vIFNoYXJlcyB0aGUgc2FtZSBjYWNoZSBrZXkgYXMgdGhlIFdhbGxldCBTdGFuZGFyZCB3YWxsZXQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlZCA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKCdrZWVwa2V5LXNvbGFuYScpO1xuICAgICAgaWYgKGNhY2hlZCkge1xuICAgICAgICBjb25zdCB7IGFkZHJlc3MgfSA9IEpTT04ucGFyc2UoY2FjaGVkKTtcbiAgICAgICAgaWYgKGFkZHJlc3MgJiYgdHlwZW9mIGFkZHJlc3MgPT09ICdzdHJpbmcnKSB0aGlzLiNjYWNoZWRBZGRyZXNzID0gYWRkcmVzcztcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGlnbm9yZSAqL1xuICAgIH1cblxuICAgIC8vIFNpbGVudCBwcmUtZmV0Y2ggb2YgdGhlIGFkZHJlc3MgKG5vIHBvcHVwKSBzbyBjb25uZWN0KCkgcmVzb2x2ZXNcbiAgICAvLyBpbnN0YW50bHkuIERvZXMgTk9UIG1hcmsgdGhlIHByb3ZpZGVyIGNvbm5lY3RlZCBcdTIwMTQgZEFwcHMgbXVzdCBjYWxsXG4gICAgLy8gY29ubmVjdCgpIHRvIHRyYW5zaXRpb24gc3RhdGUsIG1hdGNoaW5nIFBoYW50b20ncyBjb250cmFjdC5cbiAgICB0aGlzLiNzaWxlbnRDb25uZWN0KCk7XG4gIH1cblxuICBnZXQgcHVibGljS2V5KCk6IFB1YmxpY0tleUxpa2UgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy4jcHVibGljS2V5O1xuICB9XG5cbiAgZ2V0IGlzQ29ubmVjdGVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLiNwdWJsaWNLZXkgIT09IG51bGw7XG4gIH1cblxuICAvLyAtLS0tIENvbm5lY3Rpb24gLS0tLVxuXG4gIGFzeW5jIGNvbm5lY3QoX29wdHM/OiB7IG9ubHlJZlRydXN0ZWQ/OiBib29sZWFuIH0pOiBQcm9taXNlPHsgcHVibGljS2V5OiBQdWJsaWNLZXlMaWtlIH0+IHtcbiAgICBpZiAodGhpcy4jcHVibGljS2V5KSByZXR1cm4geyBwdWJsaWNLZXk6IHRoaXMuI3B1YmxpY0tleSB9O1xuICAgIGNvbnN0IGFkZHJlc3M6IHN0cmluZyA9IHRoaXMuI2NhY2hlZEFkZHJlc3MgfHwgKGF3YWl0IHRoaXMuI3JwYygnc29sYW5hX2Nvbm5lY3QnLCBbXSkpO1xuICAgIGlmICghYWRkcmVzcykgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gY29ubmVjdCB0byBLZWVwS2V5Jyk7XG4gICAgdGhpcy4jc2V0Q29ubmVjdGVkKGFkZHJlc3MpO1xuICAgIHJldHVybiB7IHB1YmxpY0tleTogdGhpcy4jcHVibGljS2V5ISB9O1xuICB9XG5cbiAgYXN5bmMgZGlzY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLiNycGMoJ3NvbGFuYV9kaXNjb25uZWN0JywgW10pLmNhdGNoKCgpID0+IHt9KTtcbiAgICB0aGlzLiNwdWJsaWNLZXkgPSBudWxsO1xuICAgIHRyeSB7XG4gICAgICBsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSgna2VlcGtleS1zb2xhbmEnKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGlnbm9yZSAqL1xuICAgIH1cbiAgICB0aGlzLiNlbWl0KCdkaXNjb25uZWN0Jyk7XG4gIH1cblxuICAvLyAtLS0tIFNpZ25pbmcgLS0tLVxuXG4gIGFzeW5jIHNpZ25NZXNzYWdlKFxuICAgIG1lc3NhZ2U6IFVpbnQ4QXJyYXksXG4gICAgX2Rpc3BsYXk/OiAndXRmOCcgfCAnaGV4JyxcbiAgKTogUHJvbWlzZTx7IHNpZ25hdHVyZTogVWludDhBcnJheTsgcHVibGljS2V5OiBQdWJsaWNLZXlMaWtlIH0+IHtcbiAgICBhd2FpdCB0aGlzLiNlbnN1cmVDb25uZWN0ZWQoKTtcbiAgICBjb25zdCBzaWdBcnJheTogbnVtYmVyW10gPSBhd2FpdCB0aGlzLiNycGMoJ3NvbGFuYV9zaWduTWVzc2FnZScsIFtBcnJheS5mcm9tKG1lc3NhZ2UpXSk7XG4gICAgcmV0dXJuIHsgc2lnbmF0dXJlOiBuZXcgVWludDhBcnJheShzaWdBcnJheSksIHB1YmxpY0tleTogdGhpcy4jcHVibGljS2V5IGFzIFB1YmxpY0tleUxpa2UgfTtcbiAgfVxuXG4gIGFzeW5jIHNpZ25UcmFuc2FjdGlvbjxUID0gYW55Pih0cmFuc2FjdGlvbjogVCk6IFByb21pc2U8VD4ge1xuICAgIGF3YWl0IHRoaXMuI2Vuc3VyZUNvbm5lY3RlZCgpO1xuICAgIGNvbnN0IGJ5dGVzID0gc2VyaWFsaXplRm9yU2lnbmluZyh0cmFuc2FjdGlvbik7XG4gICAgY29uc3Qgc2lnbmVkQXJyYXk6IG51bWJlcltdID0gYXdhaXQgdGhpcy4jcnBjKCdzb2xhbmFfc2lnblRyYW5zYWN0aW9uJywgW0FycmF5LmZyb20oYnl0ZXMpXSk7XG4gICAgY29uc3Qgc2lnbmVkID0gbmV3IFVpbnQ4QXJyYXkoc2lnbmVkQXJyYXkpO1xuICAgIGNvbnN0IHNpZ25hdHVyZSA9IGV4dHJhY3RGZWVQYXllclNpZ25hdHVyZShzaWduZWQpO1xuICAgIC8vIEdyYWZ0IHRoZSBkZXZpY2Ugc2lnbmF0dXJlIGJhY2sgb250byB0aGUgZEFwcCdzIG93biBvYmplY3Qgc28gaXQgY2FuXG4gICAgLy8gc2VyaWFsaXplL2Jyb2FkY2FzdCBpdC4gQm90aCBUcmFuc2FjdGlvbiBhbmQgVmVyc2lvbmVkVHJhbnNhY3Rpb25cbiAgICAvLyBhY2NlcHQgYSA2NC1ieXRlIFVpbnQ4QXJyYXkgaGVyZS5cbiAgICAodHJhbnNhY3Rpb24gYXMgYW55KS5hZGRTaWduYXR1cmUoZmVlUGF5ZXJLZXkodHJhbnNhY3Rpb24pLCBzaWduYXR1cmUpO1xuICAgIHJldHVybiB0cmFuc2FjdGlvbjtcbiAgfVxuXG4gIGFzeW5jIHNpZ25BbGxUcmFuc2FjdGlvbnM8VCA9IGFueT4odHJhbnNhY3Rpb25zOiBUW10pOiBQcm9taXNlPFRbXT4ge1xuICAgIGNvbnN0IG91dDogVFtdID0gW107XG4gICAgZm9yIChjb25zdCB0eCBvZiB0cmFuc2FjdGlvbnMpIHtcbiAgICAgIG91dC5wdXNoKGF3YWl0IHRoaXMuc2lnblRyYW5zYWN0aW9uKHR4KSk7XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG4gIH1cblxuICBhc3luYyBzaWduQW5kU2VuZFRyYW5zYWN0aW9uKFxuICAgIHRyYW5zYWN0aW9uOiBhbnksXG4gICAgX29wdGlvbnM/OiBhbnksXG4gICk6IFByb21pc2U8eyBzaWduYXR1cmU6IHN0cmluZzsgcHVibGljS2V5OiBQdWJsaWNLZXlMaWtlIH0+IHtcbiAgICBhd2FpdCB0aGlzLiNlbnN1cmVDb25uZWN0ZWQoKTtcbiAgICBjb25zdCBieXRlcyA9IHNlcmlhbGl6ZUZvclNpZ25pbmcodHJhbnNhY3Rpb24pO1xuICAgIGNvbnN0IHNpZ25hdHVyZTogc3RyaW5nID0gYXdhaXQgdGhpcy4jcnBjKCdzb2xhbmFfc2lnbkFuZFNlbmRUcmFuc2FjdGlvbicsIFtBcnJheS5mcm9tKGJ5dGVzKV0pO1xuICAgIHJldHVybiB7IHNpZ25hdHVyZSwgcHVibGljS2V5OiB0aGlzLiNwdWJsaWNLZXkgYXMgUHVibGljS2V5TGlrZSB9O1xuICB9XG5cbiAgLy8gR2VuZXJpYyBkaXNwYXRjaGVyIGZvciBkQXBwcyB0aGF0IGRyaXZlIHRoZSBwcm92aWRlciB2aWEgcmVxdWVzdCgpLlxuICBhc3luYyByZXF1ZXN0KHsgbWV0aG9kLCBwYXJhbXMgfTogeyBtZXRob2Q6IHN0cmluZzsgcGFyYW1zPzogYW55IH0pOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IHAgPSBBcnJheS5pc0FycmF5KHBhcmFtcykgPyBwYXJhbXMgOiBwYXJhbXMgIT0gbnVsbCA/IFtwYXJhbXNdIDogW107XG4gICAgc3dpdGNoIChtZXRob2QpIHtcbiAgICAgIGNhc2UgJ2Nvbm5lY3QnOlxuICAgICAgICByZXR1cm4gdGhpcy5jb25uZWN0KHBbMF0pO1xuICAgICAgY2FzZSAnZGlzY29ubmVjdCc6XG4gICAgICAgIHJldHVybiB0aGlzLmRpc2Nvbm5lY3QoKTtcbiAgICAgIGNhc2UgJ3NpZ25UcmFuc2FjdGlvbic6XG4gICAgICAgIHJldHVybiB0aGlzLnNpZ25UcmFuc2FjdGlvbihwWzBdPy50cmFuc2FjdGlvbiA/PyBwWzBdKTtcbiAgICAgIGNhc2UgJ3NpZ25BbGxUcmFuc2FjdGlvbnMnOlxuICAgICAgICByZXR1cm4gdGhpcy5zaWduQWxsVHJhbnNhY3Rpb25zKHBbMF0/LnRyYW5zYWN0aW9ucyA/PyBwWzBdKTtcbiAgICAgIGNhc2UgJ3NpZ25BbmRTZW5kVHJhbnNhY3Rpb24nOlxuICAgICAgICByZXR1cm4gdGhpcy5zaWduQW5kU2VuZFRyYW5zYWN0aW9uKHBbMF0/LnRyYW5zYWN0aW9uID8/IHBbMF0sIHBbMF0/Lm9wdGlvbnMgPz8gcFsxXSk7XG4gICAgICBjYXNlICdzaWduTWVzc2FnZSc6XG4gICAgICAgIHJldHVybiB0aGlzLnNpZ25NZXNzYWdlKHBbMF0/Lm1lc3NhZ2UgPz8gcFswXSwgcFswXT8uZGlzcGxheSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEtlZXBLZXkgKFNvbGFuYSk6IHVuc3VwcG9ydGVkIG1ldGhvZCBcIiR7bWV0aG9kfVwiYCk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSBFdmVudHMgKEV2ZW50RW1pdHRlci1pc2gsIFBoYW50b20gc3VyZmFjZSkgLS0tLVxuXG4gIG9uKGV2ZW50OiBFdmVudE5hbWUsIGhhbmRsZXI6IEZ1bmN0aW9uKTogdGhpcyB7XG4gICAgaWYgKCF0aGlzLiNsaXN0ZW5lcnMuaGFzKGV2ZW50KSkgdGhpcy4jbGlzdGVuZXJzLnNldChldmVudCwgbmV3IFNldCgpKTtcbiAgICB0aGlzLiNsaXN0ZW5lcnMuZ2V0KGV2ZW50KSEuYWRkKGhhbmRsZXIpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgb2ZmKGV2ZW50OiBFdmVudE5hbWUsIGhhbmRsZXI6IEZ1bmN0aW9uKTogdGhpcyB7XG4gICAgdGhpcy4jbGlzdGVuZXJzLmdldChldmVudCk/LmRlbGV0ZShoYW5kbGVyKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHJlbW92ZUxpc3RlbmVyKGV2ZW50OiBFdmVudE5hbWUsIGhhbmRsZXI6IEZ1bmN0aW9uKTogdGhpcyB7XG4gICAgcmV0dXJuIHRoaXMub2ZmKGV2ZW50LCBoYW5kbGVyKTtcbiAgfVxuXG4gIHJlbW92ZUFsbExpc3RlbmVycyhldmVudD86IEV2ZW50TmFtZSk6IHRoaXMge1xuICAgIGlmIChldmVudCkgdGhpcy4jbGlzdGVuZXJzLmRlbGV0ZShldmVudCk7XG4gICAgZWxzZSB0aGlzLiNsaXN0ZW5lcnMuY2xlYXIoKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIC0tLS0gSW50ZXJuYWwgLS0tLVxuXG4gICNlbWl0KGV2ZW50OiBFdmVudE5hbWUsIC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgdGhpcy4jbGlzdGVuZXJzLmdldChldmVudCk/LmZvckVhY2goZm4gPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZm4oLi4uYXJncyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gc3dhbGxvdyBsaXN0ZW5lciBlcnJvcnNcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gICNzZXRDb25uZWN0ZWQoYWRkcmVzczogc3RyaW5nKSB7XG4gICAgdGhpcy4jcHVibGljS2V5ID0gbWFrZVB1YmxpY0tleShhZGRyZXNzKTtcbiAgICB0aGlzLiNjYWNoZWRBZGRyZXNzID0gYWRkcmVzcztcbiAgICB0cnkge1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2tlZXBrZXktc29sYW5hJywgSlNPTi5zdHJpbmdpZnkoeyBhZGRyZXNzIH0pKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGlnbm9yZSAqL1xuICAgIH1cbiAgICB0aGlzLiNlbWl0KCdjb25uZWN0JywgdGhpcy4jcHVibGljS2V5KTtcbiAgfVxuXG4gIGFzeW5jICNlbnN1cmVDb25uZWN0ZWQoKSB7XG4gICAgaWYgKHRoaXMuI3B1YmxpY0tleSkgcmV0dXJuO1xuICAgIGF3YWl0IHRoaXMuY29ubmVjdCgpO1xuICB9XG5cbiAgYXN5bmMgI3NpbGVudENvbm5lY3QoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFkZHJlc3M6IHN0cmluZyA9IGF3YWl0IHRoaXMuI3JwYygnc29sYW5hX2Nvbm5lY3QnLCBbXSk7XG4gICAgICBpZiAoYWRkcmVzcyAmJiB0eXBlb2YgYWRkcmVzcyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy4jY2FjaGVkQWRkcmVzcyA9IGFkZHJlc3M7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2tlZXBrZXktc29sYW5hJywgSlNPTi5zdHJpbmdpZnkoeyBhZGRyZXNzIH0pKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLyogaWdub3JlICovXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhdWx0IG5vdCByZWFkeSBvciBkZXZpY2UgZGlzY29ubmVjdGVkIFx1MjAxNCBjb25uZWN0KCkgd2lsbCByZXRyeSBsYXRlci5cbiAgICB9XG4gIH1cblxuICAjcnBjKG1ldGhvZDogc3RyaW5nLCBwYXJhbXM6IGFueVtdKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy4jd2FsbGV0UmVxdWVzdChtZXRob2QsIHBhcmFtcywgJ3NvbGFuYScgYXMgQ2hhaW5UeXBlLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvcik7XG4gICAgICAgIGVsc2UgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICIvKipcbiAqIEtlZXBLZXkgVHJvbiBwcm92aWRlciBcdTIwMTQgaW5qZWN0cyBgd2luZG93LnRyb25MaW5rYCBhbmQgYHdpbmRvdy50cm9uV2ViYFxuICogc2hpbXMgdGhhdCBtaXJyb3IgVHJvbkxpbmsncyBBUEkgc3VyZmFjZSwgcm91dGluZyBzaWduaW5nIG9wZXJhdGlvbnMgdG9cbiAqIHRoZSBleHRlbnNpb24gYmFja2dyb3VuZCAoYW5kIHVsdGltYXRlbHkgdGhlIEtlZXBLZXkgZGV2aWNlIHZpYSB0aGVcbiAqIHZhdWx0IFJFU1QgQVBJKSB3aGlsZSBkZWxlZ2F0aW5nIHJlYWRzL2J1aWxkcy9icm9hZGNhc3RzIHRvIFRyb25HcmlkLlxuICpcbiAqIFNjb3BlIG9mIHRoaXMgTVZQOlxuICogICAtIFRyYW5zZmVyQ29udHJhY3QgKG5hdGl2ZSBUUlgpIHNpZ25pbmdcbiAqICAgLSBUcmlnZ2VyU21hcnRDb250cmFjdCBgdHJhbnNmZXIoYWRkcmVzcyx1aW50MjU2KWAgc2lnbmluZyAoVFJDMjAsIGUuZy4gVVNEVClcbiAqICAgLSBSZWFkLW9ubHkgUlBDIGFuZCB0cmFuc2FjdGlvbkJ1aWxkZXIuc2VuZFRyeCB2aWEgVHJvbkdyaWRcbiAqXG4gKiBTdXBwb3J0ZWQgKGZpcm13YXJlIDcuMTQuMSspOlxuICogICAtIHNpZ25NZXNzYWdlIC8gc2lnbk1lc3NhZ2VWMiBcdTIwMTQgVElQLTE5MSBwZXJzb25hbF9zaWduXG4gKlxuICogT3V0IG9mIHNjb3BlIChub3Qgb24gdHJvbldlYi50cng7IHJlYWNoYWJsZSBvbmx5IHZpYSB0cm9uTGluay5yZXF1ZXN0KTpcbiAqICAgLSB0cm9uX3ZlcmlmeU1lc3NhZ2UgXHUyMDE0IGJvb2xlYW4gY2hlY2sgYWdhaW5zdCBhIGtub3duIGFkZHJlc3MuIFdlXG4gKiAgICAgZG9uJ3QgZXhwb3NlIHZlcmlmeU1lc3NhZ2UgLyB2ZXJpZnlNZXNzYWdlVjIgb24gdHJvbldlYi50cnhcbiAqICAgICBiZWNhdXNlIFRyb25XZWIgVjIncyBjb250cmFjdCBpcyB2ZXJpZnlNZXNzYWdlVjIobWVzc2FnZSwgc2lnKVxuICogICAgIHJldHVybmluZyB0aGUgcmVjb3ZlcmVkIGFkZHJlc3MsIGFuZCBvdXIgZW5kcG9pbnQgc2hhcGVcbiAqICAgICAoYWRkcmVzcyByZXF1aXJlZCwgYm9vbGVhbiByZXR1cm5lZCkgZG9lc24ndCBtYXRjaC5cbiAqICAgICBWZXJpZmljYXRpb24gaXMgY2xpZW50LXNpZGUgYW55d2F5IFx1MjAxNCB1c2UgVHJvbldlYidzIHN0YXRpY1xuICogICAgIHV0aWxpdGllcy5cbiAqICAgLSB0cm9uX3NpZ25UeXBlZEhhc2ggKFRJUC03MTIgaGFzaCBtb2RlKSBcdTIwMTQgY2FsbFxuICogICAgIHdpbmRvdy50cm9uTGluay5yZXF1ZXN0KHsgbWV0aG9kOiAndHJvbl9zaWduVHlwZWRIYXNoJywgcGFyYW1zOlxuICogICAgIFt7IGRvbWFpblNlcGFyYXRvckhhc2gsIG1lc3NhZ2VIYXNoIH1dIH0pIHdpdGggcHJlLWNvbXB1dGVkXG4gKiAgICAgMzItYnl0ZSBoYXNoZXMuIFdlIGRvbid0IHNoaXAgYSBzdHJ1Y3QgXHUyMTkyIGhhc2ggaW1wbGVtZW50YXRpb24sXG4gKiAgICAgc28gd2UgZG9uJ3QgZXhwb3NlIF9zaWduVHlwZWREYXRhIC8gc2lnblR5cGVkRGF0YSBvblxuICogICAgIHRyb25XZWIudHJ4IHdoZXJlIHRoZSBjb250cmFjdCB0YWtlcyAoZG9tYWluLCB0eXBlcywgdmFsdWUpLlxuICogICAtIE5vbi1gdHJhbnNmZXJgIHNtYXJ0IGNvbnRyYWN0IGNhbGxzIChyZXF1aXJlcyBmaXJtd2FyZSBkaXNwbGF5IHN1cHBvcnQpXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBDaGFpblR5cGUgfSBmcm9tICcuL3R5cGVzJztcblxudHlwZSBXYWxsZXRSZXF1ZXN0Rm4gPSAoXG4gIG1ldGhvZDogc3RyaW5nLFxuICBwYXJhbXM6IGFueVtdLFxuICBjaGFpbjogQ2hhaW5UeXBlLFxuICBjYWxsYmFjazogKGVycm9yOiBhbnksIHJlc3VsdD86IGFueSkgPT4gdm9pZCxcbikgPT4gdm9pZDtcblxuY29uc3QgVFJPTkdSSURfVVJMID0gJ2h0dHBzOi8vYXBpLnRyb25ncmlkLmlvJztcblxuLy8gU3Vic2V0IG9mIGJzNTggdXNlZCB0byBjb252ZXJ0IGJldHdlZW4gVHJvbiBiYXNlNTggYW5kIGhleCBhZGRyZXNzZXMuXG4vLyBBIGZ1bGwgYmFzZTU4IGltcGwgYWxyZWFkeSBsaXZlcyBpbiBzb2xhbmEtd2FsbGV0LXN0YW5kYXJkLnRzIGJ1dCBpdCdzXG4vLyBzY29wZWQgdG8gdGhhdCBtb2R1bGUsIGFuZCBkdXBsaWNhdGluZyB+MjAgbGluZXMgaGVyZSBhdm9pZHMgaGF2aW5nIHRvXG4vLyB3aWRlbiB0aGF0IG1vZHVsZSdzIHB1YmxpYyBzdXJmYWNlIGZvciBhbiB1bnJlbGF0ZWQgY2hhaW4uXG5jb25zdCBCNThfQUxQSEFCRVQgPSAnMTIzNDU2Nzg5QUJDREVGR0hKS0xNTlBRUlNUVVZXWFlaYWJjZGVmZ2hpamttbm9wcXJzdHV2d3h5eic7XG5cbmZ1bmN0aW9uIGJhc2U1OERlY29kZShzdHI6IHN0cmluZyk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBieXRlczogbnVtYmVyW10gPSBbMF07XG4gIGZvciAoY29uc3QgY2hhciBvZiBzdHIpIHtcbiAgICBjb25zdCBpZHggPSBCNThfQUxQSEFCRVQuaW5kZXhPZihjaGFyKTtcbiAgICBpZiAoaWR4ID09PSAtMSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGJhc2U1OCBjaGFyYWN0ZXInKTtcbiAgICBsZXQgY2FycnkgPSBpZHg7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBieXRlcy5sZW5ndGg7IGorKykge1xuICAgICAgY2FycnkgKz0gYnl0ZXNbal0gKiA1ODtcbiAgICAgIGJ5dGVzW2pdID0gY2FycnkgJiAweGZmO1xuICAgICAgY2FycnkgPj49IDg7XG4gICAgfVxuICAgIHdoaWxlIChjYXJyeSA+IDApIHtcbiAgICAgIGJ5dGVzLnB1c2goY2FycnkgJiAweGZmKTtcbiAgICAgIGNhcnJ5ID4+PSA4O1xuICAgIH1cbiAgfVxuICBmb3IgKGNvbnN0IGNoYXIgb2Ygc3RyKSB7XG4gICAgaWYgKGNoYXIgIT09ICcxJykgYnJlYWs7XG4gICAgYnl0ZXMucHVzaCgwKTtcbiAgfVxuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnl0ZXMucmV2ZXJzZSgpKTtcbn1cblxuZnVuY3Rpb24gdG9IZXhTdHJpbmcoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGZvciAoY29uc3QgYiBvZiBieXRlcykgb3V0ICs9IGIudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBUcm9uIGJhc2U1OCBhZGRyZXNzZXMgZGVjb2RlIHRvIDI1IGJ5dGVzOiAweDQxIHByZWZpeCArIDIwLWJ5dGUgaGFzaCArIDQtYnl0ZSBjaGVja3N1bS4gKi9cbmZ1bmN0aW9uIGJhc2U1OFRvSGV4KGFkZHI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJ5dGVzID0gYmFzZTU4RGVjb2RlKGFkZHIpO1xuICBpZiAoYnl0ZXMubGVuZ3RoICE9PSAyNSB8fCBieXRlc1swXSAhPT0gMHg0MSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBUcm9uIGFkZHJlc3M6ICR7YWRkcn1gKTtcbiAgfVxuICByZXR1cm4gdG9IZXhTdHJpbmcoYnl0ZXMuc2xpY2UoMCwgMjEpKTtcbn1cblxuZnVuY3Rpb24gaXNUcm9uQmFzZTU4KGFkZHI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAodHlwZW9mIGFkZHIgIT09ICdzdHJpbmcnIHx8IGFkZHIubGVuZ3RoICE9PSAzNCB8fCAhYWRkci5zdGFydHNXaXRoKCdUJykpIHJldHVybiBmYWxzZTtcbiAgdHJ5IHtcbiAgICBiYXNlNThUb0hleChhZGRyKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmNsYXNzIEV2ZW50RW1pdHRlciB7XG4gIHByaXZhdGUgZXZlbnRzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxGdW5jdGlvbj4+KCk7XG4gIG9uKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgaWYgKCF0aGlzLmV2ZW50cy5oYXMoZXZlbnQpKSB0aGlzLmV2ZW50cy5zZXQoZXZlbnQsIG5ldyBTZXQoKSk7XG4gICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KSEuYWRkKGhhbmRsZXIpO1xuICB9XG4gIG9mZihldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikge1xuICAgIHRoaXMuZXZlbnRzLmdldChldmVudCk/LmRlbGV0ZShoYW5kbGVyKTtcbiAgfVxuICBlbWl0KGV2ZW50OiBzdHJpbmcsIC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZm9yRWFjaChoID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGgoLi4uYXJncyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc3dhbGxvdyB0byBrZWVwIG90aGVyIGxpc3RlbmVycyBhbGl2ZSAqL1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogQnJpZGdlcyBhIG9uZS1zaG90IGB3YWxsZXRSZXF1ZXN0YCBjYWxsYmFjay1zdHlsZSBBUEkgaW50byBhIFByb21pc2UuXG4gKiBUaGUgaW5qZWN0ZWQgcGlwZWxpbmUgaXMgY2FsbGJhY2stYmFzZWQgc28gcmVzcG9uc2UtYnktcmVxdWVzdElkXG4gKiBkaXNwYXRjaCBpcyBwb3NzaWJsZSwgYnV0IGV2ZXJ5IGNvbnN1bWVyIGhlcmUgd2FudHMgYSBQcm9taXNlLlxuICovXG5mdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHdhbGxldFJlcXVlc3Q6IFdhbGxldFJlcXVlc3RGbiwgbWV0aG9kOiBzdHJpbmcsIHBhcmFtczogYW55W10pOiBQcm9taXNlPGFueT4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIHdhbGxldFJlcXVlc3QobWV0aG9kLCBwYXJhbXMsICd0cm9uJywgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKTtcbiAgICAgIGVsc2UgcmVzb2x2ZShyZXN1bHQpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLyoqXG4gKiBUcm9uR3JpZCBHRVRzIGFyZSB1c2VkIGZvciByZWFkLW9ubHkgcXVlcmllcy4gQWxsIFBPU1RzIGhlcmUgaGl0XG4gKiBUcm9uR3JpZCBkaXJlY3RseSByYXRoZXIgdGhhbiByb3V0aW5nIHRocm91Z2ggdGhlIGV4dGVuc2lvbiBcdTIwMTQgdGhlcmUnc1xuICogbm90aGluZyBzZW5zaXRpdmUgYWJvdXQgcmVhZGluZyBjaGFpbiBzdGF0ZSwgYW5kIGtlZXBpbmcgdGhlIHJvdW5kLXRyaXBcbiAqIHNob3J0IG1hdHRlcnMgZm9yIGRBcHAgVVguXG4gKlxuICogUGVyLXJlcXVlc3QgdGltZW91dCArIG9uZSByZXRyeSBvbiA1eHgvdHJhbnNpZW50IGVycm9ycyBzbyBhIHN0YWxsZWRcbiAqIFRyb25HcmlkIGVkZ2UgY2FuJ3QgaGFuZyBkQXBwIGZsb3dzIChtb3N0IHBhaW5mdWwgb24gYnJvYWRjYXN0cyB2aWFcbiAqIC93YWxsZXQvYnJvYWRjYXN0dHJhbnNhY3Rpb24pLiBMaXZlcyBpbmxpbmUgYmVjYXVzZSB0aGlzIGZpbGUgaXNcbiAqIGJ1bmRsZWQgaW50byB0aGUgaW5qZWN0ZWQgc2NyaXB0IFx1MjAxNCBpdCBjYW4ndCBpbXBvcnQgZnJvbSB0aGVcbiAqIGJhY2tncm91bmQncyBmZXRjaFV0aWxzLlxuICovXG5jb25zdCBUUk9OR1JJRF9USU1FT1VUX01TID0gODAwMDtcbmNvbnN0IFRST05HUklEX0JST0FEQ0FTVF9USU1FT1VUX01TID0gMTIwMDA7XG5jb25zdCBpc1RyYW5zaWVudFRyb25TdGF0dXMgPSAoc3RhdHVzOiBudW1iZXIpID0+IHN0YXR1cyA+PSA1MDAgJiYgc3RhdHVzIDwgNjAwO1xuXG5hc3luYyBmdW5jdGlvbiB0cm9uR3JpZFBvc3QocGF0aDogc3RyaW5nLCBib2R5OiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICBjb25zdCBpc0Jyb2FkY2FzdCA9IHBhdGguaW5jbHVkZXMoJ2Jyb2FkY2FzdHRyYW5zYWN0aW9uJyk7XG4gIGNvbnN0IHRpbWVvdXRNcyA9IGlzQnJvYWRjYXN0ID8gVFJPTkdSSURfQlJPQURDQVNUX1RJTUVPVVRfTVMgOiBUUk9OR1JJRF9USU1FT1VUX01TO1xuICBjb25zdCBtYXhBdHRlbXB0cyA9IDI7XG4gIGxldCBsYXN0RXJyOiBhbnk7XG4gIGZvciAobGV0IGF0dGVtcHQgPSAxOyBhdHRlbXB0IDw9IG1heEF0dGVtcHRzOyBhdHRlbXB0KyspIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKGAke1RST05HUklEX1VSTH0ke3BhdGh9YCwge1xuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgICAgICBzaWduYWw6IEFib3J0U2lnbmFsLnRpbWVvdXQodGltZW91dE1zKSxcbiAgICAgIH0pO1xuICAgICAgaWYgKCFyZXNwLm9rKSB7XG4gICAgICAgIGlmIChpc1RyYW5zaWVudFRyb25TdGF0dXMocmVzcC5zdGF0dXMpICYmIGF0dGVtcHQgPCBtYXhBdHRlbXB0cykge1xuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHIgPT4gc2V0VGltZW91dChyLCAyMDAgKiBhdHRlbXB0KSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlc3AudGV4dCgpLmNhdGNoKCgpID0+ICcnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcm9uR3JpZCAke3BhdGh9IGZhaWxlZCAoJHtyZXNwLnN0YXR1c30pOiAke3RleHR9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gYXdhaXQgcmVzcC5qc29uKCk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBsYXN0RXJyID0gZTtcbiAgICAgIC8vIFRpbWVvdXQgLyBuZXR3b3JrIFx1MjAxNCB3b3J0aCBvbmUgcmV0cnkuIEJhaWwgb24gdGhlIHNlY29uZCBhdHRlbXB0XG4gICAgICAvLyBzbyBhIGZ1bGx5LWRvd24gVHJvbkdyaWQgZG9lc24ndCBsb2NrIHRoZSBkQXBwIGZvciB+MjRzLlxuICAgICAgaWYgKGF0dGVtcHQgPCBtYXhBdHRlbXB0cykge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgMjAwICogYXR0ZW1wdCkpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgdGhyb3cgbGFzdEVycjtcbn1cblxuZXhwb3J0IGNsYXNzIEtlZXBLZXlUcm9uUHJvdmlkZXIge1xuICByZWFkb25seSB0cm9uV2ViOiBhbnk7XG4gIHJlYWRvbmx5IHRyb25MaW5rOiBhbnk7XG5cbiAgcHJpdmF0ZSBhZGRyZXNzOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBoZXhBZGRyZXNzOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWFkb25seSBlbWl0dGVyID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHdhbGxldFJlcXVlc3Q6IFdhbGxldFJlcXVlc3RGbjtcblxuICBjb25zdHJ1Y3Rvcih3YWxsZXRSZXF1ZXN0OiBXYWxsZXRSZXF1ZXN0Rm4pIHtcbiAgICB0aGlzLndhbGxldFJlcXVlc3QgPSB3YWxsZXRSZXF1ZXN0O1xuICAgIHRoaXMudHJvbldlYiA9IHRoaXMuYnVpbGRUcm9uV2ViKCk7XG4gICAgdGhpcy50cm9uTGluayA9IHRoaXMuYnVpbGRUcm9uTGluaygpO1xuICB9XG5cbiAgLyoqIFBvcHVsYXRlIGNhY2hlZCBhZGRyZXNzIHN0YXRlIFx1MjAxNCBjYWxsZWQgYWZ0ZXIgYSBzdWNjZXNzZnVsIGNvbm5lY3QuICovXG4gIHNldEFkZHJlc3MoYWRkcmVzczogc3RyaW5nKSB7XG4gICAgaWYgKCFhZGRyZXNzIHx8ICFpc1Ryb25CYXNlNTgoYWRkcmVzcykpIHJldHVybjtcbiAgICB0aGlzLmFkZHJlc3MgPSBhZGRyZXNzO1xuICAgIHRoaXMuaGV4QWRkcmVzcyA9IGJhc2U1OFRvSGV4KGFkZHJlc3MpO1xuXG4gICAgdGhpcy50cm9uV2ViLnJlYWR5ID0gdHJ1ZTtcbiAgICB0aGlzLnRyb25XZWIuZGVmYXVsdEFkZHJlc3MgPSB7XG4gICAgICBiYXNlNTg6IGFkZHJlc3MsXG4gICAgICBoZXg6IHRoaXMuaGV4QWRkcmVzcyxcbiAgICAgIG5hbWU6ICdLZWVwS2V5JyxcbiAgICAgIHR5cGU6IDEsXG4gICAgfTtcbiAgICB0aGlzLnRyb25MaW5rLnJlYWR5ID0gdHJ1ZTtcblxuICAgIC8vIFRyb25MaW5rIGZpcmVzIGBtZXNzYWdlYCBldmVudHMgd2l0aCBkYXRhLm1lc3NhZ2UuYWN0aW9uID0gJ3NldEFjY291bnQnXG4gICAgLy8gLyAnc2V0Tm9kZScgLyAnYWNjb3VudHNDaGFuZ2VkJy4gZEFwcHMgb2Z0ZW4gbGlzdGVuIGZvciB0aGVzZSB0b1xuICAgIC8vIHJlYWN0IHRvIGFjY291bnQgY2hhbmdlcyB3aXRob3V0IHBvbGxpbmcgYGRlZmF1bHRBZGRyZXNzYC5cbiAgICB0aGlzLmZpcmVNZXNzYWdlKCdzZXRBY2NvdW50JywgeyBhZGRyZXNzLCBuYW1lOiAnS2VlcEtleScsIHR5cGU6IDEgfSk7XG4gICAgdGhpcy5maXJlTWVzc2FnZSgnYWNjb3VudHNDaGFuZ2VkJywgeyBhZGRyZXNzIH0pO1xuICB9XG5cbiAgLyoqIEVtaXQgYSBUcm9uTGluay1jb21wYXRpYmxlIGBtZXNzYWdlYCBldmVudCBvbiB0aGUgd2luZG93LiAqL1xuICBwcml2YXRlIGZpcmVNZXNzYWdlKGFjdGlvbjogc3RyaW5nLCBkYXRhOiBhbnkpIHtcbiAgICB0cnkge1xuICAgICAgd2luZG93LnBvc3RNZXNzYWdlKFxuICAgICAgICB7XG4gICAgICAgICAgbWVzc2FnZToge1xuICAgICAgICAgICAgYWN0aW9uLFxuICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGlzVHJvbkxpbms6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4sXG4gICAgICApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogcG9zdE1lc3NhZ2UgY2FuIGZhaWwgaW4gc2FuZGJveGVkIGZyYW1lczsgaWdub3JlICovXG4gICAgfVxuICAgIHRoaXMuZW1pdHRlci5lbWl0KGFjdGlvbiwgZGF0YSk7XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkVHJvbkxpbmsoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC8vIFRyb24gZEFwcHMgaGF2ZSBubyBtdWx0aS13YWxsZXQgZGlzY292ZXJ5IHN0YW5kYXJkLCBzbyBtb3N0XG4gICAgICAvLyBnYXRlIG9uIHRoaXMgZmxhZyB0byBkZWNpZGUgd2hldGhlciB0byBzdXJmYWNlIGEgXCJDb25uZWN0XG4gICAgICAvLyBUcm9uTGlua1wiIGJ1dHRvbiB2cy4gYSBkZWVwLWxpbmsgdG8gaW5zdGFsbCBUcm9uTGluay4gV2Ugc2V0XG4gICAgICAvLyBpdCB0byB0cnVlIHRvIGJlIHRyZWF0ZWQgYXMgdGhlIGNvbXBhdGlibGUgcHJvdmlkZXIgXHUyMDE0IG91clxuICAgICAgLy8gYXBwcm92YWwgVUkgc3RpbGwgaWRlbnRpZmllcyBhcyBLZWVwS2V5LCBzbyB0aGVyZSdzIG5vIFVYXG4gICAgICAvLyBkZWNlcHRpb24sIGp1c3QgZGV0ZWN0aW9uLWJ5cGFzcy5cbiAgICAgIGlzVHJvbkxpbms6IHRydWUsXG4gICAgICByZWFkeTogZmFsc2UsXG4gICAgICB0cm9uV2ViOiBudWxsIGFzIGFueSwgLy8gUG9wdWxhdGVkIGJlbG93LCBhZnRlciB0cm9uV2ViIGV4aXN0cy5cbiAgICAgIHJlcXVlc3Q6IGFzeW5jICh7IG1ldGhvZCwgcGFyYW1zIH06IHsgbWV0aG9kOiBzdHJpbmc7IHBhcmFtcz86IGFueSB9KTogUHJvbWlzZTxhbnk+ID0+IHtcbiAgICAgICAgc3dpdGNoIChtZXRob2QpIHtcbiAgICAgICAgICBjYXNlICd0cm9uX3JlcXVlc3RBY2NvdW50cyc6XG4gICAgICAgICAgY2FzZSAndHJvbl9hY2NvdW50cyc6IHtcbiAgICAgICAgICAgIGNvbnN0IGFkZHJlc3MgPSBhd2FpdCBwcm9taXNpZnlSZXF1ZXN0KHRoaXMud2FsbGV0UmVxdWVzdCwgJ3Ryb25fcmVxdWVzdEFjY291bnRzJywgW10pO1xuICAgICAgICAgICAgaWYgKCFhZGRyZXNzIHx8IHR5cGVvZiBhZGRyZXNzICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICByZXR1cm4geyBjb2RlOiA0MDAxLCBtZXNzYWdlOiAnVXNlciBkZW5pZWQgYWNjb3VudCBhY2Nlc3MnIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnNldEFkZHJlc3MoYWRkcmVzcyk7XG4gICAgICAgICAgICByZXR1cm4geyBjb2RlOiAyMDAsIG1lc3NhZ2U6ICdvaycgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIC8vIFRyb25MaW5rJ3MgcmVxdWVzdCgpIHBhc3NlcyBhcmJpdHJhcnkgbWV0aG9kcyB0aHJvdWdoIFx1MjAxNFxuICAgICAgICAgICAgLy8gbWlycm9yIHRoYXQgcmF0aGVyIHRoYW4gd2hpdGVsaXN0aW5nLCBzbyBmdXR1cmUgbWV0aG9kXG4gICAgICAgICAgICAvLyBhZGRpdGlvbnMgb24gdGhlIGhhbmRsZXIgc2lkZSB3b3JrIHdpdGhvdXQgY2hhbmdpbmcgdGhpc1xuICAgICAgICAgICAgLy8gZmlsZS5cbiAgICAgICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KHRoaXMud2FsbGV0UmVxdWVzdCwgbWV0aG9kLCBBcnJheS5pc0FycmF5KHBhcmFtcykgPyBwYXJhbXMgOiBbcGFyYW1zXSk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB0aGlzLmVtaXR0ZXIub24oZXZlbnQsIGhhbmRsZXIpLFxuICAgICAgb2ZmOiAoZXZlbnQ6IHN0cmluZywgaGFuZGxlcjogRnVuY3Rpb24pID0+IHRoaXMuZW1pdHRlci5vZmYoZXZlbnQsIGhhbmRsZXIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkVHJvbldlYigpIHtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcblxuICAgIGNvbnN0IHRyeCA9IHtcbiAgICAgIHNpZ246IGFzeW5jICh0eDogYW55LCBwcml2YXRlS2V5Pzogc3RyaW5nLCB1c2VUcm9uSGVhZGVyPzogYm9vbGVhbiwgb3B0aW9ucz86IGFueSkgPT4ge1xuICAgICAgICAvLyBgdHJvbldlYi50cnguc2lnbmAgYWNjZXB0cyB0d28gc2hhcGVzOlxuICAgICAgICAvLyAgIC0gYSBmdWxsIHRyYW5zYWN0aW9uIG9iamVjdDogeyB0eElELCByYXdfZGF0YSwgcmF3X2RhdGFfaGV4LCAuLi4gfVxuICAgICAgICAvLyAgIC0gYSBoZXggc3RyaW5nOiBtZXNzYWdlIHRvIHNpZ24gKHJlcXVpcmVzIHVzZVRyb25IZWFkZXIgaGFuZGxpbmcpXG4gICAgICAgIC8vIFdlIG9ubHkgaW1wbGVtZW50IHRoZSBmaXJzdCBzaGFwZSBoZXJlOyBtZXNzYWdlLXN0cmluZyBzaWduaW5nXG4gICAgICAgIC8vIHVzZXMgc2lnbk1lc3NhZ2UuXG4gICAgICAgIGlmICh0eXBlb2YgdHggPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCd0cm9uV2ViLnRyeC5zaWduKG1lc3NhZ2UpIG5vdCBzdXBwb3J0ZWQgXHUyMDE0IHVzZSB0cm9uV2ViLnRyeC5zaWduTWVzc2FnZSgpJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0eCB8fCAhdHgucmF3X2RhdGFfaGV4KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCd0cm9uV2ViLnRyeC5zaWduIGV4cGVjdHMgYSBidWlsdCB0cmFuc2FjdGlvbiB3aXRoIHJhd19kYXRhX2hleCcpO1xuICAgICAgICB9XG4gICAgICAgIC8vIHByaXZhdGVLZXkvdXNlVHJvbkhlYWRlci9vcHRpb25zIGFyZSBpZ25vcmVkIFx1MjAxNCB3ZSBhbHdheXMgc2lnblxuICAgICAgICAvLyB3aXRoIHRoZSBLZWVwS2V5IGRldmljZSwgbm90IGFuIGluLW1lbW9yeSBrZXkuIFRocm93aW5nIG9uIGFcbiAgICAgICAgLy8gcGFzc2VkLWluIGtleSB3b3VsZCBicmVhayBkQXBwcyB0aGF0IHBhc3MgdW5kZWZpbmVkIGRlZmVuc2l2ZWx5LlxuICAgICAgICB2b2lkIHByaXZhdGVLZXk7XG4gICAgICAgIHZvaWQgdXNlVHJvbkhlYWRlcjtcbiAgICAgICAgdm9pZCBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IHNpZ25lZCA9IGF3YWl0IHByb21pc2lmeVJlcXVlc3Qoc2VsZi53YWxsZXRSZXF1ZXN0LCAndHJvbl9zaWduJywgW3R4XSk7XG4gICAgICAgIHJldHVybiBzaWduZWQ7XG4gICAgICB9LFxuXG4gICAgICAvLyBUSVAtMTkxIFYxIFx1MjAxNCBtZXNzYWdlIGlzIGhleCAod2l0aCBvciB3aXRob3V0IDB4KS5cbiAgICAgIC8vIHByaXZhdGVLZXkgYXJnIGlzIGlnbm9yZWQgKHNpZ25pbmcgYWx3YXlzIGhhcHBlbnMgb24gdGhlIGRldmljZSkuXG4gICAgICBzaWduTWVzc2FnZTogYXN5bmMgKG1lc3NhZ2U6IHN0cmluZywgcHJpdmF0ZUtleT86IHN0cmluZykgPT4ge1xuICAgICAgICB2b2lkIHByaXZhdGVLZXk7XG4gICAgICAgIHJldHVybiBhd2FpdCBwcm9taXNpZnlSZXF1ZXN0KHNlbGYud2FsbGV0UmVxdWVzdCwgJ3Ryb25fc2lnbk1lc3NhZ2UnLCBbbWVzc2FnZV0pO1xuICAgICAgfSxcblxuICAgICAgLy8gVElQLTE5MSBWMiBcdTIwMTQgbWVzc2FnZSBpcyBVVEYtOCBzdHJpbmcuXG4gICAgICBzaWduTWVzc2FnZVYyOiBhc3luYyAobWVzc2FnZTogc3RyaW5nLCBwcml2YXRlS2V5Pzogc3RyaW5nKSA9PiB7XG4gICAgICAgIHZvaWQgcHJpdmF0ZUtleTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2lmeVJlcXVlc3Qoc2VsZi53YWxsZXRSZXF1ZXN0LCAnc2lnbk1lc3NhZ2VWMicsIFttZXNzYWdlXSk7XG4gICAgICB9LFxuXG4gICAgICAvLyB2ZXJpZnlNZXNzYWdlIC8gdmVyaWZ5TWVzc2FnZVYyIGRlbGliZXJhdGVseSBOT1QgZXhwb3NlZCBoZXJlLlxuICAgICAgLy8gVHJvbldlYiBWMidzIHZlcmlmeU1lc3NhZ2VWMihtZXNzYWdlLCBzaWduYXR1cmUpIHJldHVybnMgdGhlXG4gICAgICAvLyByZWNvdmVyZWQgYmFzZTU4IGFkZHJlc3M7IG91ciBlbmRwb2ludCBzaGFwZSAoYWRkcmVzcyByZXF1aXJlZCxcbiAgICAgIC8vIGJvb2xlYW4gcmV0dXJuZWQpIGRvZXNuJ3QgbWF0Y2guIFVzZSBUcm9uV2ViJ3Mgc3RhdGljXG4gICAgICAvLyB2ZXJpZmljYXRpb24gdXRpbGl0aWVzLCBvciBjYWxsIHRyb25MaW5rLnJlcXVlc3QoeyBtZXRob2Q6XG4gICAgICAvLyAndHJvbl92ZXJpZnlNZXNzYWdlJywgcGFyYW1zOiBbeyBhZGRyZXNzLCBzaWduYXR1cmUsIG1lc3NhZ2UsXG4gICAgICAvLyBpc1RleHQ/IH1dIH0pIGV4cGxpY2l0bHkuXG5cbiAgICAgIHNlbmRSYXdUcmFuc2FjdGlvbjogYXN5bmMgKHNpZ25lZFR4OiBhbnkpID0+IHtcbiAgICAgICAgcmV0dXJuIHRyb25HcmlkUG9zdCgnL3dhbGxldC9icm9hZGNhc3R0cmFuc2FjdGlvbicsIHNpZ25lZFR4KTtcbiAgICAgIH0sXG5cbiAgICAgIGJyb2FkY2FzdDogYXN5bmMgKHNpZ25lZFR4OiBhbnkpID0+IHRyeC5zZW5kUmF3VHJhbnNhY3Rpb24oc2lnbmVkVHgpLFxuXG4gICAgICBnZXRCYWxhbmNlOiBhc3luYyAoYWRkcmVzcz86IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBhZGRyID0gYWRkcmVzcyB8fCBzZWxmLmFkZHJlc3M7XG4gICAgICAgIGlmICghYWRkcikgdGhyb3cgbmV3IEVycm9yKCdObyBhZGRyZXNzIFx1MjAxNCBjYWxsIHRyb25fcmVxdWVzdEFjY291bnRzIGZpcnN0Jyk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRyb25HcmlkUG9zdCgnL3dhbGxldC9nZXRhY2NvdW50JywgeyBhZGRyZXNzOiBhZGRyLCB2aXNpYmxlOiB0cnVlIH0pO1xuICAgICAgICByZXR1cm4gdHlwZW9mIHJlc3VsdD8uYmFsYW5jZSA9PT0gJ251bWJlcicgPyByZXN1bHQuYmFsYW5jZSA6IDA7XG4gICAgICB9LFxuXG4gICAgICBnZXRBY2NvdW50OiBhc3luYyAoYWRkcmVzcz86IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBhZGRyID0gYWRkcmVzcyB8fCBzZWxmLmFkZHJlc3M7XG4gICAgICAgIGlmICghYWRkcikgdGhyb3cgbmV3IEVycm9yKCdObyBhZGRyZXNzIFx1MjAxNCBjYWxsIHRyb25fcmVxdWVzdEFjY291bnRzIGZpcnN0Jyk7XG4gICAgICAgIHJldHVybiB0cm9uR3JpZFBvc3QoJy93YWxsZXQvZ2V0YWNjb3VudCcsIHsgYWRkcmVzczogYWRkciwgdmlzaWJsZTogdHJ1ZSB9KTtcbiAgICAgIH0sXG5cbiAgICAgIGdldFVuY29uZmlybWVkQWNjb3VudDogYXN5bmMgKGFkZHJlc3M/OiBzdHJpbmcpID0+IHtcbiAgICAgICAgY29uc3QgYWRkciA9IGFkZHJlc3MgfHwgc2VsZi5hZGRyZXNzO1xuICAgICAgICBpZiAoIWFkZHIpIHRocm93IG5ldyBFcnJvcignTm8gYWRkcmVzcyBcdTIwMTQgY2FsbCB0cm9uX3JlcXVlc3RBY2NvdW50cyBmaXJzdCcpO1xuICAgICAgICByZXR1cm4gdHJvbkdyaWRQb3N0KCcvd2FsbGV0L2dldGFjY291bnQnLCB7IGFkZHJlc3M6IGFkZHIsIHZpc2libGU6IHRydWUgfSk7XG4gICAgICB9LFxuXG4gICAgICBnZXRUcmFuc2FjdGlvbjogYXN5bmMgKHR4SWQ6IHN0cmluZykgPT4gdHJvbkdyaWRQb3N0KCcvd2FsbGV0L2dldHRyYW5zYWN0aW9uYnlpZCcsIHsgdmFsdWU6IHR4SWQgfSksXG4gICAgfTtcblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uQnVpbGRlciA9IHtcbiAgICAgIHNlbmRUcng6IGFzeW5jICh0bzogc3RyaW5nLCBhbW91bnQ6IG51bWJlciwgZnJvbT86IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBvd25lciA9IGZyb20gfHwgc2VsZi5hZGRyZXNzO1xuICAgICAgICBpZiAoIW93bmVyKSB0aHJvdyBuZXcgRXJyb3IoJ05vIGFkZHJlc3MgXHUyMDE0IGNhbGwgdHJvbl9yZXF1ZXN0QWNjb3VudHMgZmlyc3QnKTtcbiAgICAgICAgcmV0dXJuIHRyb25HcmlkUG9zdCgnL3dhbGxldC9jcmVhdGV0cmFuc2FjdGlvbicsIHtcbiAgICAgICAgICBvd25lcl9hZGRyZXNzOiBvd25lcixcbiAgICAgICAgICB0b19hZGRyZXNzOiB0byxcbiAgICAgICAgICBhbW91bnQsXG4gICAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICB0cmlnZ2VyU21hcnRDb250cmFjdDogYXN5bmMgKFxuICAgICAgICBjb250cmFjdEFkZHJlc3M6IHN0cmluZyxcbiAgICAgICAgZnVuY3Rpb25TZWxlY3Rvcjogc3RyaW5nLFxuICAgICAgICBvcHRpb25zOiBhbnkgPSB7fSxcbiAgICAgICAgcGFyYW1ldGVyczogYW55W10gPSBbXSxcbiAgICAgICAgaXNzdWVyQWRkcmVzcz86IHN0cmluZyxcbiAgICAgICkgPT4ge1xuICAgICAgICBjb25zdCBvd25lciA9IGlzc3VlckFkZHJlc3MgfHwgc2VsZi5hZGRyZXNzO1xuICAgICAgICBpZiAoIW93bmVyKSB0aHJvdyBuZXcgRXJyb3IoJ05vIGFkZHJlc3MgXHUyMDE0IGNhbGwgdHJvbl9yZXF1ZXN0QWNjb3VudHMgZmlyc3QnKTtcbiAgICAgICAgcmV0dXJuIHRyb25HcmlkUG9zdCgnL3dhbGxldC90cmlnZ2Vyc21hcnRjb250cmFjdCcsIHtcbiAgICAgICAgICBjb250cmFjdF9hZGRyZXNzOiBjb250cmFjdEFkZHJlc3MsXG4gICAgICAgICAgZnVuY3Rpb25fc2VsZWN0b3I6IGZ1bmN0aW9uU2VsZWN0b3IsXG4gICAgICAgICAgcGFyYW1ldGVyOiBidWlsZFRyaWdnZXJQYXJhbWV0ZXIocGFyYW1ldGVycyksXG4gICAgICAgICAgZmVlX2xpbWl0OiBvcHRpb25zLmZlZUxpbWl0ID8/IDEwMF8wMDBfMDAwLFxuICAgICAgICAgIGNhbGxfdmFsdWU6IG9wdGlvbnMuY2FsbFZhbHVlID8/IDAsXG4gICAgICAgICAgb3duZXJfYWRkcmVzczogb3duZXIsXG4gICAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgIH07XG5cbiAgICBjb25zdCB1dGlscyA9IHtcbiAgICAgIGlzQWRkcmVzczogKGFkZHI6IHN0cmluZykgPT4gaXNUcm9uQmFzZTU4KGFkZHIpLFxuICAgICAgZnJvbVN1bjogKHN1bjogc3RyaW5nIHwgbnVtYmVyKSA9PiBTdHJpbmcoTnVtYmVyKHN1bikgLyAxXzAwMF8wMDApLFxuICAgICAgdG9TdW46ICh0cng6IHN0cmluZyB8IG51bWJlcikgPT4gU3RyaW5nKE1hdGgucm91bmQoTnVtYmVyKHRyeCkgKiAxXzAwMF8wMDApKSxcbiAgICAgIHRvSGV4OiAoYWRkcjogc3RyaW5nKSA9PiBiYXNlNThUb0hleChhZGRyKSxcbiAgICB9O1xuXG4gICAgY29uc3QgdHJvbldlYiA9IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgVHJvbkxpbmstY29tcGF0aWJpbGl0eSBmbGFnIFx1MjAxNCBzb21lIGRBcHBzIGNoZWNrIGhlcmVcbiAgICAgIC8vIHJhdGhlciB0aGFuIG9uIHdpbmRvdy50cm9uTGluay5cbiAgICAgIGlzVHJvbkxpbms6IHRydWUsXG4gICAgICByZWFkeTogZmFsc2UsXG4gICAgICBkZWZhdWx0QWRkcmVzczoge1xuICAgICAgICBiYXNlNTg6IGZhbHNlIGFzIHN0cmluZyB8IGZhbHNlLFxuICAgICAgICBoZXg6IGZhbHNlIGFzIHN0cmluZyB8IGZhbHNlLFxuICAgICAgICBuYW1lOiBmYWxzZSBhcyBzdHJpbmcgfCBmYWxzZSxcbiAgICAgICAgdHlwZTogLTEsXG4gICAgICB9LFxuICAgICAgZnVsbE5vZGU6IHsgaG9zdDogVFJPTkdSSURfVVJMIH0sXG4gICAgICBzb2xpZGl0eU5vZGU6IHsgaG9zdDogVFJPTkdSSURfVVJMIH0sXG4gICAgICBldmVudFNlcnZlcjogeyBob3N0OiBUUk9OR1JJRF9VUkwgfSxcbiAgICAgIHRyeCxcbiAgICAgIHRyYW5zYWN0aW9uQnVpbGRlcixcbiAgICAgIHV0aWxzLFxuICAgICAgb246IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4gdGhpcy5lbWl0dGVyLm9uKGV2ZW50LCBoYW5kbGVyKSxcbiAgICAgIG9mZjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB0aGlzLmVtaXR0ZXIub2ZmKGV2ZW50LCBoYW5kbGVyKSxcbiAgICAgIHNldEFkZHJlc3M6IChfYWRkcjogc3RyaW5nKSA9PiB7XG4gICAgICAgIC8vIFRyb25MaW5rIG5vLW9wcyB0aGlzIHRvbyBcdTIwMTQgYWRkcmVzcyBzZWxlY3Rpb24gaXMgdXNlci1kcml2ZW4gaW5cbiAgICAgICAgLy8gdGhlIGV4dGVuc2lvbiBVSSwgbm90IGRBcHAtZHJpdmVuLlxuICAgICAgfSxcbiAgICAgIGlzQ29ubmVjdGVkOiAoKSA9PiB0aGlzLmFkZHJlc3MgIT09IG51bGwsXG4gICAgfTtcblxuICAgIC8vIFdpcmUgYmFjay1yZWZlcmVuY2Ugc28gYHdpbmRvdy50cm9uTGluay50cm9uV2ViID09PSB3aW5kb3cudHJvbldlYmBcbiAgICAvLyBvbmNlIGJvdGggYXJlIGNyZWF0ZWQsIG1hdGNoaW5nIHdoYXQgZEFwcHMgZXhwZWN0LlxuICAgIHF1ZXVlTWljcm90YXNrKCgpID0+IHtcbiAgICAgIGlmICh0aGlzLnRyb25MaW5rKSB0aGlzLnRyb25MaW5rLnRyb25XZWIgPSB0cm9uV2ViO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRyb25XZWI7XG4gIH1cbn1cblxuLyoqXG4gKiBFbmNvZGUgcGFyYW1ldGVycyBmb3IgdHJpZ2dlclNtYXJ0Q29udHJhY3QuIFdlIGFjY2VwdCB0aGUgdHJvbndlYi1zdHlsZVxuICogYFt7IHR5cGUsIHZhbHVlIH1dYCBhcnJheSBhbmQgZW1pdCB0aGUgdGlnaHRseS1wYWNrZWQgQUJJLWVuY29kZWQgaGV4XG4gKiBzdHJpbmcgVHJvbkdyaWQgZXhwZWN0cyBcdTIwMTQgbWF0Y2hlcyB0aGUgcmF3IGBwYXJhbWV0ZXJgIGZpZWxkIGZvcm1hdC5cbiAqXG4gKiBLZXB0IGludGVudGlvbmFsbHkgbWluaW1hbDogc3VwcG9ydHMgYGFkZHJlc3NgIGFuZCBgdWludDI1NmAsIHdoaWNoXG4gKiBjb3ZlcnMgYHRyYW5zZmVyKGFkZHJlc3MsdWludDI1NilgIGFuZCBtb3N0IFRSQzIwIGZsb3dzIGRBcHBzIGJ1aWxkXG4gKiB2aWEgdHJvbndlYi4gQ29tcGxleCBBQkkgdHlwZXMgY2FuIGJlIGhhbmRsZWQgYnkgZEFwcHMgcGFzc2luZ1xuICogcHJlLWVuY29kZWQgaGV4LlxuICovXG5mdW5jdGlvbiBidWlsZFRyaWdnZXJQYXJhbWV0ZXIocGFyYW1ldGVyczogeyB0eXBlOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdKTogc3RyaW5nIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHBhcmFtZXRlcnMpIHx8IHBhcmFtZXRlcnMubGVuZ3RoID09PSAwKSByZXR1cm4gJyc7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChjb25zdCBwIG9mIHBhcmFtZXRlcnMpIHtcbiAgICBpZiAocC50eXBlID09PSAnYWRkcmVzcycpIHtcbiAgICAgIC8vIFRyb25HcmlkIGV4cGVjdHMgMzItYnl0ZSByaWdodC1wYWRkZWQgYWRkcmVzcyAoaGV4IHdpdGhvdXQgMHg0MSBwcmVmaXgpLlxuICAgICAgY29uc3QgYWRkciA9IFN0cmluZyhwLnZhbHVlKTtcbiAgICAgIGNvbnN0IGhleCA9IGFkZHIuc3RhcnRzV2l0aCgnVCcpID8gYmFzZTU4VG9IZXgoYWRkcikuc2xpY2UoMikgOiBhZGRyLnJlcGxhY2UoL14weC8sICcnKS5yZXBsYWNlKC9eNDEvLCAnJyk7XG4gICAgICBvdXQgKz0gaGV4LnBhZFN0YXJ0KDY0LCAnMCcpO1xuICAgIH0gZWxzZSBpZiAocC50eXBlID09PSAndWludDI1NicgfHwgcC50eXBlID09PSAndWludCcpIHtcbiAgICAgIGNvbnN0IHYgPSBCaWdJbnQocC52YWx1ZSk7XG4gICAgICBvdXQgKz0gdi50b1N0cmluZygxNikucGFkU3RhcnQoNjQsICcwJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFBhc3MtdGhyb3VnaCBmb3IgcHJlLWVuY29kZWQgaGV4OyBjYWxsZXIgb3ducyBjb3JyZWN0bmVzcy5cbiAgICAgIGNvbnN0IHYgPSBTdHJpbmcocC52YWx1ZSkucmVwbGFjZSgvXjB4LywgJycpO1xuICAgICAgb3V0ICs9IHYucGFkU3RhcnQoNjQsICcwJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiaW1wb3J0IHR5cGUge1xuICBXYWxsZXRSZXF1ZXN0SW5mbyxcbiAgV2FsbGV0TWVzc2FnZSxcbiAgUHJvdmlkZXJJbmZvLFxuICBXYWxsZXRDYWxsYmFjayxcbiAgSW5qZWN0aW9uU3RhdGUsXG4gIENoYWluVHlwZSxcbiAgV2FsbGV0UHJvdmlkZXIsXG4gIEtlZXBLZXlXaW5kb3csXG59IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgS2VlcEtleVNvbGFuYVdhbGxldCB9IGZyb20gJy4vc29sYW5hLXdhbGxldC1zdGFuZGFyZCc7XG5pbXBvcnQgeyByZWdpc3RlclNvbGFuYVdhbGxldCB9IGZyb20gJy4vc29sYW5hLXdhbGxldC1yZWdpc3Rlcic7XG5pbXBvcnQgeyBLZWVwS2V5U29sYW5hUHJvdmlkZXIgfSBmcm9tICcuL3NvbGFuYS1wcm92aWRlcic7XG5pbXBvcnQgeyBLZWVwS2V5VHJvblByb3ZpZGVyIH0gZnJvbSAnLi90cm9uLXByb3ZpZGVyJztcblxuKGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgVkVSU0lPTiA9ICcyLjEuMCc7XG4gIGNvbnN0IE1BWF9SRVRSWV9DT1VOVCA9IDM7XG4gIGNvbnN0IFJFVFJZX0RFTEFZID0gMTAwOyAvLyBtc1xuICBjb25zdCBDQUxMQkFDS19USU1FT1VUID0gMzAwMDAwOyAvLyA1IG1pbnV0ZXMgKGhhcmR3YXJlIHdhbGxldCBuZWVkcyB0aW1lKVxuICBjb25zdCBNRVNTQUdFX1FVRVVFX01BWCA9IDEwMDtcblxuICBjb25zdCBrV2luZG93ID0gd2luZG93IGFzIEtlZXBLZXlXaW5kb3c7XG5cbiAgLy8gRW5oYW5jZWQgaW5qZWN0aW9uIHN0YXRlIHRyYWNraW5nXG4gIGNvbnN0IGluamVjdGlvblN0YXRlOiBJbmplY3Rpb25TdGF0ZSA9IHtcbiAgICBpc0luamVjdGVkOiBmYWxzZSxcbiAgICB2ZXJzaW9uOiBWRVJTSU9OLFxuICAgIGluamVjdGVkQXQ6IERhdGUubm93KCksXG4gICAgcmV0cnlDb3VudDogMCxcbiAgfTtcblxuICAvLyBDaGVjayBmb3IgZXhpc3RpbmcgaW5qZWN0aW9uIHdpdGggdmVyc2lvbiBjb21wYXJpc29uXG4gIGlmIChrV2luZG93LmtlZXBrZXlJbmplY3Rpb25TdGF0ZSkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0ga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGU7XG5cbiAgICAvLyBPbmx5IHNraXAgaWYgc2FtZSBvciBuZXdlciB2ZXJzaW9uXG4gICAgaWYgKGV4aXN0aW5nLnZlcnNpb24gPj0gVkVSU0lPTikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNldCBpbmplY3Rpb24gc3RhdGVcbiAga1dpbmRvdy5rZWVwa2V5SW5qZWN0aW9uU3RhdGUgPSBpbmplY3Rpb25TdGF0ZTtcblxuICAvLyBSZWFkIG1hc2tpbmcgc2V0dGluZ3MgZnJvbSB0aGUgPHNjcmlwdCBkYXRhLW1hc2tpbmc9XCJ7Li4ufVwiPiB0YWcgdGhlXG4gIC8vIGNvbnRlbnQgc2NyaXB0IHN0YW1wZWQgb24gYmVmb3JlIGluamVjdGlvbi4gRGVmYXVsdCB0byBhbGwtb2ZmICh0aGVcbiAgLy8gaG9uZXN0IG1vZGUgXHUyMDE0IHdlIGlkZW50aWZ5IGFzIEtlZXBLZXkgYW5kIHJlbHkgb24gRUlQLTY5NjMgZm9yIEVWTVxuICAvLyBkaXNjb3ZlcnkpLiBBbnkgcGFyc2UgZmFpbHVyZSBmYWxscyB0aHJvdWdoIHRvIGRlZmF1bHRzIHNvIGEgYmFkXG4gIC8vIHN0b3JhZ2Ugd3JpdGUgY2FuIG5ldmVyIGRpc2FibGUgc2lnbmluZyBlbnRpcmVseS5cbiAgaW50ZXJmYWNlIE1hc2tpbmcge1xuICAgIGVuYWJsZU1ldGFNYXNrTWFza2luZzogYm9vbGVhbjtcbiAgICBlbmFibGVYZmlNYXNraW5nOiBib29sZWFuO1xuICAgIGVuYWJsZUtlcGxyTWFza2luZzogYm9vbGVhbjtcbiAgICBlbmFibGVQaGFudG9tTWFza2luZzogYm9vbGVhbjtcbiAgfVxuICBjb25zdCBtYXNraW5nOiBNYXNraW5nID0gKCgpID0+IHtcbiAgICBjb25zdCBmYWxsYmFjazogTWFza2luZyA9IHtcbiAgICAgIGVuYWJsZU1ldGFNYXNrTWFza2luZzogZmFsc2UsXG4gICAgICBlbmFibGVYZmlNYXNraW5nOiBmYWxzZSxcbiAgICAgIGVuYWJsZUtlcGxyTWFza2luZzogZmFsc2UsXG4gICAgICBlbmFibGVQaGFudG9tTWFza2luZzogZmFsc2UsXG4gICAgfTtcbiAgICB0cnkge1xuICAgICAgLy8gY3VycmVudFNjcmlwdCB3b3JrcyBkdXJpbmcgc2NyaXB0IGV4ZWN1dGlvbjsgdGhlIGdldEVsZW1lbnRCeUlkXG4gICAgICAvLyBwYXRoIGlzIGEgZmFsbGJhY2sgaW4gY2FzZSB3ZSdyZSBydW5uaW5nIGZyb20gYSByZS1pbmplY3Rpb24gb3JcbiAgICAgIC8vIHRoZSBzY3JpcHQgdGFnIHdhcyBzd2FwcGVkIGJlZm9yZSB3ZSBnb3QgdG8gaXQuXG4gICAgICBjb25zdCBjcyA9IChkb2N1bWVudCBhcyBhbnkpLmN1cnJlbnRTY3JpcHQgYXMgSFRNTFNjcmlwdEVsZW1lbnQgfCBudWxsO1xuICAgICAgY29uc3QgYnlJZCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdrZWVwa2V5LWluamVjdGVkLXNjcmlwdCcpIGFzIEhUTUxTY3JpcHRFbGVtZW50IHwgbnVsbDtcbiAgICAgIGNvbnN0IGVsID0gY3M/LmRhdGFzZXQ/Lm1hc2tpbmcgPyBjcyA6IGJ5SWQ7XG4gICAgICBjb25zdCByYXcgPSBlbD8uZGF0YXNldC5tYXNraW5nO1xuICAgICAgaWYgKCFyYXcpIHJldHVybiBmYWxsYmFjaztcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGVuYWJsZU1ldGFNYXNrTWFza2luZzogcGFyc2VkLmVuYWJsZU1ldGFNYXNrTWFza2luZyA9PT0gdHJ1ZSxcbiAgICAgICAgZW5hYmxlWGZpTWFza2luZzogcGFyc2VkLmVuYWJsZVhmaU1hc2tpbmcgPT09IHRydWUsXG4gICAgICAgIGVuYWJsZUtlcGxyTWFza2luZzogcGFyc2VkLmVuYWJsZUtlcGxyTWFza2luZyA9PT0gdHJ1ZSxcbiAgICAgICAgZW5hYmxlUGhhbnRvbU1hc2tpbmc6IHBhcnNlZC5lbmFibGVQaGFudG9tTWFza2luZyA9PT0gdHJ1ZSxcbiAgICAgIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsbGJhY2s7XG4gICAgfVxuICB9KSgpO1xuXG4gIC8vIFNpbmdsZSBkaWFnbm9zdGljIHNvIHRoZSBwYWdlIGNvbnNvbGUgYWx3YXlzIHNob3dzIHRoZSBtYXNraW5nXG4gIC8vIHN0YXRlIEtlZXBLZXkgd2FzIGluamVjdGVkIHdpdGggXHUyMDE0IG1ha2VzIFwid2h5IGlzbid0IFN0cmlwZSBzZWVpbmdcbiAgLy8gdXM/XCIgZGVidWdnYWJsZSB3aXRob3V0IHRvZ2dsaW5nIHZlcmJvc2UgbG9ncyBlbHNld2hlcmUuXG4gIGNvbnNvbGUubG9nKFxuICAgIGBbS2VlcEtleV0gbWFza2luZzogbWV0YW1hc2s9JHttYXNraW5nLmVuYWJsZU1ldGFNYXNrTWFza2luZyA/ICdvbicgOiAnb2ZmJ30gYCArXG4gICAgICBgeGZpPSR7bWFza2luZy5lbmFibGVYZmlNYXNraW5nID8gJ29uJyA6ICdvZmYnfSBgICtcbiAgICAgIGBrZXBscj0ke21hc2tpbmcuZW5hYmxlS2VwbHJNYXNraW5nID8gJ29uJyA6ICdvZmYnfSBgICtcbiAgICAgIGBwaGFudG9tPSR7bWFza2luZy5lbmFibGVQaGFudG9tTWFza2luZyA/ICdvbicgOiAnb2ZmJ31gLFxuICApO1xuXG4gIC8vIEVuaGFuY2VkIHNvdXJjZSBpbmZvcm1hdGlvblxuICBjb25zdCBTT1VSQ0VfSU5GTyA9IHtcbiAgICBzaXRlVXJsOiB3aW5kb3cubG9jYXRpb24uaHJlZixcbiAgICBzY3JpcHRTb3VyY2U6ICdLZWVwS2V5IEV4dGVuc2lvbicsXG4gICAgdmVyc2lvbjogVkVSU0lPTixcbiAgICBpbmplY3RlZFRpbWU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBvcmlnaW46IHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4sXG4gICAgcHJvdG9jb2w6IHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbCxcbiAgfTtcblxuICBsZXQgbWVzc2FnZUlkID0gMDtcbiAgY29uc3QgY2FsbGJhY2tzID0gbmV3IE1hcDxudW1iZXIsIFdhbGxldENhbGxiYWNrPigpO1xuICBjb25zdCBtZXNzYWdlUXVldWU6IFdhbGxldE1lc3NhZ2VbXSA9IFtdO1xuICBsZXQgaXNDb250ZW50U2NyaXB0UmVhZHkgPSBmYWxzZTtcblxuICAvLyBDbGVhbnVwIG9sZCBjYWxsYmFja3MgcGVyaW9kaWNhbGx5XG4gIGNvbnN0IGNsZWFudXBDYWxsYmFja3MgPSAoKSA9PiB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBjYWxsYmFja3MuZm9yRWFjaCgoY2FsbGJhY2ssIGlkKSA9PiB7XG4gICAgICBpZiAobm93IC0gY2FsbGJhY2sudGltZXN0YW1wID4gQ0FMTEJBQ0tfVElNRU9VVCkge1xuICAgICAgICBjYWxsYmFjay5jYWxsYmFjayhuZXcgRXJyb3IoJ1JlcXVlc3QgdGltZW91dCcpKTtcbiAgICAgICAgY2FsbGJhY2tzLmRlbGV0ZShpZCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgc2V0SW50ZXJ2YWwoY2xlYW51cENhbGxiYWNrcywgNTAwMCk7XG5cbiAgLy8gTWFuYWdlIG1lc3NhZ2UgcXVldWUgc2l6ZVxuICBjb25zdCBhZGRUb1F1ZXVlID0gKG1lc3NhZ2U6IFdhbGxldE1lc3NhZ2UpID0+IHtcbiAgICBpZiAobWVzc2FnZVF1ZXVlLmxlbmd0aCA+PSBNRVNTQUdFX1FVRVVFX01BWCkge1xuICAgICAgbWVzc2FnZVF1ZXVlLnNoaWZ0KCk7XG4gICAgfVxuICAgIG1lc3NhZ2VRdWV1ZS5wdXNoKG1lc3NhZ2UpO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgcXVldWVkIG1lc3NhZ2VzIHdoZW4gY29udGVudCBzY3JpcHQgYmVjb21lcyByZWFkeVxuICBjb25zdCBwcm9jZXNzUXVldWUgPSAoKSA9PiB7XG4gICAgaWYgKCFpc0NvbnRlbnRTY3JpcHRSZWFkeSkgcmV0dXJuO1xuXG4gICAgd2hpbGUgKG1lc3NhZ2VRdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gbWVzc2FnZVF1ZXVlLnNoaWZ0KCk7XG4gICAgICBpZiAobWVzc2FnZSkge1xuICAgICAgICB3aW5kb3cucG9zdE1lc3NhZ2UobWVzc2FnZSwgd2luZG93LmxvY2F0aW9uLm9yaWdpbik7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIC8vIFZlcmlmeSBpbmplY3Rpb24gd2l0aCBjb250ZW50IHNjcmlwdFxuICBjb25zdCB2ZXJpZnlJbmplY3Rpb24gPSAocmV0cnlDb3VudCA9IDApOiBQcm9taXNlPGJvb2xlYW4+ID0+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCB2ZXJpZnlJZCA9ICsrbWVzc2FnZUlkO1xuICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBpZiAocmV0cnlDb3VudCA8IE1BWF9SRVRSWV9DT1VOVCkge1xuICAgICAgICAgIHNldFRpbWVvdXQoXG4gICAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAgIHZlcmlmeUluamVjdGlvbihyZXRyeUNvdW50ICsgMSkudGhlbihyZXNvbHZlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBSRVRSWV9ERUxBWSAqIE1hdGgucG93KDIsIHJldHJ5Q291bnQpLFxuICAgICAgICAgICk7IC8vIEV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpbmplY3Rpb25TdGF0ZS5sYXN0RXJyb3IgPSAnRmFpbGVkIHRvIHZlcmlmeSBpbmplY3Rpb24nO1xuICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG4gICAgICB9LCAxMDAwKTtcblxuICAgICAgY29uc3QgaGFuZGxlVmVyaWZpY2F0aW9uID0gKGV2ZW50OiBNZXNzYWdlRXZlbnQpID0+IHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGV2ZW50LnNvdXJjZSA9PT0gd2luZG93ICYmXG4gICAgICAgICAgZXZlbnQuZGF0YT8uc291cmNlID09PSAna2VlcGtleS1jb250ZW50JyAmJlxuICAgICAgICAgIGV2ZW50LmRhdGE/LnR5cGUgPT09ICdJTkpFQ1RJT05fQ09ORklSTUVEJyAmJlxuICAgICAgICAgIGV2ZW50LmRhdGE/LnJlcXVlc3RJZCA9PT0gdmVyaWZ5SWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgaGFuZGxlVmVyaWZpY2F0aW9uKTtcbiAgICAgICAgICBpc0NvbnRlbnRTY3JpcHRSZWFkeSA9IHRydWU7XG4gICAgICAgICAgaW5qZWN0aW9uU3RhdGUuaXNJbmplY3RlZCA9IHRydWU7XG4gICAgICAgICAgcHJvY2Vzc1F1ZXVlKCk7XG4gICAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBoYW5kbGVWZXJpZmljYXRpb24pO1xuXG4gICAgICAvLyBTZW5kIHZlcmlmaWNhdGlvbiByZXF1ZXN0XG4gICAgICB3aW5kb3cucG9zdE1lc3NhZ2UoXG4gICAgICAgIHtcbiAgICAgICAgICBzb3VyY2U6ICdrZWVwa2V5LWluamVjdGVkJyxcbiAgICAgICAgICB0eXBlOiAnSU5KRUNUSU9OX1ZFUklGWScsXG4gICAgICAgICAgcmVxdWVzdElkOiB2ZXJpZnlJZCxcbiAgICAgICAgICB2ZXJzaW9uOiBWRVJTSU9OLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgfSBhcyBXYWxsZXRNZXNzYWdlLFxuICAgICAgICB3aW5kb3cubG9jYXRpb24ub3JpZ2luLFxuICAgICAgKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBFbmhhbmNlZCB3YWxsZXQgcmVxdWVzdCB3aXRoIHZhbGlkYXRpb25cbiAgZnVuY3Rpb24gd2FsbGV0UmVxdWVzdChcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBwYXJhbXM6IGFueVtdID0gW10sXG4gICAgY2hhaW46IENoYWluVHlwZSxcbiAgICBjYWxsYmFjazogKGVycm9yOiBhbnksIHJlc3VsdD86IGFueSkgPT4gdm9pZCxcbiAgKSB7XG4gICAgLy8gVmFsaWRhdGUgaW5wdXRzXG4gICAgaWYgKCFtZXRob2QgfHwgdHlwZW9mIG1ldGhvZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGNhbGxiYWNrKG5ldyBFcnJvcignSW52YWxpZCBtZXRob2QnKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhcmFtcykpIHtcbiAgICAgIHBhcmFtcyA9IFtwYXJhbXNdO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXF1ZXN0SWQgPSArK21lc3NhZ2VJZDtcbiAgICAgIGNvbnN0IHJlcXVlc3RJbmZvOiBXYWxsZXRSZXF1ZXN0SW5mbyA9IHtcbiAgICAgICAgaWQ6IHJlcXVlc3RJZCxcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBwYXJhbXMsXG4gICAgICAgIGNoYWluLFxuICAgICAgICBzaXRlVXJsOiBTT1VSQ0VfSU5GTy5zaXRlVXJsLFxuICAgICAgICBzY3JpcHRTb3VyY2U6IFNPVVJDRV9JTkZPLnNjcmlwdFNvdXJjZSxcbiAgICAgICAgdmVyc2lvbjogU09VUkNFX0lORk8udmVyc2lvbixcbiAgICAgICAgcmVxdWVzdFRpbWU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgcmVmZXJyZXI6IGRvY3VtZW50LnJlZmVycmVyLFxuICAgICAgICBocmVmOiB3aW5kb3cubG9jYXRpb24uaHJlZixcbiAgICAgICAgdXNlckFnZW50OiBuYXZpZ2F0b3IudXNlckFnZW50LFxuICAgICAgICBwbGF0Zm9ybTogbmF2aWdhdG9yLnBsYXRmb3JtLFxuICAgICAgICBsYW5ndWFnZTogbmF2aWdhdG9yLmxhbmd1YWdlLFxuICAgICAgfTtcblxuICAgICAgLy8gU3RvcmUgY2FsbGJhY2sgd2l0aCBtZXRhZGF0YVxuICAgICAgY2FsbGJhY2tzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgbWV0aG9kLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG1lc3NhZ2U6IFdhbGxldE1lc3NhZ2UgPSB7XG4gICAgICAgIHNvdXJjZTogJ2tlZXBrZXktaW5qZWN0ZWQnLFxuICAgICAgICB0eXBlOiAnV0FMTEVUX1JFUVVFU1QnLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIHJlcXVlc3RJbmZvLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICB9O1xuXG4gICAgICBpZiAoaXNDb250ZW50U2NyaXB0UmVhZHkpIHtcbiAgICAgICAgd2luZG93LnBvc3RNZXNzYWdlKG1lc3NhZ2UsIHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYWRkVG9RdWV1ZShtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIExpc3RlbiBmb3IgcmVzcG9uc2VzIHdpdGggZW5oYW5jZWQgdmFsaWRhdGlvblxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudDogTWVzc2FnZUV2ZW50KSA9PiB7XG4gICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIG9yaWdpblxuICAgIGlmIChldmVudC5zb3VyY2UgIT09IHdpbmRvdykgcmV0dXJuO1xuXG4gICAgY29uc3QgZGF0YSA9IGV2ZW50LmRhdGEgYXMgV2FsbGV0TWVzc2FnZTtcbiAgICBpZiAoIWRhdGEgfHwgdHlwZW9mIGRhdGEgIT09ICdvYmplY3QnKSByZXR1cm47XG5cbiAgICAvLyBIYW5kbGUgaW5qZWN0aW9uIGNvbmZpcm1hdGlvblxuICAgIGlmIChkYXRhLnNvdXJjZSA9PT0gJ2tlZXBrZXktY29udGVudCcgJiYgZGF0YS50eXBlID09PSAnSU5KRUNUSU9OX0NPTkZJUk1FRCcpIHtcbiAgICAgIGlzQ29udGVudFNjcmlwdFJlYWR5ID0gdHJ1ZTtcbiAgICAgIHByb2Nlc3NRdWV1ZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSB3YWxsZXQgcmVzcG9uc2VzXG4gICAgaWYgKGRhdGEuc291cmNlID09PSAna2VlcGtleS1jb250ZW50JyAmJiBkYXRhLnR5cGUgPT09ICdXQUxMRVRfUkVTUE9OU0UnICYmIGRhdGEucmVxdWVzdElkKSB7XG4gICAgICBjb25zdCBjYWxsYmFjayA9IGNhbGxiYWNrcy5nZXQoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChkYXRhLmVycm9yKSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2soZGF0YS5lcnJvcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2suY2FsbGJhY2sobnVsbCwgZGF0YS5yZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrcy5kZWxldGUoZGF0YS5yZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLy8gRXZlbnQgZW1pdHRlciBpbXBsZW1lbnRhdGlvbiBmb3IgRUlQLTExOTMgY29tcGF0aWJpbGl0eVxuICBjbGFzcyBFdmVudEVtaXR0ZXIge1xuICAgIHByaXZhdGUgZXZlbnRzOiBNYXA8c3RyaW5nLCBTZXQ8RnVuY3Rpb24+PiA9IG5ldyBNYXAoKTtcblxuICAgIG9uKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzLmhhcyhldmVudCkpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuc2V0KGV2ZW50LCBuZXcgU2V0KCkpO1xuICAgICAgfVxuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KSEuYWRkKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIG9mZihldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZGVsZXRlKGhhbmRsZXIpO1xuICAgIH1cblxuICAgIHJlbW92ZUxpc3RlbmVyKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICB0aGlzLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgfVxuXG4gICAgcmVtb3ZlQWxsTGlzdGVuZXJzKGV2ZW50Pzogc3RyaW5nKSB7XG4gICAgICBpZiAoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5ldmVudHMuZGVsZXRlKGV2ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZXZlbnRzLmNsZWFyKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZW1pdChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkge1xuICAgICAgdGhpcy5ldmVudHMuZ2V0KGV2ZW50KT8uZm9yRWFjaChoYW5kbGVyID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB9IGNhdGNoIChfZXJyb3IpIHtcbiAgICAgICAgICAvLyBzd2FsbG93IGhhbmRsZXIgZXJyb3JzIHRvIGF2b2lkIGJyZWFraW5nIG90aGVyIGxpc3RlbmVyc1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBvbmNlKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSB7XG4gICAgICBjb25zdCBvbmNlSGFuZGxlciA9ICguLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgICAgICB0aGlzLm9mZihldmVudCwgb25jZUhhbmRsZXIpO1xuICAgICAgfTtcbiAgICAgIHRoaXMub24oZXZlbnQsIG9uY2VIYW5kbGVyKTtcbiAgICB9XG4gIH1cblxuICAvLyBDcmVhdGUgd2FsbGV0IHByb3ZpZGVyIHdpdGggcHJvcGVyIHR5cGluZ1xuICBmdW5jdGlvbiBjcmVhdGVXYWxsZXRPYmplY3QoY2hhaW46IENoYWluVHlwZSk6IFdhbGxldFByb3ZpZGVyIHtcbiAgICBjb25zdCBldmVudEVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbiAgICBjb25zdCB3YWxsZXQ6IFdhbGxldFByb3ZpZGVyID0ge1xuICAgICAgbmV0d29yazogJ21haW5uZXQnLFxuICAgICAgaXNLZWVwS2V5OiB0cnVlLFxuICAgICAgLy8gT25seSBjbGFpbSB0byBiZSBNZXRhTWFzayB3aGVuIHRoZSB1c2VyIGV4cGxpY2l0bHkgb3B0cyBpbiB2aWFcbiAgICAgIC8vIFNldHRpbmdzIFx1MjE5MiBNYXNraW5nLiBTdHJpcGUgYW5kIG90aGVyIGxlZ2FjeSBkQXBwcyBnYXRlIG9uIHRoaXNcbiAgICAgIC8vIGZsYWc7IGNsYWltaW5nIGl0IGJ5IGRlZmF1bHQgd291bGQgbWlzcmVwcmVzZW50IHRoZSB3YWxsZXQgYW5kXG4gICAgICAvLyBzaGFkb3cgRUlQLTY5NjMgZGlzY292ZXJ5IG9uIGRBcHBzIHRoYXQgcHJlZmVyIE1ldGFNYXNrLlxuICAgICAgaXNNZXRhTWFzazogbWFza2luZy5lbmFibGVNZXRhTWFza01hc2tpbmcsXG4gICAgICBpc0Nvbm5lY3RlZDogKCkgPT4gaXNDb250ZW50U2NyaXB0UmVhZHksXG5cbiAgICAgIHJlcXVlc3Q6ICh7IG1ldGhvZCwgcGFyYW1zID0gW10gfSkgPT4ge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHdhbGxldFJlcXVlc3QobWV0aG9kLCBwYXJhbXMsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgICAgIGBbSEFORE9GRl0gZEFwcCBcdTIxOTAgS2VlcEtleSAoJHtjaGFpbn0vJHttZXRob2R9KSBSRUpFQ1RcXG4gIHBhcmFtcz0ke0pTT04uc3RyaW5naWZ5KHBhcmFtcyl9XFxuICBlcnJvcj1gLFxuICAgICAgICAgICAgICAgIGVycm9yLFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY29uc3QgcmVzdWx0VHlwZSA9IHR5cGVvZiByZXN1bHQ7XG4gICAgICAgICAgICAgIGNvbnN0IHJlc3VsdFByZXZpZXcgPVxuICAgICAgICAgICAgICAgIHJlc3VsdFR5cGUgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgICAgICA/IGBsZW49JHsocmVzdWx0IGFzIHN0cmluZykubGVuZ3RofSB2YWx1ZT0ke3Jlc3VsdH1gXG4gICAgICAgICAgICAgICAgICA6IGB2YWx1ZT0ke0pTT04uc3RyaW5naWZ5KHJlc3VsdCl9YDtcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coXG4gICAgICAgICAgICAgICAgYFtIQU5ET0ZGXSBkQXBwIFx1MjE5MCBLZWVwS2V5ICgke2NoYWlufS8ke21ldGhvZH0pIFJFU09MVkVcXG4gIHBhcmFtcz0ke0pTT04uc3RyaW5naWZ5KHBhcmFtcyl9XFxuICB0eXBlPSR7cmVzdWx0VHlwZX0gJHtyZXN1bHRQcmV2aWV3fWAsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBzZW5kOiAocGF5bG9hZDogYW55LCBwYXJhbTE/OiBhbnksIGNhbGxiYWNrPzogYW55KTogYW55ID0+IHtcbiAgICAgICAgaWYgKCFwYXlsb2FkLmNoYWluKSB7XG4gICAgICAgICAgcGF5bG9hZC5jaGFpbiA9IGNoYWluO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEFzeW5jIHNlbmRcbiAgICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHsgaWQ6IHBheWxvYWQuaWQsIGpzb25ycGM6ICcyLjAnLCByZXN1bHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBTeW5jIHNlbmQgKGRlcHJlY2F0ZWQsIGJ1dCByZXF1aXJlZCBmb3IgY29tcGF0aWJpbGl0eSlcbiAgICAgICAgICByZXR1cm4geyBpZDogcGF5bG9hZC5pZCwganNvbnJwYzogJzIuMCcsIHJlc3VsdDogbnVsbCB9O1xuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICBzZW5kQXN5bmM6IChwYXlsb2FkOiBhbnksIHBhcmFtMT86IGFueSwgY2FsbGJhY2s/OiBhbnkpID0+IHtcbiAgICAgICAgaWYgKCFwYXlsb2FkLmNoYWluKSB7XG4gICAgICAgICAgcGF5bG9hZC5jaGFpbiA9IGNoYWluO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY2IgPSBjYWxsYmFjayB8fCBwYXJhbTE7XG4gICAgICAgIGlmICh0eXBlb2YgY2IgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB3YWxsZXRSZXF1ZXN0KHBheWxvYWQubWV0aG9kLCBwYXlsb2FkLnBhcmFtcyB8fCBwYXJhbTEsIGNoYWluLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgY2IoZXJyb3IpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYihudWxsLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiAnMi4wJywgcmVzdWx0IH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9LFxuXG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vbihldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgb2ZmOiAoZXZlbnQ6IHN0cmluZywgaGFuZGxlcjogRnVuY3Rpb24pID0+IHtcbiAgICAgICAgZXZlbnRFbWl0dGVyLm9mZihldmVudCwgaGFuZGxlcik7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgcmVtb3ZlTGlzdGVuZXI6IChldmVudDogc3RyaW5nLCBoYW5kbGVyOiBGdW5jdGlvbikgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIHJlbW92ZUFsbExpc3RlbmVyczogKGV2ZW50Pzogc3RyaW5nKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5yZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpO1xuICAgICAgICByZXR1cm4gd2FsbGV0OyAvLyBSZXR1cm4gdGhpcyBmb3IgY2hhaW5pbmdcbiAgICAgIH0sXG5cbiAgICAgIGVtaXQ6IChldmVudDogc3RyaW5nLCAuLi5hcmdzOiBhbnlbXSkgPT4ge1xuICAgICAgICBldmVudEVtaXR0ZXIuZW1pdChldmVudCwgLi4uYXJncyk7XG4gICAgICAgIHJldHVybiB3YWxsZXQ7IC8vIFJldHVybiB0aGlzIGZvciBjaGFpbmluZ1xuICAgICAgfSxcblxuICAgICAgb25jZTogKGV2ZW50OiBzdHJpbmcsIGhhbmRsZXI6IEZ1bmN0aW9uKSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5vbmNlKGV2ZW50LCBoYW5kbGVyKTtcbiAgICAgICAgcmV0dXJuIHdhbGxldDsgLy8gUmV0dXJuIHRoaXMgZm9yIGNoYWluaW5nXG4gICAgICB9LFxuXG4gICAgICAvLyBBZGRpdGlvbmFsIG1ldGhvZHMgZm9yIGNvbXBhdGliaWxpdHlcbiAgICAgIGVuYWJsZTogKCkgPT4ge1xuICAgICAgICAvLyBMZWdhY3kgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgIHJldHVybiB3YWxsZXQucmVxdWVzdCh7IG1ldGhvZDogJ2V0aF9yZXF1ZXN0QWNjb3VudHMnIH0pO1xuICAgICAgfSxcblxuICAgICAgX21ldGFtYXNrOiB7XG4gICAgICAgIGlzVW5sb2NrZWQ6ICgpID0+IFByb21pc2UucmVzb2x2ZSh0cnVlKSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIC8vIEFkZCBjaGFpbi1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgaWYgKGNoYWluID09PSAnZXRoZXJldW0nKSB7XG4gICAgICB3YWxsZXQuY2hhaW5JZCA9ICcweDEnO1xuICAgICAgd2FsbGV0Lm5ldHdvcmtWZXJzaW9uID0gJzEnO1xuICAgICAgd2FsbGV0LnNlbGVjdGVkQWRkcmVzcyA9IG51bGw7IC8vIFdpbGwgYmUgcG9wdWxhdGVkIGFmdGVyIGNvbm5lY3Rpb25cblxuICAgICAgLy8gQXV0by1jb25uZWN0IGhhbmRsZXJcbiAgICAgIHdhbGxldC5faGFuZGxlQWNjb3VudHNDaGFuZ2VkID0gKGFjY291bnRzOiBzdHJpbmdbXSkgPT4ge1xuICAgICAgICB3YWxsZXQuc2VsZWN0ZWRBZGRyZXNzID0gYWNjb3VudHNbMF0gfHwgbnVsbDtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoJ2FjY291bnRzQ2hhbmdlZCcsIGFjY291bnRzKTtcbiAgICAgIH07XG5cbiAgICAgIHdhbGxldC5faGFuZGxlQ2hhaW5DaGFuZ2VkID0gKGNoYWluSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICB3YWxsZXQuY2hhaW5JZCA9IGNoYWluSWQ7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdjaGFpbkNoYW5nZWQnLCBjaGFpbklkKTtcbiAgICAgIH07XG5cbiAgICAgIHdhbGxldC5faGFuZGxlQ29ubmVjdCA9IChpbmZvOiB7IGNoYWluSWQ6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgIGV2ZW50RW1pdHRlci5lbWl0KCdjb25uZWN0JywgaW5mbyk7XG4gICAgICB9O1xuXG4gICAgICB3YWxsZXQuX2hhbmRsZURpc2Nvbm5lY3QgPSAoZXJyb3I6IHsgY29kZTogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICB3YWxsZXQuc2VsZWN0ZWRBZGRyZXNzID0gbnVsbDtcbiAgICAgICAgZXZlbnRFbWl0dGVyLmVtaXQoJ2Rpc2Nvbm5lY3QnLCBlcnJvcik7XG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB3YWxsZXQ7XG4gIH1cblxuICBjb25zdCBLRUVQS0VZX0lDT04gPVxuICAgICdkYXRhOmltYWdlL3BuZztiYXNlNjQsaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUNBQUFBQWdDQVlBQUFCemVucjBBQUFBQVhOU1IwSUFyczRjNlFBQUFFUmxXRWxtVFUwQUtnQUFBQWdBQVlkcEFBUUFBQUFCQUFBQUdnQUFBQUFBQTZBQkFBTUFBQUFCQUFFQUFLQUNBQVFBQUFBQkFBQUFJS0FEQUFRQUFBQUJBQUFBSUFBQUFBQ3NobUx6QUFBRFVrbEVRVlJZQ2IxWFRVZ1VZUmllM2JYRVdoVkxRYVVzZ3dWTG9VdEVRalVKaVpYMEEwR1g3QklaWHVya09UU3ZkbzJrdkVUSEFzT3NoRmdxT3FobFJEOUM3U0dTMUpUQ3NqMWtyVTdQTSt3N3pNek96dXpNcWk4OCs3M3Y5ejd2ejN6enpUZXppdUlnbXFiRmdHNWdCUGd1Rk9ncTRDWExJTXdDbzBBWEVKTjR6eEhrRXVBNmtBSU1rVUJNcU1aazdzby9VRzhBVWNuak9JS3dGWGdIWklnRXdLRm1PSE9mWU80YXlTVmptQW9jN080UjBFQjdsWVM1aDlLMWpCSjZBN0N1QWZYRzdPb3BiS0xYa2g0ZGNjTlo3amxzaTBnQUpsV0xJNWpCUFdGc1RLNUFHeENSSW1zd0ZxREdXYW5EQm82SXNZYmpVYW5GYm1yRldJSHhEM0lzbWZKc2dCNHkyYUp1RjRVclVDNUdudU50eEplRVFxRW9BYjNMSlYrRjRjdGxId2taWERVTHY4ZkVLUUNIQjQrckNKOW5nS2NJR1VUVlJ1YlQwMjd5OHlSOWJPTTRtaEtUVHdOSlpENG1pYURYQUc4ZHF6bE1TaHczWVJDWlJWQXI3dlU0ZzVGL0Q0WkJvSksySCtFbTlDc2ZFZEJvS240SzlqUEFkM0c5c01QcVpFenBSUHpBd1JmV0pwTjlFZlpTUmtBT0U1TEQ3d3J3OGRrcHdSaDU1Vk1tMjdmcXQ0RmlWQmpHQlRheEVtNERiOGQrNEJQdElPSzNBZGJZQ1BDMXFoL2hhR0lTOWdIZ0RlQmJnalRBSWtYQWZUUnhrZ2FhbU1Od0NIZ0IrQk1rNERlY3EwaEdrRlFia2EvV015Wi9FZXlITm82VHVTd3gzTm44Z0hRVklZT2tPaEI1R3A0emNkYkJIaUR2WjJwUnV6b3pydTJldUt1RE91Y2cvS2xpVEFqS0tNYTlrc0JweEJMcmJ6UndWZmlmT25CNFJSMmczUVNIM0NmeDVGUmRjMktvR3N0cm9VZVFLaDQ3dm5Bd1d2VUtqc1BjQS93V2RCVWtqUkFnWmRzem5POEQ1eExHQy9PcHhjM05pUWVWOXVJc2drTkRhVW9NRnBORExsZUFuMGNUUU5CakdhRlc2Zm4yV3JreS9kSTZhYlBPbDllTjlkZW9XaGpMbG9DdjMrYlB5N3czLzlremZ2algxMjBnMWN1U2RzSjQ3eG0xQ2dTOUFheENFcmxiVjZxSjIyVzFucTIybEc3NUF0SUhXUUVlSnBPWWFBVDZnQlFRV0M1WE5DamM3ZGtrSEZLV2U2djNGY0xmYnpSQU1sY0M2SUM2QytnR3hnQ2VjdFpuQ1JNdW9wVkcxditOeDA0c1lJTmx4TEg0d0k2VzUyVUZoVCtRNDFiMk5sMHFlTG53WlBHUXVjTkhyWE42WkRHOTRSUXVPNjg4WGJ3TkZ6dmpsU3V3SDAzd0VXOEgrQmYvZHhyVU9XZGMrSDhtS1h0RXBHcFkzQUFBQUFCSlJVNUVya0pnZ2c9PSc7XG5cbiAgLy8gU2ltcGxlIE1ldGFNYXNrLWZveC1mbGF2b3JlZCBpY29uIChvcmFuZ2Ugc3F1YXJlKS4gVGhlIHJlYWwgZm94XG4gIC8vIFBORyB3b3VsZCBiZSB+MTVLQiBiYXNlNjQgYW5kIG5vdCB3b3J0aCB0aGUgYnVuZGxlIGJsb2F0IFx1MjAxNCBkQXBwc1xuICAvLyBkb2luZyBFSVAtNjk2MyBkZXRlY3Rpb24gbWF0Y2ggb24gcmRucywgbm90IHBpeGVsLWNvbXBhcmUgaWNvbnMuXG4gIGNvbnN0IE1FVEFNQVNLX0lDT04gPVxuICAgICdkYXRhOmltYWdlL3N2Zyt4bWw7dXRmOCwnICtcbiAgICBlbmNvZGVVUklDb21wb25lbnQoXG4gICAgICAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgdmlld0JveD1cIjAgMCAzMiAzMlwiPjxyZWN0IHdpZHRoPVwiMzJcIiBoZWlnaHQ9XCIzMlwiIHJ4PVwiNFwiIGZpbGw9XCIjRjY4NTFCXCIvPjx0ZXh0IHg9XCIxNlwiIHk9XCIyMVwiIGZvbnQtZmFtaWx5PVwiQXJpYWwsc2Fucy1zZXJpZlwiIGZvbnQtd2VpZ2h0PVwiYm9sZFwiIGZvbnQtc2l6ZT1cIjE0XCIgZmlsbD1cIiNmZmZcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiPk1NPC90ZXh0Pjwvc3ZnPicsXG4gICAgKTtcblxuICAvLyBFSVAtNjk2MyBQcm92aWRlciBBbm5vdW5jZW1lbnQuIFdoZW4gTWV0YU1hc2sgbWFza2luZyBpcyBPTiB3ZVxuICAvLyAqYWxzbyogYW5ub3VuY2Ugd2l0aCBNZXRhTWFzaydzIGNhbm9uaWNhbCByZG5zIHNvIFNES3MgdGhhdCBrZXkgb2ZmXG4gIC8vIGByZG5zOiAnaW8ubWV0YW1hc2snYCAoTWV0YU1hc2sgU0RLIGl0c2VsZiwgRHluYW1pYy54eXonc1xuICAvLyBNZXRhTWFza0Nvbm5lY3RvciwgUmFpbmJvd0tpdCdzIE1ldGFNYXNrIGNvbm5lY3RvciwgZXRjLikgc2VlIHVzIGFzXG4gIC8vIE1ldGFNYXNrIFx1MjAxNCB0aGUgYGlzTWV0YU1hc2s6IHRydWVgIGZsYWcgYWxvbmUgaXNuJ3QgZW5vdWdoIGZvciB0aGVzZSxcbiAgLy8gdGhleSB1c2UgRUlQLTY5NjMgZGlzY292ZXJ5LiBUaGlzIGlzIHRoZSBzYW1lIHRyaWNrIFJhYmJ5IHVzZXMuXG4gIGZ1bmN0aW9uIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW1Qcm92aWRlcjogV2FsbGV0UHJvdmlkZXIpIHtcbiAgICBjb25zdCBrZWVwa2V5SW5mbzogUHJvdmlkZXJJbmZvID0ge1xuICAgICAgdXVpZDogJzM1MDY3MGRiLTE5ZmEtNDcwNC1hMTY2LWU1MmUxNzhiNTlkNCcsXG4gICAgICBuYW1lOiAnS2VlcEtleScsXG4gICAgICBpY29uOiBLRUVQS0VZX0lDT04sXG4gICAgICByZG5zOiAnY29tLmtlZXBrZXkuY2xpZW50JyxcbiAgICB9O1xuICAgIHdpbmRvdy5kaXNwYXRjaEV2ZW50KFxuICAgICAgbmV3IEN1c3RvbUV2ZW50KCdlaXA2OTYzOmFubm91bmNlUHJvdmlkZXInLCB7XG4gICAgICAgIGRldGFpbDogT2JqZWN0LmZyZWV6ZSh7IGluZm86IGtlZXBrZXlJbmZvLCBwcm92aWRlcjogZXRoZXJldW1Qcm92aWRlciB9KSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBpZiAobWFza2luZy5lbmFibGVNZXRhTWFza01hc2tpbmcpIHtcbiAgICAgIGNvbnN0IG1ldGFNYXNrSW5mbzogUHJvdmlkZXJJbmZvID0ge1xuICAgICAgICB1dWlkOiAnOWIxZGViNGQtM2I3ZC00YmFkLTliZGQtMmIwZDdiM2RjYjZkJyxcbiAgICAgICAgbmFtZTogJ01ldGFNYXNrJyxcbiAgICAgICAgaWNvbjogTUVUQU1BU0tfSUNPTixcbiAgICAgICAgcmRuczogJ2lvLm1ldGFtYXNrJyxcbiAgICAgIH07XG4gICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChcbiAgICAgICAgbmV3IEN1c3RvbUV2ZW50KCdlaXA2OTYzOmFubm91bmNlUHJvdmlkZXInLCB7XG4gICAgICAgICAgZGV0YWlsOiBPYmplY3QuZnJlZXplKHsgaW5mbzogbWV0YU1hc2tJbmZvLCBwcm92aWRlcjogZXRoZXJldW1Qcm92aWRlciB9KSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIC8vIE1vdW50IHdhbGxldCB3aXRoIHByb3BlciBzdGF0ZSBtYW5hZ2VtZW50XG4gIGFzeW5jIGZ1bmN0aW9uIG1vdW50V2FsbGV0KCkge1xuICAgIC8vIENyZWF0ZSB3YWxsZXQgb2JqZWN0cyBpbW1lZGlhdGVseSAtIGRvbid0IHdhaXQgZm9yIHZlcmlmaWNhdGlvblxuICAgIGNvbnN0IGV0aGVyZXVtID0gY3JlYXRlV2FsbGV0T2JqZWN0KCdldGhlcmV1bScpO1xuICAgIGNvbnN0IHhmaTogUmVjb3JkPHN0cmluZywgV2FsbGV0UHJvdmlkZXI+ID0ge1xuICAgICAgYmluYW5jZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaW5hbmNlJyksXG4gICAgICBiaXRjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW4nKSxcbiAgICAgIGJpdGNvaW5jYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW5jYXNoJyksXG4gICAgICBkb2dlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdkb2dlY29pbicpLFxuICAgICAgZGFzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdkYXNoJyksXG4gICAgICBldGhlcmV1bTogZXRoZXJldW0sXG4gICAgICBrZXBscjogY3JlYXRlV2FsbGV0T2JqZWN0KCdrZXBscicpLFxuICAgICAgbGl0ZWNvaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbGl0ZWNvaW4nKSxcbiAgICAgIHRob3JjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCd0aG9yY2hhaW4nKSxcbiAgICAgIG1heWFjaGFpbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdtYXlhY2hhaW4nKSxcbiAgICB9O1xuXG4gICAgY29uc3Qga2VlcGtleTogUmVjb3JkPHN0cmluZywgV2FsbGV0UHJvdmlkZXI+ID0ge1xuICAgICAgYmluYW5jZTogY3JlYXRlV2FsbGV0T2JqZWN0KCdiaW5hbmNlJyksXG4gICAgICBiaXRjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW4nKSxcbiAgICAgIGJpdGNvaW5jYXNoOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2JpdGNvaW5jYXNoJyksXG4gICAgICBkb2dlY29pbjogY3JlYXRlV2FsbGV0T2JqZWN0KCdkb2dlY29pbicpLFxuICAgICAgZGFzaDogY3JlYXRlV2FsbGV0T2JqZWN0KCdkYXNoJyksXG4gICAgICBldGhlcmV1bTogZXRoZXJldW0sXG4gICAgICBvc21vc2lzOiBjcmVhdGVXYWxsZXRPYmplY3QoJ29zbW9zaXMnKSxcbiAgICAgIGNvc21vczogY3JlYXRlV2FsbGV0T2JqZWN0KCdjb3Ntb3MnKSxcbiAgICAgIGxpdGVjb2luOiBjcmVhdGVXYWxsZXRPYmplY3QoJ2xpdGVjb2luJyksXG4gICAgICB0aG9yY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgndGhvcmNoYWluJyksXG4gICAgICBtYXlhY2hhaW46IGNyZWF0ZVdhbGxldE9iamVjdCgnbWF5YWNoYWluJyksXG4gICAgICByaXBwbGU6IGNyZWF0ZVdhbGxldE9iamVjdCgncmlwcGxlJyksXG4gICAgfTtcblxuICAgIC8vIE1vdW50IHByb3ZpZGVycyB3aXRob3V0IHN0b21waW5nIGV4aXN0aW5nIHdhbGxldHMuXG4gICAgLy9cbiAgICAvLyBNb2Rlcm4gZEFwcHMgdXNlIEVJUC02OTYzIGZvciBtdWx0aS13YWxsZXQgZGlzY292ZXJ5IChhbm5vdW5jZWQgYmVsb3cpLFxuICAgIC8vIHNvIHdlIGRvbid0IG5lZWQgdG8gb3duIGB3aW5kb3cuZXRoZXJldW1gLiBPdmVyd3JpdGluZyBhbm90aGVyIHdhbGxldCdzXG4gICAgLy8gcHJvdmlkZXIgaXMgYSBkQXBwLWNvbXBhdGliaWxpdHkgbGFuZG1pbmUgXHUyMDE0IGl0IGJyZWFrcyB0aGF0IHdhbGxldCdzXG4gICAgLy8gY29ubmVjdGlvbiBmbG93LCBjb3JydXB0cyBpdHMgZXZlbnQgc3RhdGUsIGFuZCBpcyBoYXJkIHRvIGRlYnVnLlxuICAgIC8vXG4gICAgLy8gUG9saWN5OlxuICAgIC8vICAgLSBgd2luZG93LmtlZXBrZXlgICBcdTIxOTIgYWx3YXlzIG1vdW50IChvdXIgb3duIG5hbWVzcGFjZSwgbm8gY29sbGlzaW9uIHJpc2spXG4gICAgLy8gICAtIGB3aW5kb3cuZXRoZXJldW1gIFx1MjE5MiBvbmx5IHdoZW4gTWV0YU1hc2sgbWFza2luZyBpcyBPTiwgYW5kIG9ubHkgaWZcbiAgICAvLyAgICAgICAgICAgICAgICAgICAgICAgICAgbm90aGluZyBpcyB0aGVyZTsgRUlQLTY5NjMgY292ZXJzIHRoZSBkZWZhdWx0IGNhc2VcbiAgICAvLyAgIC0gYHdpbmRvdy54ZmlgICAgICAgXHUyMTkyIG9ubHkgd2hlbiBYRkkgbWFza2luZyBpcyBPTiwgYW5kIG9ubHkgaWYgbm90aGluZ1xuICAgIC8vICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIGFscmVhZHkgb3ducyB0aGUgbmFtZXNwYWNlIChYREVGSSAvIEN0cmwpXG4gICAgY29uc3QgbW91bnRQcm92aWRlciA9IChuYW1lOiBzdHJpbmcsIHByb3ZpZGVyOiBhbnksIHsgZm9yY2UgPSBmYWxzZSB9ID0ge30pID0+IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gKGtXaW5kb3cgYXMgYW55KVtuYW1lXTtcbiAgICAgIGlmIChleGlzdGluZyAmJiAhZm9yY2UpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoa1dpbmRvdywgbmFtZSwge1xuICAgICAgICAgIHZhbHVlOiBwcm92aWRlcixcbiAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLCAvLyBBbGxvdyByZWNvbmZpZ3VyYXRpb24gZm9yIHVwZGF0ZXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICBpbmplY3Rpb25TdGF0ZS5sYXN0RXJyb3IgPSBgRmFpbGVkIHRvIG1vdW50ICR7bmFtZX1gO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBNb3VudCBwcm92aWRlcnMgXHUyMDE0IGBrZWVwa2V5YCBpcyBmb3JjZWQgYmVjYXVzZSBpdCdzIG91ciBvd24gbmFtZXNwYWNlXG4gICAgLy8gYW5kIHByZXZpb3VzIHBhZ2UtbG9hZCBzdGF0ZSAoZS5nLiBmcm9tIGEgc3RhbGUgaW5qZWN0aW9uKSBzaG91bGQgbm90XG4gICAgLy8gYmxvY2sgdXMgZnJvbSByZWJpbmRpbmcgdG8gdGhlIGN1cnJlbnQgcmVxdWVzdCBwaXBlbGluZS4gYGV0aGVyZXVtYFxuICAgIC8vIGFuZCBgeGZpYCBhcmUgZ2F0ZWQgb24gZXhwbGljaXQgdXNlciBvcHQtaW4gdmlhIHRoZSBNYXNraW5nIHRvZ2dsZXM7XG4gICAgLy8gd2l0aG91dCB0aG9zZSBmbGFncyB3ZSBzdGF5IG91dCBvZiB0aG9zZSBnbG9iYWxzIGVudGlyZWx5LlxuICAgIGlmIChtYXNraW5nLmVuYWJsZU1ldGFNYXNrTWFza2luZykge1xuICAgICAgbW91bnRQcm92aWRlcignZXRoZXJldW0nLCBldGhlcmV1bSk7XG4gICAgfVxuICAgIGlmIChtYXNraW5nLmVuYWJsZVhmaU1hc2tpbmcpIHtcbiAgICAgIG1vdW50UHJvdmlkZXIoJ3hmaScsIHhmaSk7XG4gICAgfVxuICAgIG1vdW50UHJvdmlkZXIoJ2tlZXBrZXknLCBrZWVwa2V5LCB7IGZvcmNlOiB0cnVlIH0pO1xuXG4gICAgLy8gQ1JJVElDQUw6IFNldCB1cCBFSVAtNjk2MyBsaXN0ZW5lciBCRUZPUkUgYW5ub3VuY2luZ1xuICAgIC8vIFRoaXMgZW5zdXJlcyB3ZSBjYXRjaCBhbnkgaW1tZWRpYXRlIHJlcXVlc3RzXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2VpcDY5NjM6cmVxdWVzdFByb3ZpZGVyJywgKCkgPT4ge1xuICAgICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG4gICAgfSk7XG5cbiAgICAvLyBBbm5vdW5jZSBFSVAtNjk2MyBwcm92aWRlciBpbW1lZGlhdGVseVxuICAgIGFubm91bmNlUHJvdmlkZXIoZXRoZXJldW0pO1xuXG4gICAgLy8gQWxzbyBhbm5vdW5jZSB3aXRoIGEgc2xpZ2h0IGRlbGF5IHRvIGNhdGNoIGxhdGUtbG9hZGluZyBkQXBwc1xuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG4gICAgfSwgMTAwKTtcblxuICAgIC8vIFNvbGFuYSBXYWxsZXQgU3RhbmRhcmQgcmVnaXN0cmF0aW9uIChjb21wbGV0ZWx5IHNlcGFyYXRlIGZyb20gRXRoZXJldW0pLlxuICAgIC8vIFRoaXMgaXMgdGhlIG1vZGVybiBkaXNjb3ZlcnkgcGF0aCBhbmQgaXMgYWx3YXlzIGFjdGl2ZSBcdTIwMTQgaXQgcmVsaWVzXG4gICAgLy8gcHVyZWx5IG9uIHRoZSB3YWxsZXQtc3RhbmRhcmQgcmVnaXN0cnkgYW5kIG5ldmVyIHRvdWNoZXMgd2luZG93LnNvbGFuYS5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc29sYW5hV2FsbGV0ID0gbmV3IEtlZXBLZXlTb2xhbmFXYWxsZXQod2FsbGV0UmVxdWVzdCk7XG4gICAgICByZWdpc3RlclNvbGFuYVdhbGxldChzb2xhbmFXYWxsZXQpO1xuICAgIH0gY2F0Y2ggKF9lKSB7XG4gICAgICAvLyBzd2FsbG93OyBTb2xhbmEgcmVnaXN0cmF0aW9uIGlzIGJlc3QtZWZmb3J0XG4gICAgfVxuXG4gICAgLy8gTGVnYWN5IHdpbmRvdy5zb2xhbmEgc2hpbSBcdTIwMTQgdGhlIFNvbGFuYSBjb3VudGVycGFydCB0byBNZXRhTWFza1xuICAgIC8vIG1hc2tpbmcuIEdhdGVkIG9uIHRoZSBQaGFudG9tIG1hc2tpbmcgdG9nZ2xlIGFuZCBtb3VudGVkIG9ubHkgaWZcbiAgICAvLyBub3RoaW5nIGVsc2UgKGEgcmVhbCBQaGFudG9tL1NvbGZsYXJlKSBhbHJlYWR5IGNsYWltcyB0aGUgZ2xvYmFsLCBzb1xuICAgIC8vIHdlIG5ldmVyIGNsb2JiZXIgYW4gaW5zdGFsbGVkIHdhbGxldC4gTW9kZXJuIGRBcHBzIGtlZXAgZGlzY292ZXJpbmdcbiAgICAvLyBLZWVwS2V5IHZpYSB0aGUgV2FsbGV0IFN0YW5kYXJkIHJlZ2lzdHJhdGlvbiBhYm92ZSByZWdhcmRsZXNzLlxuICAgIGlmIChtYXNraW5nLmVuYWJsZVBoYW50b21NYXNraW5nKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIShrV2luZG93IGFzIGFueSkuc29sYW5hKSB7XG4gICAgICAgICAgY29uc3Qgc29sYW5hUHJvdmlkZXIgPSBuZXcgS2VlcEtleVNvbGFuYVByb3ZpZGVyKHdhbGxldFJlcXVlc3QpO1xuICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShrV2luZG93LCAnc29sYW5hJywge1xuICAgICAgICAgICAgdmFsdWU6IHNvbGFuYVByb3ZpZGVyLFxuICAgICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChfZSkge1xuICAgICAgICAvLyBzd2FsbG93OyBsZWdhY3kgcHJvdmlkZXIgaXMgYmVzdC1lZmZvcnRcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUcm9uTGluayAvIFRyb25XZWIgc2hpbSBcdTIwMTQgbW91bnQgb25seSBpZiBub3RoaW5nIGNsYWltcyB0aG9zZVxuICAgIC8vIGdsb2JhbHMgeWV0LiBUcm9uIGRBcHBzIGV4cGVjdCBgd2luZG93LnRyb25XZWIuZGVmYXVsdEFkZHJlc3MuYmFzZTU4YFxuICAgIC8vIHRvIGJlIHBvcHVsYXRlZCBhZnRlciBgdHJvbkxpbmsucmVxdWVzdCh7bWV0aG9kOid0cm9uX3JlcXVlc3RBY2NvdW50cyd9KWBcbiAgICAvLyByZXNvbHZlcywgc28gdGhlIHByb3ZpZGVyIGlzIHJlc3BvbnNpYmxlIGZvciBpdHMgb3duIGludGVybmFsXG4gICAgLy8gY29ubmVjdCBzdGF0ZS5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdHJvblByb3ZpZGVyID0gbmV3IEtlZXBLZXlUcm9uUHJvdmlkZXIod2FsbGV0UmVxdWVzdCk7XG4gICAgICBpZiAoIShrV2luZG93IGFzIGFueSkudHJvbkxpbmspIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGtXaW5kb3csICd0cm9uTGluaycsIHtcbiAgICAgICAgICB2YWx1ZTogdHJvblByb3ZpZGVyLnRyb25MaW5rLFxuICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCEoa1dpbmRvdyBhcyBhbnkpLnRyb25XZWIpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGtXaW5kb3csICd0cm9uV2ViJywge1xuICAgICAgICAgIHZhbHVlOiB0cm9uUHJvdmlkZXIudHJvbldlYixcbiAgICAgICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChfZSkge1xuICAgICAgLy8gc3dhbGxvdzsgVHJvbiByZWdpc3RyYXRpb24gaXMgYmVzdC1lZmZvcnRcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgY2hhaW4gY2hhbmdlcyBhbmQgb3RoZXIgZXZlbnRzXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQ6IE1lc3NhZ2VFdmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmRhdGE/LnR5cGUgPT09ICdDSEFJTl9DSEFOR0VEJykge1xuICAgICAgICBldGhlcmV1bS5lbWl0KCdjaGFpbkNoYW5nZWQnLCBldmVudC5kYXRhLnByb3ZpZGVyPy5jaGFpbklkKTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAnQUNDT1VOVFNfQ0hBTkdFRCcpIHtcbiAgICAgICAgaWYgKGV0aGVyZXVtLl9oYW5kbGVBY2NvdW50c0NoYW5nZWQpIHtcbiAgICAgICAgICBldGhlcmV1bS5faGFuZGxlQWNjb3VudHNDaGFuZ2VkKGV2ZW50LmRhdGEuYWNjb3VudHMgfHwgW10pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBOb3cgdmVyaWZ5IGluamVjdGlvbiBmb3IgY29udGVudCBzY3JpcHQgY29tbXVuaWNhdGlvblxuICAgIC8vIFRoaXMgaXMgbm9uLWJsb2NraW5nIGZvciBFSVAtNjk2M1xuICAgIHZlcmlmeUluamVjdGlvbigpLnRoZW4odmVyaWZpZWQgPT4ge1xuICAgICAgaWYgKCF2ZXJpZmllZCkge1xuICAgICAgICBpbmplY3Rpb25TdGF0ZS5sYXN0RXJyb3IgPSAnSW5qZWN0aW9uIG5vdCB2ZXJpZmllZCc7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBJbml0aWFsaXplIGltbWVkaWF0ZWx5IGZvciBFSVAtNjk2MyBjb21wbGlhbmNlXG4gIC8vIFRoZSBzcGVjIHJlcXVpcmVzIGFubm91bmNlbWVudCBhcyBlYXJseSBhcyBwb3NzaWJsZVxuICBtb3VudFdhbGxldCgpO1xuXG4gIC8vIEFsc28gcmUtcnVuIHdoZW4gRE9NIGlzIHJlYWR5IGluIGNhc2UgZEFwcCBsb2FkcyBsYXRlclxuICBpZiAoZG9jdW1lbnQucmVhZHlTdGF0ZSA9PT0gJ2xvYWRpbmcnKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignRE9NQ29udGVudExvYWRlZCcsICgpID0+IHtcbiAgICAgIC8vIFJlLWFubm91bmNlIHdoZW4gRE9NIGlzIHJlYWR5XG4gICAgICBpZiAoa1dpbmRvdy5ldGhlcmV1bSAmJiB0eXBlb2Yga1dpbmRvdy5kaXNwYXRjaEV2ZW50ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGV0aGVyZXVtID0ga1dpbmRvdy5ldGhlcmV1bSBhcyBXYWxsZXRQcm92aWRlcjtcbiAgICAgICAgYW5ub3VuY2VQcm92aWRlcihldGhlcmV1bSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn0pKCk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGtCQUFrQjtBQUV4QixXQUFTLGFBQWEsS0FBeUI7QUFDN0MsVUFBTSxRQUFrQixDQUFDLENBQUM7QUFDMUIsZUFBVyxRQUFRLEtBQUs7QUFDdEIsWUFBTSxNQUFNLGdCQUFnQixRQUFRLElBQUk7QUFDeEMsVUFBSSxRQUFRLEdBQUksT0FBTSxJQUFJLE1BQU0sMEJBQTBCO0FBQzFELFVBQUksUUFBUTtBQUNaLGVBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsaUJBQVMsTUFBTSxDQUFDLElBQUk7QUFDcEIsY0FBTSxDQUFDLElBQUksUUFBUTtBQUNuQixrQkFBVTtBQUFBLE1BQ1o7QUFDQSxhQUFPLFFBQVEsR0FBRztBQUNoQixjQUFNLEtBQUssUUFBUSxHQUFJO0FB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QUFXO0FBQUEsWUFDeEMsT0FBTyxhQUFhO0FBQUEsWUFDcEIsVUFBVTtBQUFBLFlBQ1YsY0FBYztBQUFBLFVBQ2hCLENBQUM7QUFBQSxRQUNIO0FBQUEsTUFDRixTQUFTLElBQUk7QUFBQSxNQUViO0FBR0EsYUFBTyxpQkFBaUIsV0FBVyxDQUFDLFVBQXdCO0FBM3BCaEU7QUE0cEJNLGNBQUksV0FBTSxTQUFOLG1CQUFZLFVBQVMsaUJBQWlCO0FBQ3hDLG1CQUFTLEtBQUssaUJBQWdCLFdBQU0sS0FBSyxhQUFYLG1CQUFxQixPQUFPO0FBQUEsUUFDNUQ7QUFDQSxjQUFJLFdBQU0sU0FBTixtQkFBWSxVQUFTLG9CQUFvQjtBQUMzQyxjQUFJLFNBQVMsd0JBQXdCO0FBQ25DLHFCQUFTLHVCQUF1QixNQUFNLEtBQUssWUFBWSxDQUFDLENBQUM7QUFBQSxVQUMzRDtBQUFBLFFBQ0Y7QUFBQSxNQUNGLENBQUM7QUFJRCxzQkFBZ0IsRUFBRSxLQUFLLGNBQVk7QUFDakMsWUFBSSxDQUFDLFVBQVU7QUFDYix5QkFBZSxZQUFZO0FBQUEsUUFDN0I7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBSUEsZ0JBQVk7QUFHWixRQUFJLFNBQVMsZUFBZSxXQUFXO0FBQ3JDLGVBQVMsaUJBQWlCLG9CQUFvQixNQUFNO0FBRWxELFlBQUksUUFBUSxZQUFZLE9BQU8sUUFBUSxrQkFBa0IsWUFBWTtBQUNuRSxnQkFBTSxXQUFXLFFBQVE7QUFDekIsMkJBQWlCLFFBQVE7QUFBQSxRQUMzQjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGLEdBQUc7IiwKICAibmFtZXMiOiBbImFkZHJlc3MiLCAiQkFTRTU4X0FMUEhBQkVUIiwgImJhc2U1OERlY29kZSIsICJiYXNlNThEZWNvZGUiLCAidHJ4IiwgIkV2ZW50RW1pdHRlciJdCn0K
