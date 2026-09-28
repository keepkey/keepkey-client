import { getAddress, getBytes, hexlify, toUtf8Bytes, verifyMessage } from 'ethers';
import { createProviderRpcError } from './utils';

const HARDENED = 0x80000000;
const changed = () => createProviderRpcError(4100, 'KeepKey account changed. Refresh KeepKey and connect again.');

export function ethereumAccountPath(pubkeys: any[], address: string, requireKnown = false): number[] {
  const match = pubkeys.find(
    pk =>
      (pk.networks?.includes('eip155:1') || pk.networks?.includes('eip155:*')) &&
      (pk.address?.toLowerCase() === address?.toLowerCase() || pk.master?.toLowerCase() === address?.toLowerCase()),
  );
  if (requireKnown && !match) throw changed();
  const account = match?.accountIndex ?? Number(match?.note?.match(/account\s*(\d+)/i)?.[1] ?? 0);
  if (!Number.isInteger(account) || account < 0 || account >= HARDENED) throw changed();
  return [HARDENED + 44, HARDENED + 60, HARDENED + account, 0, 0];
}

export async function readEthereumAddress(sdk: any, path: number[]): Promise<string> {
  const result = await sdk.address.ethGetAddress({ address_n: path, show_display: false });
  return getAddress(result.address);
}

/** A connect request must observe the active Vault wallet, even when the device
 * identifier is unchanged (an emulator or passphrase wallet can change keys). */
export async function synchronizeEthereumAccount(
  sdk: any,
  pubkeys: any[],
  selectedAddress: string,
  onChanged: (address: string) => Promise<void>,
): Promise<string> {
  const path = ethereumAccountPath(pubkeys, selectedAddress);
  const current = await readEthereumAddress(sdk, path);
  if (current.toLowerCase() !== selectedAddress.toLowerCase()) await onChanged(current);
  return current;
}

/** Validate both sides of signing. The device can switch after our preflight,
 * and an older Vault can return a stale cached address. Never return a signature
 * belonging to another account, even if its transport request succeeded. */
export async function signEthereumMessage(sdk: any, pubkeys: any[], address: string, message: string): Promise<string> {
  const requested = getAddress(address);
  const path = ethereumAccountPath(pubkeys, requested, true);
  if ((await readEthereumAddress(sdk, path)) !== requested) throw changed();
  const encoded = message.startsWith('0x') ? message : hexlify(toUtf8Bytes(message));
  const bytes = getBytes(encoded);
  const output = await sdk.eth.ethSignMessage({ address: requested, addressNList: path, message: encoded });
  const signature = typeof output === 'string' ? output : output?.signature;
  if (output?.address && getAddress(output.address) !== requested) throw changed();
  if (verifyMessage(bytes, signature) !== requested) throw changed();
  return signature;
}
