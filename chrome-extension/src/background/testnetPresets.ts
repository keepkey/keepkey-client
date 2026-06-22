// Default testnet definitions, toggled on/off via the "Show testnets"
// setting. Each carries multiple public RPCs so the failover stack
// (rpcFailover.ts for EVM, solanaHandler for Solana) has fallbacks.
// RPCs verified reachable + correct chainId on 2026-06-22.
//
// ponytail: hardcoded RPCs are a deliberate exception here — testnets
// are NOT in Pioneer's registry, so there's no source-of-truth to defer
// to. If Pioneer ever indexes them, drop these and let registry win.

export type EvmTestnet = {
  networkId: string;
  chainId: number;
  name: string;
  symbol: string;
  explorerUrl: string;
  rpcs: string[];
};

export type SolanaTestnet = {
  networkId: string;
  caip: string;
  name: string;
  symbol: string;
  explorerUrl: string;
  rpcs: string[];
};

export const EVM_TESTNETS: EvmTestnet[] = [
  {
    networkId: 'eip155:11155111',
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    symbol: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    rpcs: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io/sepolia'],
  },
  {
    networkId: 'eip155:84532',
    chainId: 84532,
    name: 'Base Sepolia',
    symbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
    rpcs: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
  },
];

// CAIP-2 solana reference = first 32 chars of the base58 genesis hash.
// Devnet genesis: EtWTRABZaYq6iMfeYKA7Kzv3HTKFbW7Rsv7zMxj2z9Y
export const SOLANA_DEVNET: SolanaTestnet = {
  networkId: 'solana:EtWTRABZaYq6iMfeYKA7Kzv3HTKFbW7R',
  caip: 'solana:EtWTRABZaYq6iMfeYKA7Kzv3HTKFbW7R/slip44:501',
  name: 'Solana Devnet',
  symbol: 'SOL',
  explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
  rpcs: ['https://api.devnet.solana.com'],
};

export const ALL_TESTNET_NETWORK_IDS = [...EVM_TESTNETS.map(t => t.networkId), SOLANA_DEVNET.networkId];
