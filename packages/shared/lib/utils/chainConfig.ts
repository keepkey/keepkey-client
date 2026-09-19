/**
 * Static chain configuration — replaces @pioneer-platform/pioneer-caip and @pioneer-platform/pioneer-coins
 * Shared across chrome-extension background and side-panel pages.
 */

// ---- Chain enum (matches Pioneer's Chain enum values) ----
export const Chain = {
  Arbitrum: 'ARB',
  Avalanche: 'AVAX',
  Base: 'BASE',
  // DO NOT add Binance Beacon Chain (BNB) — deprecated/broken chain, never re-add
  BinanceSmartChain: 'BSC',
  Bitcoin: 'BTC',
  BitcoinCash: 'BCH',
  Cosmos: 'GAIA',
  Dash: 'DASH',
  Dogecoin: 'DOGE',
  Ethereum: 'ETH',
  Litecoin: 'LTC',
  Mayachain: 'MAYA',
  Optimism: 'OP',
  Osmosis: 'OSMO',
  Polygon: 'MATIC',
  Ripple: 'XRP',
  Robinhood: 'RHD',
  Solana: 'SOL',
  THORChain: 'THOR',
  Ton: 'TON',
  Tron: 'TRX',
  Hive: 'HIVE',
} as const;

export type ChainValue = (typeof Chain)[keyof typeof Chain];

// ---- ChainToNetworkId ----
export const ChainToNetworkId: Record<string, string> = {
  ARB: 'eip155:42161',
  AVAX: 'eip155:43114',
  BSC: 'eip155:56',
  // DO NOT add BNB/binance:bnb-beacon-chain — deprecated/broken chain
  BCH: 'bip122:000000000000000000651ef99cb9fcbe',
  BTC: 'bip122:000000000019d6689c085ae165831e93',
  BASE: 'eip155:8453',
  GAIA: 'cosmos:cosmoshub-4',
  DASH: 'bip122:000007d91d1254d60e2dd1ae58038307',
  DOGE: 'bip122:00000000001a91e3dace36e2be3bf030',
  ETH: 'eip155:1',
  LTC: 'bip122:12a765e31ffd4059bada1e25190f6e98',
  MAYA: 'cosmos:mayachain-mainnet-v1',
  OP: 'eip155:10',
  OSMO: 'cosmos:osmosis-1',
  RHD: 'eip155:4663',
  MATIC: 'eip155:137',
  XRP: 'ripple:4109c6f2045fc7eff4cde8f9905d19c2',
  THOR: 'cosmos:thorchain-mainnet-v1',
  SOL: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  // Canonical CAIP-2 networkIds from keepkey-vault-v11/shared/chains.ts
  TON: 'ton:-239',
  TRX: 'tron:27Lqcw',
  HIVE: 'hive:beeab0de',
};

// ---- NetworkIdToChain (reverse map) ----
export const NetworkIdToChain: Record<string, string> = Object.fromEntries(
  Object.entries(ChainToNetworkId).map(([k, v]) => [v, k]),
);

// ---- COIN_MAP_LONG (symbol → full lowercase name) ----
export const COIN_MAP_LONG: Record<string, string> = {
  BTC: 'bitcoin',
  ATOM: 'cosmos',
  GAIA: 'cosmos',
  ARB: 'arbitrum',
  OSMO: 'osmosis',
  BASE: 'base',
  OP: 'optimism',
  BCH: 'bitcoincash',
  BSC: 'binance',
  LTC: 'litecoin',
  DASH: 'dash',
  DOGE: 'dogecoin',
  RUNE: 'thorchain',
  THOR: 'thorchain',
  MAYA: 'mayachain',
  CACAO: 'mayachain',
  ETH: 'ethereum',
  AVAX: 'avalanche',
  MATIC: 'polygon',
  RHD: 'robinhood',
  XRP: 'ripple',
  SOL: 'solana',
  TON: 'ton',
  TRX: 'tron',
  HIVE: 'hive',
};

// ---- availableChainsByWallet (replaces @pioneer-platform/pioneer-caip's version) ----
export const availableChainsByWallet: Record<string, string[]> = {
  KEEPKEY: Object.values(Chain),
};

// ---- FIRMWARE_GATED_CHAINS ----
// Chains that need a minimum KeepKey firmware. The add-blockchain picker shows
// these as locked (toggle disabled) with the required version when the device
// is below it. Keyed by networkId (no slip44 suffix). Hive shipped in 7.15.0.
export const FIRMWARE_GATED_CHAINS: Record<string, { major: number; minor: number; patch: number; label: string }> = {
  'hive:beeab0de': { major: 7, minor: 15, patch: 0, label: '7.15.0' },
};

// ---- getChainEnumValue (replaces @pioneer-platform/pioneer-caip's version) ----
const chainNameToEnum: Record<string, string> = {};
for (const [key, value] of Object.entries(Chain)) {
  chainNameToEnum[key] = value;
  chainNameToEnum[key.toLowerCase()] = value;
  chainNameToEnum[value] = value;
  chainNameToEnum[value.toLowerCase()] = value;
}
// Add long name mappings
for (const [symbol, longName] of Object.entries(COIN_MAP_LONG)) {
  chainNameToEnum[longName] = symbol;
}

export function getChainEnumValue(chainStr: string): string | undefined {
  return chainNameToEnum[chainStr] || chainNameToEnum[chainStr.toLowerCase()];
}

// ---- caipToNetworkId ----
export const caipToNetworkId = (caip: string): string => caip.split('/')[0];

// ---- caipToIcon ----
// Derive the keepkey.info icon URL from a CAIP identifier (matches vault v11 convention)
export const caipToIcon = (caip: string): string =>
  `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png`;

// ---- networkIdToIcon ----
// Derive icon URL from a networkId + slip44 convention (for EVM chains that share slip44:60)
const NETWORK_SLIP44: Record<string, string> = {
  'eip155:': 'slip44:60',
  'bip122:000000000019d6689c085ae165831e93': 'slip44:0',
  'bip122:000000000000000000651ef99cb9fcbe': 'slip44:145',
  'bip122:00000000001a91e3dace36e2be3bf030': 'slip44:3',
  'bip122:000007d91d1254d60e2dd1ae58038307': 'slip44:5',
  'bip122:12a765e31ffd4059bada1e25190f6e98': 'slip44:2',
  'cosmos:cosmoshub-4': 'slip44:118',
  'cosmos:thorchain-mainnet-v1': 'slip44:931',
  'cosmos:mayachain-mainnet-v1': 'slip44:931',
  'cosmos:osmosis-1': 'slip44:118',
  'ripple:4109c6f2045fc7eff4cde8f9905d19c2': 'slip44:144',
  // DO NOT add binance:bnb-beacon-chain — Binance Beacon Chain is deprecated/broken, never re-add
  // Native SOL uses slip44:501 — the wSOL SPL CAIP (So111…) 404s on
  // keepkey.info/coins, which caused the Solana network badge to render as a
  // letter-fallback "S" instead of the logo.
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'slip44:501',
  'tron:27Lqcw': 'slip44:195',
  'ton:-239': 'slip44:607',
  'hive:beeab0de': 'slip44:1275',
};

export function networkIdToIcon(networkId: string): string {
  // Try exact match first
  const slip44 = NETWORK_SLIP44[networkId];
  if (slip44) return caipToIcon(`${networkId}/${slip44}`);
  // Fallback: try prefix match (eip155: chains all use slip44:60)
  if (networkId.startsWith('eip155:')) return caipToIcon(`${networkId}/slip44:60`);
  // Last resort: encode just the networkId
  return caipToIcon(networkId);
}
