import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./keepAlive', () => ({ withServiceWorkerKeepAlive: (operation: () => Promise<unknown>) => operation() }));

const stores = vi.hoisted(() => ({
  getApiKey: vi.fn(),
  saveApiKey: vi.fn(),
  loadPubkeys: vi.fn(),
  isCacheEnabled: vi.fn(),
  clearPubkeys: vi.fn(),
  savePubkeys: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@extension/storage', () => ({
  keepKeyApiKeyStorage: { getApiKey: stores.getApiKey, saveApiKey: stores.saveApiKey },
  pubkeyStorage: {
    loadPubkeys: stores.loadPubkeys,
    isCacheEnabled: stores.isCacheEnabled,
    clearPubkeys: stores.clearPubkeys,
    savePubkeys: stores.savePubkeys,
  },
}));
vi.mock('keepkey-vault-sdk', () => ({ KeepKeySdk: { create: stores.create } }));
vi.mock('./chainConfig', () => ({
  getDefaultPaths: () => [
    { note: 'Ethereum account 0', addressNList: [1, 2, 3], networks: ['eip155:*'], type: 'address' },
  ],
}));

const key = 'synthetic-pairing-key';
const pubkey = {
  note: 'Ethereum account 0',
  address: '0x0000000000000000000000000000000000000001',
  networks: ['eip155:*'],
};
let client: { getApiKey: () => string; post: ReturnType<typeof vi.fn> };
let batchStatus = 423;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  batchStatus = 423;
  stores.getApiKey.mockResolvedValue(key);
  stores.isCacheEnabled.mockResolvedValue(true);
  stores.loadPubkeys.mockResolvedValue({ pubkeys: [] });
  client = {
    getApiKey: () => key,
    post: vi.fn(async () => ({
      label: 'Synthetic KeepKey',
      device_id: 'wallet-a',
      pin_protection: true,
      pin_cached: false,
    })),
  };
  stores.create.mockResolvedValue({ getClient: () => client });
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/api/health')) return Response.json({ device_connected: true, device_locked: true });
    if (url.endsWith('/auth/pair')) return Response.json({ paired: true });
    if (url.endsWith('/api/pubkeys/batch'))
      return batchStatus === 423
        ? Response.json({ error: 'locked' }, { status: 423 })
        : Response.json({ pubkeys: [pubkey] });
    throw new Error('Unexpected synthetic request');
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('locked Vault connection', () => {
  it('stays reachable and paired on a cold-start cache miss without requesting PIN', async () => {
    const wallet = await import('./wallet');
    const result = await wallet.init();
    expect(result.initialized).toBe(false);
    expect(wallet.getConnectionState()).toEqual({
      vaultReachable: true,
      paired: true,
      devicePresent: true,
      deviceLocked: true,
    });
    const batch = fetcher.mock.calls.find(([url]) => url.endsWith('/api/pubkeys/batch'));
    expect(batch?.[1]).toMatchObject({ headers: { 'X-KeepKey-Device-Access': 'cached' } });
    expect(stores.saveApiKey).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => /sign|unlock/.test(url))).toBe(false);
  });

  it('keeps existing monitoring data while locked', async () => {
    stores.loadPubkeys.mockResolvedValue({ pubkeys: [pubkey], deviceInfo: { deviceId: 'wallet-a' } });
    const wallet = await import('./wallet');
    await wallet.init();
    expect(wallet.isInitialized()).toBe(true);
    expect(wallet.getPubkeys()[0].address).toBe(pubkey.address);
    expect(wallet.getConnectionState().deviceLocked).toBe(true);
    expect(stores.clearPubkeys).not.toHaveBeenCalled();
    expect(stores.saveApiKey).not.toHaveBeenCalled();
  });

  it('uses foreground access only after an explicit wallet load', async () => {
    const wallet = await import('./wallet');
    await wallet.init();
    batchStatus = 200;
    await wallet.refreshPubkeys(true);
    const batches = fetcher.mock.calls.filter(([url]) => url.endsWith('/api/pubkeys/batch'));
    expect(batches).toHaveLength(2);
    expect(batches[0][1]).toMatchObject({ headers: { 'X-KeepKey-Device-Access': 'cached' } });
    expect(batches[1][1]).toMatchObject({ headers: { 'X-KeepKey-Device-Access': 'foreground' } });
    expect(wallet.isInitialized()).toBe(true);
    expect(stores.saveApiKey).not.toHaveBeenCalled();
  });

  it('does not confuse a PIN-active feature-probe 423 with disconnection', async () => {
    const wallet = await import('./wallet');
    await wallet.init();
    vi.spyOn(client, 'post').mockRejectedValueOnce(Object.assign(new Error('PIN active'), { status: 423 }));
    await expect(wallet.probeDevice()).resolves.toBe(true);
    expect(wallet.getConnectionState()).toMatchObject({
      vaultReachable: true,
      paired: true,
      devicePresent: true,
      deviceLocked: true,
    });
    expect(stores.saveApiKey).not.toHaveBeenCalled();
  });

  it('keeps pairing across a real API outage', async () => {
    const wallet = await import('./wallet');
    await wallet.init();
    wallet.markVaultUnreachable();
    expect(wallet.getConnectionState()).toEqual({
      vaultReachable: false,
      paired: true,
      devicePresent: false,
      deviceLocked: false,
    });
    expect(stores.saveApiKey).not.toHaveBeenCalled();
  });

  it('does not let public health promote an unverified device identity after reconnect', async () => {
    const wallet = await import('./wallet');
    await wallet.init();
    wallet.markVaultUnreachable();
    wallet.recordVaultHealth({ device_connected: true, device_locked: true });
    expect(wallet.getConnectionState().devicePresent).toBe(true);
    expect(wallet.isDeviceConnected()).toBe(false);
  });

  it('discards the previous device cache before handling a new locked wallet', async () => {
    stores.loadPubkeys.mockResolvedValue({ pubkeys: [pubkey], deviceInfo: { deviceId: 'wallet-old' } });
    stores.clearPubkeys.mockImplementation(async () => stores.loadPubkeys.mockResolvedValue({ pubkeys: [] }));
    const wallet = await import('./wallet');
    await wallet.init();
    expect(stores.clearPubkeys).toHaveBeenCalledOnce();
    expect(wallet.getPubkeys()).toEqual([]);
    expect(wallet.isInitialized()).toBe(false);
    expect(wallet.getConnectionState()).toMatchObject({ vaultReachable: true, paired: true, deviceLocked: true });
  });
});
