import { NetworkIdToChain, ChainToNetworkId, networkIdToIcon } from '@extension/shared';
import type { ChainFamily, NetworkItem, AccountItem, CustomEvmNetwork } from './headerTypes';
import {
  KNOWN_EVM_CHAINS,
  NETWORK_DISPLAY_NAMES,
  BTC_SCRIPT_LABELS,
  BTC_NETWORK_ID,
  SOLANA_NETWORK_ID,
} from './headerConstants';

export function getChainFamily(networkId: string): ChainFamily {
  if (networkId.startsWith('eip155:')) return 'evm';
  if (networkId.startsWith('bip122:')) return 'utxo';
  if (networkId.startsWith('cosmos:')) return 'cosmos';
  return 'other';
}

// Whether a network supports adding extra accounts. EVM goes through
// ethAccountsStorage (ADD_ETH_ACCOUNT); the rest through accountsByNetworkStorage
// (ADD_ACCOUNT). Bitcoin is excluded (its accounts are static in chainConfig);
// single-address chains (Ripple/TON/Tron) are excluded too. Mirror of the
// background's supportsMultiAccount — keep the two in sync.
export function supportsMultiAccount(networkId?: string | null): boolean {
  if (!networkId) return false;
  if (networkId.startsWith('eip155:')) return true;
  const family = getChainFamily(networkId);
  if (family === 'cosmos') return true; // ATOM / OSMO / RUNE / CACAO
  if (family === 'utxo') return networkId !== BTC_NETWORK_ID; // LTC / DOGE / DASH / BCH
  return networkId === SOLANA_NETWORK_ID;
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
  return '';
}

export function parseAccountIndex(note?: string, accountIndex?: number): number {
  // Prefer explicit accountIndex (set during pubkey enrichment)
  if (accountIndex !== undefined) return accountIndex;
  // Fallback: parse from note field
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
  // cosmos, other — one row per derived account (Cosmos/Solana can be multi)
  return buildMultiAccounts(pubkeys, selectedNetworkId);
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
    const pk = ethPubkeys.find(p => parseAccountIndex(p.note, p.accountIndex) === idx);
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

// "Bitcoin account 1 Native Segwit (Bech32)" → 1, "Default ATOM path" → null
function extractAccountIdxFromNote(note?: string): number | null {
  if (!note) return null;
  const m = note.match(/account\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function buildBtcAccounts(pubkeys: any[]): AccountItem[] {
  const items: AccountItem[] = [];
  const btcPubkeys = pubkeys.filter(pk => (pk.networks || []).includes(BTC_NETWORK_ID) && pk.script_type);

  // Multiple paths can share a script_type (chainConfig has BTC account 0
  // and account 1 both at p2wpkh, plus several legacy accounts). Track
  // duplicates so we know whether to suffix the label with the account
  // index — single-account script types stay clean ("Native SegWit"),
  // repeats get disambiguated ("Native SegWit · Account 1").
  const scriptTypeCounts = new Map<string, number>();
  for (const pk of btcPubkeys) {
    scriptTypeCounts.set(pk.script_type, (scriptTypeCounts.get(pk.script_type) || 0) + 1);
  }

  let defaultAssigned = false;
  for (const pk of btcPubkeys) {
    const baseLabel = BTC_SCRIPT_LABELS[pk.script_type] || pk.script_type;
    const accountIdx = extractAccountIdxFromNote(pk.note);
    const repeats = (scriptTypeCounts.get(pk.script_type) || 0) > 1;
    const label = repeats && accountIdx !== null ? `${baseLabel} · Account ${accountIdx}` : baseLabel;
    // Only the first p2wpkh row is the default — flagging every Native
    // Segwit row as default would let React's selection tracking pick
    // whichever happened to render first, regardless of account.
    const isDefault = !defaultAssigned && pk.script_type === 'p2wpkh';
    if (isDefault) defaultAssigned = true;

    const address = pk.address || pk.master || '';
    items.push({
      // Key on note (unique per chainConfig path) so React doesn't
      // collapse two p2wpkh rows into one and so selectedAccountKey
      // can disambiguate them.
      key: pk.note ? `btc:${pk.note}` : `btc:${pk.script_type}`,
      label,
      address,
      pubkey: pk,
      scriptType: pk.script_type,
      accountIndex: accountIdx ?? undefined,
      note: pk.note,
      isDefault,
    });
  }

  return items;
}

function buildUtxoAccounts(pubkeys: any[], networkId: string): AccountItem[] {
  const items: AccountItem[] = [];
  const relevant = pubkeys.filter(pk => (pk.networks || []).includes(networkId));

  // Same dedup logic as BTC — a non-BTC UTXO chain (LTC) has both
  // p2pkh and p2wpkh entries, and could grow to multiple of each.
  const scriptTypeCounts = new Map<string, number>();
  for (const pk of relevant) {
    if (pk.script_type) scriptTypeCounts.set(pk.script_type, (scriptTypeCounts.get(pk.script_type) || 0) + 1);
  }

  for (const pk of relevant) {
    const baseLabel = pk.script_type ? BTC_SCRIPT_LABELS[pk.script_type] || pk.script_type : 'Default';
    const accountIdx = extractAccountIdxFromNote(pk.note);
    const repeats = pk.script_type ? (scriptTypeCounts.get(pk.script_type) || 0) > 1 : false;
    const label = repeats && accountIdx !== null ? `${baseLabel} · Account ${accountIdx}` : baseLabel;

    const address = pk.address || pk.master || '';
    items.push({
      key: pk.note ? `utxo:${pk.note}` : `utxo:${pk.script_type || 'default'}`,
      label,
      address,
      pubkey: pk,
      scriptType: pk.script_type,
      accountIndex: accountIdx ?? undefined,
      note: pk.note,
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

// Cosmos-family, Solana, and other account-model chains (Ripple/TON/Tron).
// One row per pubkey on the network: single-account chains naturally yield one
// row; multi-account chains (Cosmos/Solana) show Account 0, 1, 2…
function buildMultiAccounts(pubkeys: any[], networkId: string): AccountItem[] {
  const relevant = pubkeys.filter(p => (p.networks || []).includes(networkId));
  if (relevant.length === 0) return [];
  const chainSymbol = NetworkIdToChain[networkId];
  const baseLabel = NETWORK_DISPLAY_NAMES[networkId] || chainSymbol || 'Account';
  return relevant.map(pk => {
    // accountIndex is enriched onto the pubkey (Solana) or parsed from the note
    // ("Cosmos account 1"). Account-0 default paths have ad-hoc notes with no
    // index, so parseAccountIndex falls back to 0.
    const idx = parseAccountIndex(pk.note, pk.accountIndex);
    return {
      // Key on note (unique per path) so two accounts don't collapse and
      // selectedAccountKey can disambiguate them.
      key: pk.note ? `acct:${networkId}:${pk.note}` : `acct:${networkId}:${idx}`,
      label: idx === 0 ? baseLabel : `${baseLabel} · Account ${idx}`,
      address: pk.address || pk.master || '',
      pubkey: pk,
      accountIndex: idx,
      note: pk.note,
      isDefault: idx === 0,
    };
  });
}
