// Human chain names from a networkId / CAIP.
//
// Extracted from <Balances> so the switchers can share it. This matters most
// for EVM L2s: native ETH on Ethereum, Arbitrum, Optimism and Base all carry
// the name "Ethereum", the ticker "ETH" and the same asset logo, so a picker
// that shows only name + ticker renders four rows a user cannot tell apart
// (KEEPKEY_STYLE.md §5 — L2s show the chain, not the shared ETH ticker).
//
// Exact lookup on the chain id, never substring matching: `includes()` named
// Gnosis (eip155:100) "Optimism" and Base Sepolia "Base". An unknown chain
// shows its raw id rather than a wrong name.
import { COIN_MAP_LONG, NetworkIdToChain } from '@extension/shared';
import { getNetworkName } from './header/headerConstants';

export const getChainDisplayName = (networkId: string): string => {
  if (!networkId) return 'Unknown';
  const chainId = networkId.split('/')[0];
  const known = getNetworkName(chainId);
  if (known) return known;
  const long = COIN_MAP_LONG[NetworkIdToChain[chainId]];
  return long ? long.charAt(0).toUpperCase() + long.slice(1) : chainId;
};
