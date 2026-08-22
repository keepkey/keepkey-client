/**
 * Chain configuration for background service worker.
 * Re-exports shared chain config and adds BIP44 path definitions (only needed by background).
 */

// Re-export everything from shared chain config
export {
  Chain,
  type ChainValue,
  ChainToNetworkId,
  NetworkIdToChain,
  COIN_MAP_LONG,
  caipToNetworkId,
  availableChainsByWallet,
  getChainEnumValue,
  networkIdToIcon,
  caipToIcon,
} from '@extension/shared';

// shortListSymbolToCaip and shortListNameToCaip are background-only (not needed by side-panel)
export const shortListSymbolToCaip: Record<string, string> = {
  ATOM: 'cosmos:cosmoshub-4/slip44:118',
  ARB: 'eip155:42161/slip44:60',
  BTC: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
  BASE: 'eip155:8453/slip44:60',
  OSMO: 'cosmos:osmosis-1/slip44:118',
  BCH: 'bip122:000000000000000000651ef99cb9fcbe/slip44:145',
  LTC: 'bip122:12a765e31ffd4059bada1e25190f6e98/slip44:2',
  GAIA: 'cosmos:cosmoshub-4/slip44:118',
  DASH: 'bip122:000007d91d1254d60e2dd1ae58038307/slip44:5',
  DOGE: 'bip122:00000000001a91e3dace36e2be3bf030/slip44:3',
  RUNE: 'cosmos:thorchain-mainnet-v1/slip44:931',
  THOR: 'cosmos:thorchain-mainnet-v1/slip44:931',
  MAYA: 'cosmos:mayachain-mainnet-v1/slip44:931',
  ETH: 'eip155:1/slip44:60',
  XRP: 'ripple:4109c6f2045fc7eff4cde8f9905d19c2/slip44:144',
  MATIC: 'eip155:137/slip44:60',
  OP: 'eip155:10/slip44:60',
  RHD: 'eip155:4663/slip44:60',
  AVAX: 'eip155:43114/slip44:60',
  BSC: 'eip155:56/slip44:60',
  BNB: 'eip155:56/slip44:60',
  SOL: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501',
  TON: 'ton:-239/slip44:607',
  TRX: 'tron:27Lqcw/slip44:195',
  HIVE: 'hive:beeab0de/slip44:1275',
};

export const shortListNameToCaip: Record<string, string> = {
  bitcoin: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
  arbitrum: 'eip155:42161/slip44:60',
  cosmos: 'cosmos:cosmoshub-4/slip44:118',
  osmosis: 'cosmos:osmosis-1/slip44:118',
  polygon: 'eip155:137/slip44:60',
  bitcoincash: 'bip122:000000000000000000651ef99cb9fcbe/slip44:145',
  litecoin: 'bip122:12a765e31ffd4059bada1e25190f6e98/slip44:2',
  dash: 'bip122:000007d91d1254d60e2dd1ae58038307/slip44:5',
  dogecoin: 'bip122:00000000001a91e3dace36e2be3bf030/slip44:3',
  thorchain: 'cosmos:thorchain-mainnet-v1/slip44:931',
  mayachain: 'cosmos:mayachain-mainnet-v1/slip44:931',
  ethereum: 'eip155:1/slip44:60',
  avalanche: 'eip155:43114/slip44:60',
  bnbsmartchain: 'eip155:56/slip44:60',
  ripple: 'ripple:4109c6f2045fc7eff4cde8f9905d19c2/slip44:144',
  optimism: 'eip155:10/slip44:60',
  base: 'eip155:8453/slip44:60',
  robinhood: 'eip155:4663/slip44:60',
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501',
  ton: 'ton:-239/slip44:607',
  tron: 'tron:27Lqcw/slip44:195',
  hive: 'hive:beeab0de/slip44:1275',
};

// ---- bip32ToAddressNList ----
const HARDENED = 0x80000000;

