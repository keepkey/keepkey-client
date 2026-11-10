import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./keepAlive', () => ({ withServiceWorkerKeepAlive: (operation: () => Promise<unknown>) => operation() }));
import { readFromVault, keepKeyConnectionCode, isForegroundDeviceRequest, VAULT_LOCKED_MESSAGE } from './vaultDeviceAccess';

const sdk = { getClient: () => ({ getApiKey: () => 'synthetic-pairing-key' }) };
afterEach(() => vi.unstubAllGlobals());

describe('demand device access', () => {
  it('marks background pubkey reads cached-only', async () => {
    const fetcher = vi.fn(async () => Response.json({ pubkeys: [] }));
    vi.stubGlobal('fetch', fetcher);
    await readFromVault(sdk, '/api/pubkeys/batch', { paths: [] });
    expect(fetcher).toHaveBeenCalledWith('http://localhost:1646/api/pubkeys/batch', expect.objectContaining({
      headers: expect.objectContaining({ 'X-KeepKey-Device-Access': 'cached' }),
    }));
  });

  it('holds the exact foreground request pending through unlock without replay', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const body = { address_n: [1, 2, 3], show_display: true };
    const result = readFromVault(sdk, '/addresses/eth', body, true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      body: JSON.stringify(body), headers: { 'X-KeepKey-Device-Access': 'foreground' },
    });
    complete(Response.json({ address: 'synthetic-address' }));
    await expect(result).resolves.toEqual({ address: 'synthetic-address' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('explains a locked older Vault without re-pairing or retrying', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: 'locked' }, { status: 423 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(readFromVault(sdk, '/addresses/eth', {}, true)).rejects.toMatchObject({ status: 423, message: VAULT_LOCKED_MESSAGE });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps locked/no-cache and disconnected API states separate', () => {
    const connection = { vaultReachable: true, paired: true, devicePresent: true, deviceLocked: true };
    expect(keepKeyConnectionCode(connection, false)).toBe(6);
    expect(keepKeyConnectionCode(connection, true)).toBe(5);
    expect(keepKeyConnectionCode({ ...connection, vaultReachable: false }, true)).toBe(4);
    expect(keepKeyConnectionCode({ ...connection, paired: false }, false)).toBe(2);
  });

  it.each(['eth_requestAccounts', 'eth_signTransaction', 'personal_sign', 'solana_connect', 'transfer'])(
    'allows foreground wallet initialization for %s', method => expect(isForegroundDeviceRequest(method)).toBe(true),
  );
  it.each(['eth_accounts', 'eth_getBalance', 'eth_chainId', 'solana_disconnect', undefined])(
    'does not wake a device for passive request %s', method => expect(isForegroundDeviceRequest(method)).toBe(false),
  );
});
