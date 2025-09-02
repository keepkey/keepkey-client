// Type definitions for the injected script

export interface WalletRequestInfo {
  id: number;
  method: string;
  params: any[];
  chain: string;
  siteUrl: string;
  scriptSource: string;
  version: string;
  requestTime: string;
  referrer: string;
  href: string;
  userAgent: string;
  platform: string;
  language: string;
}

export interface WalletMessage {
  source: 'keepkey-injected' | 'keepkey-content';
  type: 'WALLET_REQUEST' | 'WALLET_RESPONSE' | 'INJECTION_CONFIRMED' | 'INJECTION_VERIFY';
  requestId?: number;
  requestInfo?: WalletRequestInfo;
  result?: any;
  error?: any;
  version?: string;
  timestamp?: number;
}

export interface ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface WalletCallback {
  callback: (error: any, result?: any) => void;
  timestamp: number;
  method: string;
}

export interface InjectionState {
  isInjected: boolean;
  version: string;
  injectedAt: number;
  retryCount: number;
  lastError?: string;
}

export type ChainType =
  | 'ethereum'
  | 'binance'
  | 'bitcoin'
  | 'bitcoincash'
  | 'dogecoin'
  | 'dash'
  | 'litecoin'
  | 'thorchain'
  | 'mayachain'
  | 'osmosis'
  | 'cosmos'
  | 'ripple'
  | 'keplr';

export interface WalletProvider {
  network: string;
  isKeepKey: boolean;
  isMetaMask: boolean;
  isConnected: boolean | (() => boolean);
  chainId?: string;
  networkVersion?: string;
  selectedAddress?: string | null;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  send: (payload: any, param1?: any, callback?: any) => any;
  sendAsync: (payload: any, param1?: any, callback?: any) => any;
  on: (event: string, handler: Function) => WalletProvider;
  off?: (event: string, handler: Function) => WalletProvider;
  once?: (event: string, handler: Function) => WalletProvider;
  removeListener: (event: string, handler: Function) => WalletProvider;
  removeAllListeners: (event?: string) => WalletProvider;
  emit: (event: string, ...args: any[]) => WalletProvider;
  enable?: () => Promise<any>;
  _metamask?: {
    isUnlocked: () => Promise<boolean>;
  };
  _handleAccountsChanged?: (accounts: string[]) => void;
  _handleChainChanged?: (chainId: string) => void;
  _handleConnect?: (info: { chainId: string }) => void;
  _handleDisconnect?: (error: { code: number; message: string }) => void;
}

export interface KeepKeyWindow extends Window {
  keepkeyInjected?: boolean;
  keepkeyInjectionState?: InjectionState;
  ethereum?: WalletProvider;
  xfi?: Record<ChainType, WalletProvider>;
  keepkey?: Record<ChainType, WalletProvider>;
}
