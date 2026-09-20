/*
 * Side-panel EVM sends must sign on the chain the user picked.
 *
 * handleTransfer builds, signs and broadcasts against web3ProviderStorage
 * (chainId, nonce, gas, fees, RPCs), not against the asset the Send form
 * carries. SET_ASSET_CONTEXT only rewrites that provider when it can resolve
 * the network, so a miss (Pioneer 404/unreachable) left the previous chain in
 * place: the user picked chain X and Send signed chain Y's chainId and
 * broadcast on Y. This check fails closed instead.
 *
 * A missing caip is refused, not defaulted to the provider chain: the side
 * panel always sends the asset-context caip (SET_ASSET_CONTEXT rejects assets
 * without one), so a transfer without one hasn't said which chain it means.
 * Token caips are refused too: handleTransfer only builds native value
 * transfers (no ERC-20 calldata), so "send 10 USDC" would sign "send 10 ETH".
 */
import { caipToNetworkId } from '../chainConfig';
import { createProviderRpcError } from '../utils';

// Stored chainIds come as '0x38', '56' or 56 depending on which path wrote
// them; CAIP-2 references are decimal. Normalize all to 'eip155:<decimal>'.
const toEip155 = (ref: unknown): string | null => {
  const s = String(ref ?? '').trim();
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN;
  return Number.isSafeInteger(n) ? `eip155:${n}` : null;
};

// SET_ASSET_CONTEXT: is a provider config (stored or custom record) with this
// chainId usable for an eip155 networkId? A record without one (e.g. a failed
// GET_ASSETS_INFO reply persisted as `{ error }`) is not.
export const chainIdMatchesNetwork = (networkId: string, chainId: unknown): boolean => {
  const wanted = networkId.startsWith('eip155:') ? toEip155(networkId.slice('eip155:'.length)) : null;
  return !!wanted && toEip155(chainId) === wanted;
};

export function assertProviderMatchesCaip(
  caip: string | undefined,
  provider: { chainId?: string | number } | null | undefined,
): void {
  // Coded errors: methods.ts rewraps uncoded ones as "Unexpected error
  // processing method transfer", which hides these messages from the Send toast.
  if (!caip) {
    throw createProviderRpcError(4000, 'Send request has no asset CAIP; refusing to guess which chain to sign for.');
  }

  const networkId = caipToNetworkId(caip);
  const requested = networkId.startsWith('eip155:') ? toEip155(networkId.slice('eip155:'.length)) : null;
  if (!requested) throw createProviderRpcError(4000, `Not an EVM asset: ${caip}`);

  const assetRef = caip.split('/')[1];
  if (assetRef && !assetRef.startsWith('slip44:')) {
    throw createProviderRpcError(
      4000,
      `Token sends are not supported from this screen yet (${caip}). Nothing was signed.`,
    );
  }

  // 4901 (EIP-1193): the provider is not connected to the requested chain.
  if (!provider) throw createProviderRpcError(4901, `No active EVM network. Re-select ${requested} and try again.`);
  // chainId is what gets signed into the tx, so it is the value to check.
  const signing = toEip155(provider.chainId);
  if (!signing) throw createProviderRpcError(4901, `Active EVM network has no usable chainId (${provider.chainId}).`);
  if (signing !== requested) {
    throw createProviderRpcError(
      4901,
      `Active network is ${signing} but this send is for ${requested}. Re-select the network and try again.`,
    );
  }
}

// dApp eth_sendTransaction / eth_signTransaction: a dApp that set tx.chainId
// built the calldata and value for that chain, but signing overwrites it with
// the provider's chainId — and a side-panel network switch never tells the
// page (no chainChanged). Refuse the mismatch, as MetaMask does. A tx without
// chainId means "the chain eth_chainId reported", i.e. the provider's.
export function assertDappChainMatchesProvider(
  txChainId: unknown,
  provider: { chainId?: string | number } | null | undefined,
): void {
  if (txChainId == null || txChainId === '') return;
  const requested = toEip155(txChainId);
  const signing = toEip155(provider?.chainId);
  if (!requested || requested !== signing) {
    throw createProviderRpcError(
      4901,
      `This transaction is for chain ${requested ?? String(txChainId)} but KeepKey is on ${signing ?? 'no network'}. Switch networks in the dApp and try again.`,
    );
  }
}
