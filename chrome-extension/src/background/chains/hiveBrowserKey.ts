/**
 * Browser posting key vault (KeepKey Client). The KeepKey stays the vault for
 * owner + active; this key may only sign posting operations (see hiveTx.ts).
 *
 * Storage: the posting key is encrypted with AES-256-GCM under a random
 * 32-byte wrapping key K; only K is sent to the KeepKey, which encrypts it
 * with CipherKeyValue (device button). chrome.storage.local holds ciphertext
 * only — never the WIF, never K. The plaintext key lives in this service
 * worker's memory only while unlocked, and is dropped on lock, idle timeout,
 * device/wallet change or worker shutdown.
 *
 * Nothing in this module logs key material, and errors never include it.
 */
import { privateKeyToStm, wifToPrivateKey, generatePrivateKey } from './hiveKeys';

export type SignWith = 'keepkey' | 'client' | 'ask';
export type BrowserKeyRecord = {
  v: 1;
  account: string;
  pubkey: string;
  source: 'generated' | 'imported';
  createdAt: string;
  wrapIv: string; // hex, 16 bytes (CipherKeyValue IV)
  wrappedKey: string; // hex, 32 bytes (K encrypted by the KeepKey)
  gcmIv: string; // hex, 12 bytes
  ciphertext: string; // hex, AES-GCM(K, priv)
  /** CipherKeyValue flags K was wrapped with (vault-fixed: no button to wrap, button to unwrap). */
  cipherFlags?: 'E0D1';
};

/** Device-backed CipherKeyValue (vault REST /system/cipher-key-value). */
export type DeviceCipher = (req: { key: string; valueHex: string; ivHex: string; decrypt: boolean }) => Promise<string>;
export type KeyValueStore = {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
};

export const IDLE_LOCK_MS = 15 * 60_000;
const RECORD_PREFIX = 'hiveBrowserKey:';
const MODE_PREFIX = 'hiveSignWith:';

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map(x => parseInt(x, 16)));
export const cipherKeyName = (account: string) => `keepkey-client:hive-posting:${account}`;
const aad = (account: string, pubkey: string) => new TextEncoder().encode(`${cipherKeyName(account)}:${pubkey}`);

function assertAccount(account: string) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account)) throw new Error('Invalid Hive account name');
}

async function gcm(mode: 'encrypt' | 'decrypt', k: Uint8Array, iv: Uint8Array, data: Uint8Array, extra: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, [mode]);
  const out = await crypto.subtle[mode]({ name: 'AES-GCM', iv, additionalData: extra }, key, data);
  return new Uint8Array(out);
}

