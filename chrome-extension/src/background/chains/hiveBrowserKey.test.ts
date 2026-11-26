/**
 * Browser posting key: KeepKey-wrapped storage (CipherKeyValue mocked as a
 * device with its own secret), session lock rules, and signer routing.
 */
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { createBrowserKeyVault, IDLE_LOCK_MS, cipherKeyName, type DeviceCipher } from './hiveBrowserKey';
import { privateKeyToStm, privateKeyToWif } from './hiveKeys';
import { chooseHiveSigner, isPostingOnly } from './hiveSignerRouting';
import type { HiveOp } from './hiveTx';

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)));

/** A fake KeepKey: XOR with sha256(seed ‖ key ‖ iv) — reversible, seed-bound, button = callback. */
function fakeDevice(seed: string) {
  const presses: string[] = [];
  const cipher: DeviceCipher = async ({ key, valueHex, ivHex, decrypt }) => {
    presses.push(`${decrypt ? 'decrypt' : 'encrypt'}:${key}`);
    const pad = sha256(new TextEncoder().encode(`${seed}|${key}|${ivHex}`));
    const v = unhex(valueHex);
    return hex(v.map((b, i) => b ^ pad[i % 32]));
  };
  return { cipher, presses };
}

function memoryStore() {
  const data = new Map<string, any>();
  return {
    data,
    store: {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: any) => void data.set(k, JSON.parse(JSON.stringify(v))),
      remove: async (k: string) => void data.delete(k),
    },
  };
}

describe('browser key vault', () => {
  it('create: stores only ciphertext (no WIF, no private key, no K) and stays unlocked', async () => {
    const { store, data } = memoryStore();
    const device = fakeDevice('seed-A');
    const vault = createBrowserKeyVault({ store, cipher: device.cipher });
    const { pubkey } = await vault.create('sopadevs');
    expect(pubkey).toMatch(/^STM/);
    const priv = vault.signingKey('sopadevs')!;
    expect(privateKeyToStm(priv)).toBe(pubkey);
    const persisted = JSON.stringify([...data.values()]);
    expect(persisted).not.toContain(hex(priv));
    expect(persisted).not.toContain(privateKeyToWif(priv));
    expect(device.presses).toEqual([`encrypt:${cipherKeyName('sopadevs')}`]);
    expect(await vault.status('sopadevs')).toMatchObject({
      stored: true,
      pubkey,
      unlocked: true,
      mode: 'ask',
      source: 'generated',
    });
  });

  it('round-trip: lock, then unlock with the same KeepKey (one decrypt press) gives the same key', async () => {
    const { store } = memoryStore();
    const device = fakeDevice('seed-A');
    const vault = createBrowserKeyVault({ store, cipher: device.cipher });
    await vault.create('sopadevs');
    const before = hex(vault.signingKey('sopadevs')!);
    vault.lock('sopadevs');
    expect(vault.signingKey('sopadevs')).toBeNull();
    await vault.unlock('sopadevs');
    expect(hex(vault.signingKey('sopadevs')!)).toBe(before);
    expect(device.presses.filter(p => p.startsWith('decrypt'))).toHaveLength(1);
  });

  it('a new service worker (fresh vault, same storage) starts locked and needs the KeepKey', async () => {
    const { store } = memoryStore();
    const device = fakeDevice('seed-A');
    await createBrowserKeyVault({ store, cipher: device.cipher }).create('sopadevs');
    const restarted = createBrowserKeyVault({ store, cipher: device.cipher });
    expect(restarted.signingKey('sopadevs')).toBeNull();
    expect((await restarted.status('sopadevs')).unlocked).toBe(false);
    await restarted.unlock('sopadevs');
    expect(restarted.signingKey('sopadevs')).not.toBeNull();
  });

  it('another KeepKey (different seed) cannot unlock it', async () => {
    const { store } = memoryStore();
    await createBrowserKeyVault({ store, cipher: fakeDevice('seed-A').cipher }).create('sopadevs');
    const other = createBrowserKeyVault({ store, cipher: fakeDevice('seed-B').cipher });
    await expect(other.unlock('sopadevs')).rejects.toThrow(/cannot unlock/);
    expect(other.signingKey('sopadevs')).toBeNull();
  });

  it('import: a WIF round-trips through the KeepKey-wrapped storage', async () => {
    const { store, data } = memoryStore();
    const vault = createBrowserKeyVault({ store, cipher: fakeDevice('seed-A').cipher });
    const priv = new Uint8Array(32).fill(5);
    const wif = privateKeyToWif(priv);
    expect(vault.inspectWif(wif).pubkey).toBe(privateKeyToStm(priv));
    await vault.importWif('sopadevs', wif);
    expect(JSON.stringify([...data.values()])).not.toContain(wif);
    vault.lock();
    await vault.unlock('sopadevs');
    expect(hex(vault.signingKey('sopadevs')!)).toBe(hex(priv));
    expect((await vault.status('sopadevs')).source).toBe('imported');
  });

  it('a record from the earlier both-ways-confirm build is refused with a clear message, not a silent failure', async () => {
    const { store, data } = memoryStore();
    const vault = createBrowserKeyVault({ store, cipher: fakeDevice('seed-A').cipher });
    await vault.create('sopadevs');
    const key = [...data.keys()].find(k => k.startsWith('hiveBrowserKey:'))!;
    const legacy = { ...data.get(key) };
    delete legacy.cipherFlags;
    data.set(key, legacy);
    vault.lock();
    await expect(vault.unlock('sopadevs')).rejects.toThrow(/earlier test build/);
  });

  it('auto-locks after the idle timeout', async () => {
    let t = 1_000_000;
    const vault = createBrowserKeyVault({ store: memoryStore().store, cipher: fakeDevice('s').cipher, now: () => t });
    await vault.create('sopadevs');
    t += IDLE_LOCK_MS + 1;
    expect(vault.signingKey('sopadevs')).toBeNull();
  });

  it('a cancelled KeepKey press stores nothing', async () => {
    const { store, data } = memoryStore();
    const vault = createBrowserKeyVault({
      store,
      cipher: vi.fn(async () => Promise.reject(new Error('Action cancelled by user'))),
    });
    await expect(vault.create('sopadevs')).rejects.toThrow('cancelled');
    expect(data.size).toBe(0);
    expect(vault.signingKey('sopadevs')).toBeNull();
  });

  it('forget removes the record and the session; mode persists per account', async () => {
    const { store, data } = memoryStore();
    const vault = createBrowserKeyVault({ store, cipher: fakeDevice('s').cipher });
    await vault.create('sopadevs');
    await vault.setMode('sopadevs', 'client');
    expect((await vault.status('sopadevs')).mode).toBe('client');
    await vault.forget('sopadevs');
    expect(data.size).toBe(0);
    expect(await vault.status('sopadevs')).toMatchObject({ stored: false, unlocked: false, mode: 'ask' });
  });
});

