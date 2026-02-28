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
  onSelectNetwork?: (asset: any) => void;
}
