import { NetworkIdToChain, ChainToNetworkId, networkIdToIcon } from '@extension/shared';
import type { ChainFamily, NetworkItem, AccountItem, CustomEvmNetwork } from './headerTypes';
import { KNOWN_EVM_CHAINS, NETWORK_DISPLAY_NAMES, BTC_SCRIPT_LABELS, BTC_NETWORK_ID } from './headerConstants';

export function getChainFamily(networkId: string): ChainFamily {
  if (networkId.startsWith('eip155:')) return 'evm';
  if (networkId.startsWith('bip122:')) return 'utxo';
  if (networkId.startsWith('cosmos:')) return 'cosmos';
  return 'other';
}

export function formatAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function getIconUrl(chainSymbol: string, networkId?: string): string {
  if (networkId) return networkIdToIcon(networkId);
  const nid = (ChainToNetworkId as Record<string, string>)[chainSymbol];
  if (nid) return networkIdToIcon(nid);
  return `https://api.keepkey.info/coins/${btoa(chainSymbol.toLowerCase())}.png`;
}

export function parseAccountIndex(note?: string): number {
  if (!note) return 0;
  const match = note.match(/account\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Build a deduplicated list of networks (one per chain, no account variants).
 * EVM wildcard is expanded. Bitcoin = single entry. Each Cosmos chain = single entry.
 */
export function buildNetworkList(pubkeys: any[], customEvmNetworks: CustomEvmNetwork[]): NetworkItem[] {
  const items: NetworkItem[] = [];
  const seen = new Set<string>();

  let hasEvmWildcard = false;

  for (const pk of pubkeys) {
    const networks: string[] = pk.networks || [];
    if (networks.includes('eip155:*')) hasEvmWildcard = true;

    for (const networkId of networks) {
      if (networkId === 'eip155:*') continue;
      // Skip non-primary EVM chains from wildcard pubkeys — we expand below
      if (networks.includes('eip155:*') && networkId.startsWith('eip155:') && networkId !== 'eip155:1') continue;

      // For UTXO chains, deduplicate by networkId (not by script_type)
      if (seen.has(networkId)) continue;
      seen.add(networkId);

      const chainSymbol = NetworkIdToChain[networkId];
      const evmInfo = KNOWN_EVM_CHAINS[networkId];
      const name = evmInfo?.name || NETWORK_DISPLAY_NAMES[networkId] || chainSymbol || networkId;
      const icon = getIconUrl(evmInfo?.symbol || chainSymbol || '', networkId);

      items.push({
        networkId,
        name,
        icon,
        family: getChainFamily(networkId),
        isCustom: false,
      });
    }
  }

  // Expand EVM wildcard into all known EVM chains
  if (hasEvmWildcard) {
    for (const [networkId, info] of Object.entries(KNOWN_EVM_CHAINS)) {
      if (seen.has(networkId)) continue;
      seen.add(networkId);
      items.push({
        networkId,
        name: info.name,
        icon: getIconUrl(info.symbol, networkId),
        family: 'evm',
        isCustom: false,
      });
    }

    for (const custom of customEvmNetworks) {
      if (seen.has(custom.networkId)) continue;
      seen.add(custom.networkId);
      items.push({
        networkId: custom.networkId,
        name: custom.name,
        icon: getIconUrl(custom.symbol, custom.networkId),
        family: 'evm',
        isCustom: true,
      });
    }
  }

  return items;
}

/**
 * Build account list for a selected network.
 * - EVM (eip155:1 Ethereum): one row per ETH account index
 * - EVM (other): only account 0
 * - UTXO (Bitcoin): one row per script_type
 * - UTXO (other): available script types from pubkeys
 * - Cosmos/Other: single account
 */
export function buildAccountList(pubkeys: any[], selectedNetworkId: string, ethAccounts: number[]): AccountItem[] {
  const family = getChainFamily(selectedNetworkId);

  if (family === 'evm') {
    return buildEvmAccounts(pubkeys, selectedNetworkId, ethAccounts);
  }
  if (selectedNetworkId === BTC_NETWORK_ID) {
    return buildBtcAccounts(pubkeys);
  }
  if (family === 'utxo') {
    return buildUtxoAccounts(pubkeys, selectedNetworkId);
  }
  // cosmos, other — single account
  return buildSingleAccount(pubkeys, selectedNetworkId);
}

function buildEvmAccounts(pubkeys: any[], networkId: string, ethAccounts: number[]): AccountItem[] {
  const items: AccountItem[] = [];

  // All ETH-derived pubkeys — any account's address is valid on every EVM chain.
  // Account 0 has eip155:* wildcard, accounts 1+ have eip155:1 explicitly,
  // but the address works on Polygon, Base, Arbitrum, etc. regardless.
  const ethPubkeys = pubkeys.filter(pk => {
    const nets: string[] = pk.networks || [];
    return nets.includes('eip155:1') || nets.includes('eip155:*');
  });

  for (const idx of ethAccounts) {
    const pk = ethPubkeys.find(p => parseAccountIndex(p.note) === idx);
    if (!pk) continue;
    const address = pk.address || pk.master || '';
    items.push({
      key: `evm:account${idx}`,
      label: idx === 0 ? 'Account 0' : `Account ${idx}`,
      address,
      pubkey: pk,
      accountIndex: idx,
      path: idx === 0 ? "m/44'/60'/0'" : `m/44'/60'/${idx}'/0/0`,
      isDefault: idx === 0,
    });
  }

  return items;
}

function buildBtcAccounts(pubkeys: any[]): AccountItem[] {
  const items: AccountItem[] = [];
  const btcPubkeys = pubkeys.filter(pk => (pk.networks || []).includes(BTC_NETWORK_ID) && pk.script_type);

  for (const pk of btcPubkeys) {
    const label = BTC_SCRIPT_LABELS[pk.script_type] || pk.script_type;
    const address = pk.address || pk.master || '';
    items.push({
      key: `btc:${pk.script_type}`,
      label,
      address,
      pubkey: pk,
      scriptType: pk.script_type,
      isDefault: pk.script_type === 'p2wpkh', // Native SegWit is default
    });
  }

  return items;
}

function buildUtxoAccounts(pubkeys: any[], networkId: string): AccountItem[] {
  const items: AccountItem[] = [];
  const relevant = pubkeys.filter(pk => (pk.networks || []).includes(networkId));

  for (const pk of relevant) {
    const label = pk.script_type ? BTC_SCRIPT_LABELS[pk.script_type] || pk.script_type : 'Default';
    const address = pk.address || pk.master || '';
    items.push({
      key: `utxo:${pk.script_type || 'default'}`,
      label,
      address,
      pubkey: pk,
      scriptType: pk.script_type,
      isDefault: items.length === 0,
    });
  }

  if (items.length === 0) {
    // Fallback: find any pubkey for this network
    const pk = pubkeys.find(p => (p.networks || []).includes(networkId));
    if (pk) {
      items.push({
        key: 'utxo:default',
        label: NETWORK_DISPLAY_NAMES[networkId] || networkId,
        address: pk.address || pk.master || '',
        pubkey: pk,
        isDefault: true,
      });
    }
  }

  return items;
}

function buildSingleAccount(pubkeys: any[], networkId: string): AccountItem[] {
  const pk = pubkeys.find(p => (p.networks || []).includes(networkId));
  if (!pk) return [];
  const chainSymbol = NetworkIdToChain[networkId];
  return [
    {
      key: `single:${networkId}`,
      label: NETWORK_DISPLAY_NAMES[networkId] || chainSymbol || 'Default',
      address: pk.address || pk.master || '',
      pubkey: pk,
      isDefault: true,
    },
  ];
}