export function createBrowserKeyVault(deps: {
  store: KeyValueStore;
  cipher: DeviceCipher;
  random?: (n: number) => Uint8Array;
  now?: () => number;
}) {
  const random = deps.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const now = deps.now ?? (() => Date.now());
  const sessions = new Map<string, { priv: Uint8Array; pubkey: string; lastUsed: number }>();

  const wipe = (b: Uint8Array) => b.fill(0);

  async function load(account: string): Promise<BrowserKeyRecord | null> {
    const r = await deps.store.get(RECORD_PREFIX + account);
    return r && r.v === 1 && r.account === account ? (r as BrowserKeyRecord) : null;
  }

  /** Encrypt `priv` under a fresh K, have the KeepKey wrap K, persist ciphertext only. */
  async function protect(
    account: string,
    priv: Uint8Array,
    source: BrowserKeyRecord['source'],
  ): Promise<BrowserKeyRecord> {
    const pubkey = privateKeyToStm(priv);
    const k = random(32);
    try {
      const gcmIv = random(12);
      const ciphertext = await gcm('encrypt', k, gcmIv, priv, aad(account, pubkey));
      const wrapIv = random(16);
      const wrappedKey = await deps.cipher({
        key: cipherKeyName(account),
        valueHex: toHex(k),
        ivHex: toHex(wrapIv),
        decrypt: false,
      });
      if (!/^[0-9a-f]{64}$/i.test(wrappedKey)) throw new Error('KeepKey returned an unexpected encrypted value');
      const record: BrowserKeyRecord = {
        v: 1,
        account,
        pubkey,
        source,
        createdAt: new Date(now()).toISOString(),
        wrapIv: toHex(wrapIv),
        wrappedKey: wrappedKey.toLowerCase(),
        gcmIv: toHex(gcmIv),
        ciphertext: toHex(ciphertext),
        cipherFlags: 'E0D1',
      };
      await deps.store.set(RECORD_PREFIX + account, record);
      return record;
    } finally {
      wipe(k);
    }
  }

  function touch(account: string) {
    const s = sessions.get(account);
    if (!s) return null;
    if (now() - s.lastUsed > IDLE_LOCK_MS) {
      lock(account);
      return null;
    }
    s.lastUsed = now();
    return s;
  }

  function lock(account?: string) {
    for (const [a, s] of sessions) {
      if (account && a !== account) continue;
      wipe(s.priv);
      sessions.delete(a);
    }
  }

  return {
    async status(account: string) {
      const record = await load(account);
      const mode = ((await deps.store.get(MODE_PREFIX + account)) as SignWith) || 'ask';
      return {
        stored: !!record,
        pubkey: record?.pubkey ?? null,
        source: record?.source ?? null,
        unlocked: !!touch(account),
        mode: (['keepkey', 'client', 'ask'].includes(mode) ? mode : 'ask') as SignWith,
      };
    },

    /** New key: generated here, protected by the KeepKey, unlocked for this session. */
    async create(account: string) {
      assertAccount(account);
      if (await load(account))
        throw new Error(`A browser posting key for @${account} already exists — remove it first`);
      const priv = generatePrivateKey(random);
      let record: BrowserKeyRecord;
      try {
        record = await protect(account, priv, 'generated');
      } catch (e) {
        wipe(priv);
        throw e;
      }
      sessions.set(account, { priv, pubkey: record.pubkey, lastUsed: now() });
      return { pubkey: record.pubkey };
    },

    /** Parse a WIF without storing it (import validates the chain first). */
    inspectWif(wif: string) {
      const priv = wifToPrivateKey(wif);
      try {
        return { pubkey: privateKeyToStm(priv) };
      } finally {
        wipe(priv);
      }
    },

    /** Store an imported WIF (caller has checked it is on the posting authority, or will authorize it). */
    async importWif(account: string, wif: string) {
      assertAccount(account);
      if (await load(account))
        throw new Error(`A browser posting key for @${account} already exists — remove it first`);
      const priv = wifToPrivateKey(wif);
      let record: BrowserKeyRecord;
      try {
        record = await protect(account, priv, 'imported');
      } catch (e) {
        wipe(priv);
        throw e;
      }
      sessions.set(account, { priv, pubkey: record.pubkey, lastUsed: now() });
      return { pubkey: record.pubkey };
    },

    /** KeepKey + button: unwrap K, decrypt the key into memory. */
    async unlock(account: string) {
      const existing = touch(account);
      if (existing) return { pubkey: existing.pubkey };
      const record = await load(account);
      if (!record) throw new Error(`No browser posting key for @${account}`);
      if (record.cipherFlags !== 'E0D1') {
        throw new Error(
          'This browser key was saved by an earlier test build. Delete it from the browser and enable long posts again.',
        );
      }
      const kHex = await deps.cipher({
        key: cipherKeyName(account),
        valueHex: record.wrappedKey,
        ivHex: record.wrapIv,
        decrypt: true,
      });
      const k = fromHex(kHex);
      try {
        if (k.length !== 32) throw new Error('KeepKey could not unlock the browser key');
        let priv: Uint8Array;
        try {
          priv = await gcm(
            'decrypt',
            k,
            fromHex(record.gcmIv),
            fromHex(record.ciphertext),
            aad(account, record.pubkey),
          );
        } catch {
          throw new Error('This KeepKey cannot unlock the stored browser key (different wallet?)');
        }
        if (privateKeyToStm(priv) !== record.pubkey) {
          wipe(priv);
          throw new Error('Stored browser key does not match its public key');
        }
        sessions.set(account, { priv, pubkey: record.pubkey, lastUsed: now() });
        return { pubkey: record.pubkey };
      } finally {
        wipe(k);
      }
    },

    lock,

    /** The unlocked private key, or null. Callers must only hand it to hiveTx's posting signer. */
    signingKey(account: string): Uint8Array | null {
      return touch(account)?.priv ?? null;
    },

    async setMode(account: string, mode: SignWith) {
      assertAccount(account);
      if (!['keepkey', 'client', 'ask'].includes(mode)) throw new Error('Invalid signing mode');
      await deps.store.set(MODE_PREFIX + account, mode);
    },

    /** Delete the encrypted key (after a revoke, or when the user removes it). */
    async forget(account: string) {
      lock(account);
      await deps.store.remove(RECORD_PREFIX + account);
      await deps.store.remove(MODE_PREFIX + account);
    },
  };
}

export type BrowserKeyVault = ReturnType<typeof createBrowserKeyVault>;
