// Centralized explorer URL maps for all supported chains

export const EXPLORER_TX_URLS: Record<string, string> = {
  // UTXO
  'bip122:000000000019d6689c085ae165831e93': 'https://mempool.space/tx/',
  'bip122:000000006fe28c0ab6f1b372c1a6a246': 'https://blockchair.com/litecoin/transaction/',
  'bip122:1a91e3dace36e2be3bf030a65679fe82': 'https://blockchair.com/dogecoin/transaction/',
  'bip122:000000000000000000651ef99cb9fcbe': 'https://blockchair.com/bitcoin-cash/transaction/',
  'bip122:00000ffd590b1485b3caadc19b22e637': 'https://blockchair.com/dash/transaction/',
  // Cosmos
  'cosmos:cosmoshub-4': 'https://www.mintscan.io/cosmos/tx/',
  'cosmos:thorchain-1': 'https://runescan.io/tx/',
  'cosmos:mayachain-mainnet-v1': 'https://www.mayascan.org/tx/',
  'cosmos:osmosis-1': 'https://www.mintscan.io/osmosis/tx/',
  // Other
  'ripple:4109c6f2045fc7eff4cde8f9905d19c2': 'https://xrpscan.com/tx/',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'https://solscan.io/tx/',
  // EVM
  'eip155:1': 'https://etherscan.io/tx/',
  'eip155:137': 'https://polygonscan.com/tx/',
  'eip155:42161': 'https://arbiscan.io/tx/',
  'eip155:10': 'https://optimistic.etherscan.io/tx/',
  'eip155:43114': 'https://snowscan.xyz/tx/',
  'eip155:56': 'https://bscscan.com/tx/',
  'eip155:8453': 'https://basescan.org/tx/',
  'eip155:324': 'https://explorer.zksync.io/tx/',
};

export const EXPLORER_ADDRESS_URLS: Record<string, string> = {
  // UTXO
  'bip122:000000000019d6689c085ae165831e93': 'https://mempool.space/address/',
  'bip122:000000006fe28c0ab6f1b372c1a6a246': 'https://blockchair.com/litecoin/address/',
  'bip122:1a91e3dace36e2be3bf030a65679fe82': 'https://blockchair.com/dogecoin/address/',
  'bip122:000000000000000000651ef99cb9fcbe': 'https://blockchair.com/bitcoin-cash/address/',
  'bip122:00000ffd590b1485b3caadc19b22e637': 'https://blockchair.com/dash/address/',
  // Cosmos
  'cosmos:cosmoshub-4': 'https://www.mintscan.io/cosmos/address/',
  'cosmos:thorchain-1': 'https://runescan.io/address/',
  'cosmos:mayachain-mainnet-v1': 'https://www.mayascan.org/address/',
  'cosmos:osmosis-1': 'https://www.mintscan.io/osmosis/address/',
  // Other
  'ripple:4109c6f2045fc7eff4cde8f9905d19c2': 'https://xrpscan.com/account/',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'https://solscan.io/account/',
  // EVM
  'eip155:1': 'https://etherscan.io/address/',
  'eip155:137': 'https://polygonscan.com/address/',
  'eip155:42161': 'https://arbiscan.io/address/',
  'eip155:10': 'https://optimistic.etherscan.io/address/',
  'eip155:43114': 'https://snowscan.xyz/address/',
  'eip155:56': 'https://bscscan.com/address/',
  'eip155:8453': 'https://basescan.org/address/',
  'eip155:324': 'https://explorer.zksync.io/address/',
};

export function getExplorerTxUrl(networkId: string, txHash: string): string | null {
  const baseNetworkId = networkId.split('/')[0];
  const url = EXPLORER_TX_URLS[baseNetworkId];
  if (url) return url + txHash;
  return null;
}

export function getExplorerAddressUrl(networkId: string, address: string): string | null {
  const baseNetworkId = networkId.split('/')[0];
  const url = EXPLORER_ADDRESS_URLS[baseNetworkId];
  if (url) return url + address;
  return null;
}
