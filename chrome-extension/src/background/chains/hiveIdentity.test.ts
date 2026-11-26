/**
 * KEEPKEY-191: a KeepKey keeps its deviceId across a wipe and a new seed.
 * The Hive key cache was keyed by deviceId alone, so after an alpha flash the
 * extension kept serving the OLD seed's STM key (no account) and the Hive row
 * never appeared, although the new seed owned @sopadevs. The cache is now keyed
 * by deviceId + the account-0 ETH address, and an identity change drops the
 * in-memory caches too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEVICE = '39323130114737322D002F00';
const ETH_OLD = '0x909Ef6B32DfDc12CA86aA710b54c991af3C5F82E';
const ETH_NEW = '0xE64207e139d3a0348bB00651AC408CA9FB5F98DB';
const STM_OLD = 'STM6oldSeedKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const STM_NEW = 'STM7newSeedKeyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const device = { id: DEVICE as string | null, eth: ETH_OLD as string | undefined, vaultKey: STM_OLD };
const vaultReads = vi.fn();

vi.mock('../wallet', () => ({
  getDeviceId: () => device.id,
  getAddressForNetwork: (n: string) => (n === 'eip155:1' ? device.eth : undefined),
  getSdk: () => ({}),
  getConnectionState: () => ({ vaultReachable: true, paired: true, devicePresent: true, deviceLocked: false }),
}));
vi.mock('../vaultDeviceAccess', () => ({
  readFromVault: async (_sdk: unknown, path: string) => {
    vaultReads(path);
    return { address: device.vaultKey };
  },
  shouldRetryWithForeground: () => false,
  VAULT_LOCKED_MESSAGE: 'locked',
}));
vi.mock('../pioneerKey', () => ({ pioneerFetch: async () => new Response(JSON.stringify([0.2])) }));
vi.mock('../firmware', () => ({ requireHiveFirmware: vi.fn() }));
vi.mock('@extension/storage', () => ({ requestStorage: {} }));

// chrome.storage.local, in memory.
const store: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
      remove: async (key: string) => {
        delete store[key];
      },
    },
  },
};

// Pioneer: only the new seed's key owns an account.
globalThis.fetch = (async (url: string) => {
  const owned = String(url).endsWith(encodeURIComponent(STM_NEW));
  return new Response(
    JSON.stringify(
      owned
        ? { success: true, account: { name: 'sopadevs', hive: '1.000', hbd: '0.000' } }
        : { success: true, noAccount: true },
    ),
  );
}) as typeof fetch;

const load = async () => {
  vi.resetModules();
  return import('./hiveHandler');
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vaultReads.mockClear();
  Object.assign(device, { id: DEVICE, eth: ETH_OLD, vaultKey: STM_OLD });
});

describe('hiveWalletIdentity', () => {
  it('pairs device and lowercased ETH address; unknown halves give null', async () => {
    const { hiveWalletIdentity } = await load();
    expect(hiveWalletIdentity(DEVICE, ETH_NEW)).toBe(`${DEVICE}:${ETH_NEW.toLowerCase()}`);
    expect(hiveWalletIdentity(DEVICE, undefined)).toBeNull();
    expect(hiveWalletIdentity(null, ETH_NEW)).toBeNull();
  });
});

describe('Hive cache across a wipe + new seed on the same deviceId', () => {
  it('drops the old seed key (memory and storage) and finds the new account', async () => {
    const hive = await load();
    // Old seed: key has no account.
    expect(await hive.getHiveAccountInfo()).toEqual({ ok: false, reason: 'no-account' });
    expect(store[`hivePubkey:${DEVICE}:${ETH_OLD.toLowerCase()}`]).toBe(STM_OLD);

    // Flash + new seed: same deviceId, new ETH address, vault now derives a new key.
    Object.assign(device, { eth: ETH_NEW, vaultKey: STM_NEW });
    vaultReads.mockClear();
    const info = await hive.getHiveAccountInfo();
    expect(info).toMatchObject({ ok: true, name: 'sopadevs', pubkey: STM_NEW, hive: '1.000' });
    expect(vaultReads).toHaveBeenCalledTimes(1);
    expect(store[`hivePubkey:${DEVICE}:${ETH_NEW.toLowerCase()}`]).toBe(STM_NEW);
  });

  it('ignores and removes the device-only key written by earlier builds', async () => {
    store[`hivePubkey:${DEVICE}`] = STM_OLD; // what the Vlad's browser holds today
    Object.assign(device, { eth: ETH_NEW, vaultKey: STM_NEW });
    const hive = await load();
    expect(await hive.getHiveAccountInfo()).toMatchObject({ ok: true, name: 'sopadevs' });
    expect(vaultReads).toHaveBeenCalledTimes(1);
    expect(`hivePubkey:${DEVICE}` in store).toBe(false);
  });

  it('a cached account from the old identity is never served after the switch', async () => {
    Object.assign(device, { eth: ETH_NEW, vaultKey: STM_NEW });
    const hive = await load();
    expect(await hive.getHiveAccountInfo()).toMatchObject({ ok: true, name: 'sopadevs' });
    expect(hive.getCachedHiveInfo()).toMatchObject({ ok: true, name: 'sopadevs' });
    // Another seed on the same device (or a passphrase wallet).
    Object.assign(device, { eth: ETH_OLD, vaultKey: STM_OLD });
    expect(hive.getCachedHiveInfo()).toBeNull();
  });

  it('switching back to a known seed reuses its stored key without a vault read', async () => {
    store[`hivePubkey:${DEVICE}:${ETH_NEW.toLowerCase()}`] = STM_NEW;
    Object.assign(device, { eth: ETH_NEW, vaultKey: 'STM-should-not-be-read' });
    const hive = await load();
    expect(await hive.getHiveAccountInfo()).toMatchObject({ ok: true, pubkey: STM_NEW });
    expect(vaultReads).not.toHaveBeenCalled();
  });

  it('without an ETH address yet: reads the vault, persists nothing', async () => {
    store[`hivePubkey:${DEVICE}`] = STM_OLD;
    Object.assign(device, { eth: undefined, vaultKey: STM_NEW });
    const hive = await load();
    expect(await hive.getHiveAccountInfo()).toMatchObject({ ok: true, name: 'sopadevs' });
    expect(vaultReads).toHaveBeenCalledTimes(1);
    expect(Object.keys(store)).toEqual([`hivePubkey:${DEVICE}`]); // untouched, and never read
  });
});
