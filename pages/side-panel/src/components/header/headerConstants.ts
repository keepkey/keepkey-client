import type { ChainFamily } from './headerTypes';

export const KNOWN_EVM_CHAINS: Record<string, { name: string; symbol: string }> = {
  'eip155:1': { name: 'Ethereum', symbol: 'ETH' },
  'eip155:42161': { name: 'Arbitrum', symbol: 'ARB' },
  'eip155:43114': { name: 'Avalanche', symbol: 'AVAX' },
  'eip155:56': { name: 'BNB Smart Chain', symbol: 'BSC' },
  'eip155:8453': { name: 'Base', symbol: 'BASE' },
  'eip155:10': { name: 'Optimism', symbol: 'OP' },
  'eip155:137': { name: 'Polygon', symbol: 'MATIC' },
  'eip155:324': { name: 'zkSync Era', symbol: 'ZKSYNC' },
};

// The native *gas* asset per EVM chain — distinct from the chain's own short
// symbol above (which labels the network in the header dropdown). Base,
// Arbitrum, Optimism and zkSync all pay gas in ETH, so an asset page must read
// "Ethereum / ETH on Base" — never "Base / BASE" (BASE/ARB/OP are chain labels
// or governance tokens, not the gas token the balance is actually denominated
// in). Chains whose gas token IS their namesake (ETH/AVAX/POL) get no "on X"
// qualifier. Custom networks fall back to their own row symbol.
export const EVM_NATIVE_GAS: Record<string, { name: string; symbol: string }> = {
  'eip155:1': { name: 'Ethereum', symbol: 'ETH' },
  'eip155:42161': { name: 'Ethereum', symbol: 'ETH' },
  'eip155:43114': { name: 'Avalanche', symbol: 'AVAX' },
  'eip155:56': { name: 'BNB', symbol: 'BNB' },
  'eip155:8453': { name: 'Ethereum', symbol: 'ETH' },
  'eip155:10': { name: 'Ethereum', symbol: 'ETH' },
  'eip155:137': { name: 'Polygon', symbol: 'POL' },
  'eip155:324': { name: 'Ethereum', symbol: 'ETH' },
};

// Resolve a short human network name from a networkId OR a caip (the
// `/slip44:…` asset suffix is stripped). EVM → KNOWN_EVM_CHAINS, everything
// else → NETWORK_DISPLAY_NAMES. Returns '' when unknown so callers can fall
// back (e.g. to a title-cased chainId). Used to tell same-symbol assets on
// different chains apart — "ETH on Base" vs "ETH on Ethereum".
export function getNetworkName(networkIdOrCaip?: string): string {
  if (!networkIdOrCaip) return '';
  const networkId = networkIdOrCaip.split('/')[0];
  if (networkId.startsWith('eip155:')) return KNOWN_EVM_CHAINS[networkId]?.name || '';
  return NETWORK_DISPLAY_NAMES[networkId] || '';
}

export const NETWORK_DISPLAY_NAMES: Record<string, string> = {
  'bip122:000000000019d6689c085ae165831e93': 'Bitcoin',
  'bip122:000000000000000000651ef99cb9fcbe': 'Bitcoin Cash',
  'bip122:00000000001a91e3dace36e2be3bf030': 'Dogecoin',
  'bip122:000007d91d1254d60e2dd1ae58038307': 'Dash',
  'bip122:12a765e31ffd4059bada1e25190f6e98': 'Litecoin',
  'cosmos:cosmoshub-4': 'Cosmos',
  'cosmos:thorchain-mainnet-v1': 'THORChain',
  'cosmos:mayachain-mainnet-v1': 'Maya',
  'cosmos:osmosis-1': 'Osmosis',
  'ripple:4109c6f2045fc7eff4cde8f9905d19c2': 'Ripple',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'Solana',
};

export const BTC_SCRIPT_LABELS: Record<string, string> = {
  p2pkh: 'Legacy',
  'p2sh-p2wpkh': 'SegWit',
  p2wpkh: 'Native SegWit',
};

export const BTC_NETWORK_ID = 'bip122:000000000019d6689c085ae165831e93';
export const SOLANA_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export const CHAIN_FAMILY_LABELS: Record<ChainFamily, string> = {
  evm: 'EVM Networks',
  utxo: 'UTXO Chains',
  cosmos: 'Cosmos Ecosystem',
  other: 'Other',
};

export const stateNames: Record<number, string> = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
  5: 'paired',
};