describe('signer routing', () => {
  const post: HiveOp[] = [
    ['comment', { author: 'sopadevs' }],
    ['comment_options', { author: 'sopadevs' }],
  ];
  const transfer: HiveOp[] = [['transfer_to_vesting', { from: 'sopadevs' }]];
  const heJson: HiveOp[] = [
    ['custom_json', { required_auths: ['sopadevs'], required_posting_auths: [], id: 'ssc-mainnet-hive' }],
  ];

  it('active/owner ops always go to the KeepKey, even if the user picks the browser key', () => {
    expect(chooseHiveSigner({ ops: transfer, mode: 'client', browserKeyStored: true, deviceBlocked: false })).toEqual({
      signer: 'keepkey',
    });
    expect(
      chooseHiveSigner({
        ops: transfer,
        mode: 'client',
        browserKeyStored: true,
        deviceBlocked: false,
        choice: 'client',
      }),
    ).toHaveProperty('error');
    expect(chooseHiveSigner({ ops: heJson, mode: 'client', browserKeyStored: true, deviceBlocked: false })).toEqual({
      signer: 'keepkey',
    });
    expect(isPostingOnly([...post, ...transfer])).toBe(false);
  });

  it('over the device limit: the browser key only by explicit choice or the "client" setting', () => {
    expect(chooseHiveSigner({ ops: post, mode: 'ask', browserKeyStored: true, deviceBlocked: true })).toHaveProperty(
      'error',
    );
    expect(
      chooseHiveSigner({ ops: post, mode: 'keepkey', browserKeyStored: true, deviceBlocked: true }),
    ).toHaveProperty('error');
    expect(
      chooseHiveSigner({ ops: post, mode: 'ask', browserKeyStored: true, deviceBlocked: true, choice: 'client' }),
    ).toEqual({ signer: 'client' });
    expect(chooseHiveSigner({ ops: post, mode: 'client', browserKeyStored: true, deviceBlocked: true })).toEqual({
      signer: 'client',
    });
    expect(
      chooseHiveSigner({ ops: post, mode: 'ask', browserKeyStored: true, deviceBlocked: true, choice: 'keepkey' }),
    ).toHaveProperty('error');
    expect(chooseHiveSigner({ ops: post, mode: 'ask', browserKeyStored: false, deviceBlocked: true })).toHaveProperty(
      'error',
    );
  });

  it('within the limit: setting decides, KeepKey by default', () => {
    expect(chooseHiveSigner({ ops: post, mode: 'ask', browserKeyStored: true, deviceBlocked: false })).toEqual({
      signer: 'keepkey',
    });
    expect(chooseHiveSigner({ ops: post, mode: 'keepkey', browserKeyStored: true, deviceBlocked: false })).toEqual({
      signer: 'keepkey',
    });
    expect(chooseHiveSigner({ ops: post, mode: 'client', browserKeyStored: true, deviceBlocked: false })).toEqual({
      signer: 'client',
    });
    expect(chooseHiveSigner({ ops: post, mode: 'client', browserKeyStored: false, deviceBlocked: false })).toEqual({
      signer: 'keepkey',
    });
    expect(
      chooseHiveSigner({ ops: post, mode: 'ask', browserKeyStored: false, deviceBlocked: false, choice: 'client' }),
    ).toHaveProperty('error');
  });
});
