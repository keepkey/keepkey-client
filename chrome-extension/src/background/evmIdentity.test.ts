import { describe, expect, it, vi } from 'vitest';
import { Wallet, getBytes, hexlify, toUtf8Bytes } from 'ethers';
import { ethereumAccountPath, signEthereumMessage, synchronizeEthereumAccount } from './evmIdentity';

const owner = Wallet.createRandom();
const switched = Wallet.createRandom();
const keys = (address = owner.address, accountIndex = 0) => [{ address, accountIndex, networks: ['eip155:*'] }];
const sdkFor = (live = owner, signer = live) => ({
  address: { ethGetAddress: vi.fn(async () => ({ address: live.address })) },
  eth: { ethSignMessage: vi.fn(async ({ message }) => ({ signature: await signer.signMessage(getBytes(message)) })) },
});

describe('EVM wallet identity', () => {
  it('refreshes stale connected account even when hardware identity did not change', async () => {
    const refresh = vi.fn(async () => {});
    const sdk = sdkFor(switched);
    expect(await synchronizeEthereumAccount(sdk, keys(), owner.address, refresh)).toBe(switched.address);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(switched.address);
    expect(sdk.address.ethGetAddress).toHaveBeenCalledWith({
      address_n: [2147483692, 2147483708, 2147483648, 0, 0],
      show_display: false,
    });
  });

  it('does not clear caches when the selected account remains current', async () => {
    const refresh = vi.fn(async () => {});
    await synchronizeEthereumAccount(sdkFor(), keys(), owner.address.toLowerCase(), refresh);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not report the cached account when Vault is unavailable', async () => {
    const sdk = sdkFor();
    sdk.address.ethGetAddress.mockRejectedValueOnce(new Error('Vault unavailable'));
    await expect(synchronizeEthereumAccount(sdk, keys(), owner.address, async () => {})).rejects.toThrow(
      'Vault unavailable',
    );
  });

  it('preserves the selected account derivation path', () => {
    expect(ethereumAccountPath(keys(owner.address, 2), owner.address)).toEqual([
      2147483692, 2147483708, 2147483650, 0, 0,
    ]);
  });

  it('rejects an unknown signing account instead of silently using account zero', async () => {
    const sdk = sdkFor();
    await expect(signEthereumMessage(sdk, keys(), switched.address, 'Pioneer API')).rejects.toMatchObject({
      code: 4100,
    });
    expect(sdk.eth.ethSignMessage).not.toHaveBeenCalled();
  });

  it('rejects a changed Vault account before signing', async () => {
    const sdk = sdkFor(switched);
    await expect(signEthereumMessage(sdk, keys(), owner.address, 'Pioneer API')).rejects.toMatchObject({ code: 4100 });
    expect(sdk.eth.ethSignMessage).not.toHaveBeenCalled();
  });

  it('rejects a different signer even when Vault address cache still says the old account', async () => {
    const sdk = sdkFor(owner, switched);
    await expect(signEthereumMessage(sdk, keys(), owner.address, 'Pioneer API')).rejects.toMatchObject({ code: 4100 });
  });

  it.each(['Pioneer API\nChallenge: login', hexlify(toUtf8Bytes('Pioneer API\nChallenge: login'))])(
    'returns a verified personal signature for plaintext or hex input',
    async message => {
      const sdk = sdkFor();
      const signature = await signEthereumMessage(sdk, keys(), owner.address, message);
      expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);
    },
  );
});
