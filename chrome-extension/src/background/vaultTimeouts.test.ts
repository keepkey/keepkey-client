import { describe, expect, it, vi } from 'vitest';
import { applyDeviceTimeouts, DEVICE_SIGN_TIMEOUT_MS, isDeviceSignPath } from './vaultTimeouts';

const fakeSdk = () => {
  const post = vi.fn(async (_path: string, _body?: unknown, _timeoutMs?: number) => ({ ok: true }));
  const client = { post };
  return { sdk: { getClient: () => client }, client, post };
};

describe('isDeviceSignPath', () => {
  it.each([
    '/eth/sign',
    '/eth/sign-typed-data',
    '/eth/sign-transaction',
    '/utxo/sign-transaction',
    '/cosmos/sign-amino-delegate',
  ])('treats %s as device-interactive', p => expect(isDeviceSignPath(p)).toBe(true));
  it.each(['/eth/verify', '/addresses/eth', '/api/v2/tx/broadcast', '/system/info/get-features', '/api/pubkeys/batch'])(
    'keeps %s on the short default',
    p => expect(isDeviceSignPath(p)).toBe(false),
  );
});

describe('applyDeviceTimeouts', () => {
  it('gives EVM sign routes the device deadline instead of the SDK 30s default', async () => {
    const { sdk, client, post } = fakeSdk();
    expect(applyDeviceTimeouts(sdk)).toBe(true);
    await client.post('/eth/sign-typed-data', { a: 1 });
    await client.post('/eth/sign', { m: '0x' });
    await client.post('/eth/sign-transaction', {});
    expect(post.mock.calls.map(c => c[2])).toEqual([
      DEVICE_SIGN_TIMEOUT_MS,
      DEVICE_SIGN_TIMEOUT_MS,
      DEVICE_SIGN_TIMEOUT_MS,
    ]);
  });

  it('leaves read routes on the SDK default and respects an explicit timeout', async () => {
    const { sdk, client, post } = fakeSdk();
    applyDeviceTimeouts(sdk);
    await client.post('/addresses/eth', {});
    await client.post('/eth/sign', {}, 1234);
    expect(post.mock.calls[0][2]).toBeUndefined();
    expect(post.mock.calls[1][2]).toBe(1234);
  });

  it('is idempotent', async () => {
    const { sdk, client, post } = fakeSdk();
    applyDeviceTimeouts(sdk);
    applyDeviceTimeouts(sdk);
    await client.post('/eth/sign', {});
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toBe(DEVICE_SIGN_TIMEOUT_MS);
  });

  it('reports false for an unexpected SDK shape', () => {
    expect(applyDeviceTimeouts({})).toBe(false);
    expect(applyDeviceTimeouts(null)).toBe(false);
  });
});