export const bip32ToAddressNList = (path: string): number[] => {
  if (/^m\//i.test(path)) {
    path = path.slice(2);
  }
  const segments = path.split('/');
  if (segments.length === 1 && segments[0] === '') return [];
  return segments.map(seg => {
    const m = /(\d+)([hH']?)/.exec(seg);
    if (!m) throw new Error(`Invalid BIP32 segment: ${seg}`);
    let idx = parseInt(m[1], 10);
    if (m[2]) idx += HARDENED;
    return idx;
  });
};

// ---- Default derivation paths ----
export interface PathConfig {
  note: string;
  networks: string[];
  script_type?: string;
  available_scripts_types?: string[];
  type: string;
  addressNList: number[];
  addressNListMaster: number[];
  curve: string;
  showDisplay: boolean;
  blockchain?: string;
  symbol?: string;
  symbolSwapKit?: string;
  accountIndex?: number;
}

const H = HARDENED;

export function getDefaultPaths(): PathConfig[] {
  return [
    {
      note: 'ETH primary (default)',
      networks: ['eip155:1', 'eip155:*'],
      type: 'address',
      addressNList: [H + 44, H + 60, H + 0],
      addressNListMaster: [H + 44, H + 60, H + 0, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
      accountIndex: 0,
    },
    {
      note: 'Bitcoin account 0',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [H + 44, H + 0, H + 0],
      addressNListMaster: [H + 44, H + 0, H + 0, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin account 0 segwit (p2sh)',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2sh-p2wpkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [H + 49, H + 0, H + 0],
      addressNListMaster: [H + 49, H + 0, H + 0, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin account 0 Native Segwit (Bech32)',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2wpkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'zpub',
      addressNList: [H + 84, H + 0, H + 0],
      addressNListMaster: [H + 84, H + 0, H + 0, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin account 1 Native Segwit (Bech32)',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2wpkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'zpub',
      addressNList: [H + 84, H + 0, H + 1],
      addressNListMaster: [H + 84, H + 0, H + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin account 1 legacy',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [H + 44, H + 0, H + 1],
      addressNListMaster: [H + 44, H + 0, H + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin account 2 legacy',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [H + 44, H + 0, H + 2],
      addressNListMaster: [H + 44, H + 0, H + 2, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin account 3 legacy',
      blockchain: 'bitcoin',
      symbol: 'BTC',
      symbolSwapKit: 'BTC',
      networks: ['bip122:000000000019d6689c085ae165831e93'],
      script_type: 'p2pkh',
      available_scripts_types: ['p2pkh', 'p2sh', 'p2wpkh', 'p2sh-p2wpkh'],
      type: 'xpub',
      addressNList: [H + 44, H + 0, H + 3],
      addressNListMaster: [H + 44, H + 0, H + 3, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Bitcoin Cash Default path',
      type: 'xpub',
      script_type: 'p2pkh',
      addressNList: [H + 44, H + 145, H + 0],
      addressNListMaster: [H + 44, H + 145, H + 0, 0, 0],
      networks: ['bip122:000000000000000000651ef99cb9fcbe'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Dogecoin Default path',
      type: 'xpub',
      script_type: 'p2pkh',
      addressNList: [H + 44, H + 3, H + 0],
      addressNListMaster: [H + 44, H + 3, H + 0, 0, 0],
      networks: ['bip122:00000000001a91e3dace36e2be3bf030'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Default dash path',
      type: 'xpub',
      script_type: 'p2pkh',
      addressNList: [H + 44, H + 5, H + 0],
      addressNListMaster: [H + 44, H + 5, H + 0, 0, 0],
      networks: ['bip122:000007d91d1254d60e2dd1ae58038307'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Litecoin Default path',
      type: 'xpub',
      script_type: 'p2pkh',
      addressNList: [H + 44, H + 2, H + 0],
      addressNListMaster: [H + 44, H + 2, H + 0, 0, 0],
      networks: ['bip122:12a765e31ffd4059bada1e25190f6e98'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Litecoin account 0 Native Segwit (Bech32)',
      networks: ['bip122:12a765e31ffd4059bada1e25190f6e98'],
      script_type: 'p2wpkh',
      type: 'zpub',
      addressNList: [H + 84, H + 2, H + 0],
      addressNListMaster: [H + 84, H + 2, H + 0, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Default ATOM path',
      type: 'address',
      script_type: 'cosmos',
      addressNList: [H + 44, H + 118, H + 0, 0, 0],
      addressNListMaster: [H + 44, H + 118, H + 0, 0, 0],
      networks: ['cosmos:cosmoshub-4'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Default OSMO path',
      type: 'address',
      script_type: 'bech32',
      addressNList: [H + 44, H + 118, H + 0, 0, 0],
      addressNListMaster: [H + 44, H + 118, H + 0, 0, 0],
      networks: ['cosmos:osmosis-1'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Default RUNE path',
      type: 'address',
      script_type: 'thorchain',
      addressNList: [H + 44, H + 931, H + 0, 0, 0],
      addressNListMaster: [H + 44, H + 931, H + 0, 0, 0],
      networks: ['cosmos:thorchain-mainnet-v1'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Default CACAO path',
      type: 'address',
      script_type: 'mayachain',
      addressNList: [H + 44, H + 931, H + 0, 0, 0],
      addressNListMaster: [H + 44, H + 931, H + 0, 0, 0],
      networks: ['cosmos:mayachain-mainnet-v1'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Default ripple path',
      type: 'address',
      blockchain: 'ripple',
      script_type: 'p2pkh',
      addressNList: [H + 44, H + 144, H + 0],
      addressNListMaster: [H + 44, H + 144, H + 0, 0, 0],
      networks: ['ripple:4109c6f2045fc7eff4cde8f9905d19c2'],
      curve: 'secp256k1',
      showDisplay: false,
    },
    {
      note: 'Ethereum account 1',
      networks: ['eip155:1'],
      script_type: 'ethereum',
      type: 'address',
      addressNList: [H + 44, H + 60, H + 1, 0, 0],
      addressNListMaster: [H + 44, H + 60, H + 1, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
      accountIndex: 1,
    },
    {
      note: 'Ethereum account 2',
      networks: ['eip155:1'],
      script_type: 'ethereum',
      type: 'address',
      addressNList: [H + 44, H + 60, H + 2, 0, 0],
      addressNListMaster: [H + 44, H + 60, H + 2, 0, 0],
      curve: 'secp256k1',
      showDisplay: false,
      accountIndex: 2,
    },
  ];
}

// ---- Multi-account support (non-EVM families) ----
export const SOLANA_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

// Human-readable per-network labels used to mint unique, parseable notes for
// dynamically-added accounts. Only networks listed here support "Add account"
// via accountsByNetworkStorage. Bitcoin (static accounts in getDefaultPaths)
// and EVM (ethAccountsStorage + eip155 wildcard) are intentionally absent —
// they have their own account models.
export const MULTI_ACCOUNT_LABELS: Record<string, string> = {
  'bip122:12a765e31ffd4059bada1e25190f6e98': 'Litecoin',
  'bip122:00000000001a91e3dace36e2be3bf030': 'Dogecoin',
  'bip122:000007d91d1254d60e2dd1ae58038307': 'Dash',
  'bip122:000000000000000000651ef99cb9fcbe': 'Bitcoin Cash',
  'cosmos:cosmoshub-4': 'Cosmos',
  'cosmos:osmosis-1': 'Osmosis',
  'cosmos:thorchain-mainnet-v1': 'THORChain',
  'cosmos:mayachain-mainnet-v1': 'Maya',
  [SOLANA_NETWORK_ID]: 'Solana',
};

export function supportsMultiAccount(networkId?: string): boolean {
  return !!networkId && networkId in MULTI_ACCOUNT_LABELS;
}

// Mint the derivation path(s) for `accountIndex` on `networkId` by cloning the
// account-0 template(s) from getDefaultPaths() and bumping the BIP44 account
// segment. For every family handled here the account index sits at
// addressNList[2] (UTXO: m/44'|49'|84'/coin'/account'; Cosmos:
// m/44'/coin'/account'/0/0), so we replace index 2 in both addressNList and
// addressNListMaster. UTXO chains with several script types (LTC has p2pkh +
// p2wpkh) yield one path per script type. Solana is excluded — it derives
// outside the batch xpub flow via solanaHandler. Returns [] for unsupported
// networks (including Bitcoin/EVM/Solana).
export function buildAccountPaths(networkId: string, accountIndex: number): PathConfig[] {
  const label = MULTI_ACCOUNT_LABELS[networkId];
  if (!label || networkId === SOLANA_NETWORK_ID) return [];
  const H = HARDENED;
  const templates = getDefaultPaths().filter(
    p =>
      p.networks?.includes(networkId) &&
      Array.isArray(p.addressNList) &&
      p.addressNList.length >= 3 &&
      p.addressNList[2] === H + 0,
  );
  const bump = (arr: number[]): number[] => arr.map((seg, i) => (i === 2 ? H + accountIndex : seg));
  return templates.map(t => ({
    ...t,
    // Note must be globally unique AND parseable as "account N": GET_PUBKEY_CONTEXT
    // scopes by note and the header parses the index out of it. Include
    // script_type so a chain's multiple script types don't collide on one index.
    note: `${label} account ${accountIndex}${t.script_type ? ` ${t.script_type}` : ''}`,
    addressNList: bump(t.addressNList),
    addressNListMaster: t.addressNListMaster ? bump(t.addressNListMaster) : bump(t.addressNList),
    accountIndex,
  }));
}
