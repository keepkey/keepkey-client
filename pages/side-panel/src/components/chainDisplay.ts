// Human chain names from a networkId / CAIP.
//
// Extracted from <Balances> so the switchers can share it. This matters most
// for EVM L2s: native ETH on Ethereum, Arbitrum, Optimism and Base all carry
// the name "Ethereum", the ticker "ETH" and the same asset logo, so a picker
// that shows only name + ticker renders four rows a user cannot tell apart
// (KEEPKEY_STYLE.md §5 — L2s show the chain, not the shared ETH ticker).
import { COIN_MAP_LONG, NetworkIdToChain } from '@extension/shared';

const EXACT: Array<[string, string]> = [
  ['eip155:1/', 'Ethereum'],
  ['eip155:8453', 'Base'],
  ['eip155:137', 'Polygon'],
  ['eip155:43114', 'Avalanche'],
  ['eip155:56', 'BSC'],
  ['eip155:10', 'Optimism'],
  ['eip155:42161', 'Arbitrum'],
  ['bip122:000000000019d6689c085ae165831e93', 'Bitcoin'],
  ['cosmos:thorchain', 'THORChain'],
  ['cosmos:mayachain', 'Maya'],
  ['hive:', 'Hive'],
  ['cosmos:', 'Cosmos'],
];

export const getChainDisplayName = (networkId: string): string => {
  if (!networkId) return 'Unknown';
  // Ordered, most specific first — `cosmos:` must not swallow `cosmos:thorchain`.
  for (const [needle, label] of EXACT) {
    if (networkId.includes(needle)) return label;
  }
  const chain = (NetworkIdToChain as any)[networkId.split('/')[0]];
  return (COIN_MAP_LONG as any)[chain] || 'Unknown';
};
