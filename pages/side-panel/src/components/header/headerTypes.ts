export type ChainFamily = 'evm' | 'utxo' | 'cosmos' | 'other';

export interface NetworkItem {
  networkId: string;
  name: string;
  icon: string;
  family: ChainFamily;
  isCustom: boolean;
}

export interface AccountItem {
  key: string;
  label: string;
  address: string;
  pubkey: any;
  scriptType?: string;
  accountIndex?: number;
  /** Note from the underlying path config (chainConfig.ts). Unique per
   *  configured derivation; used as the canonical identity for UTXO
   *  accounts where (script_type, accountIndex) alone may not be
   *  unique — BTC has multiple p2wpkh and p2pkh paths across account
   *  indices. */
  note?: string;
  /** Human-readable derivation path, e.g. "m/84'/0'/0'" */
  path?: string;
  isDefault: boolean;
}

export interface CustomEvmNetwork {
  networkId: string;
  chainId: number;
  name: string;
  rpc: string;
  symbol: string;
  explorerUrl?: string;
}

export interface NetworkAccountHeaderProps {
  keepkeyState: number | null;
  isRefreshing: boolean;
  onSettingsOpen: () => void;
  onRefresh: () => void;
  onHome?: () => void;
  onSelectNetwork?: (asset: any) => void;
}
