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
  isConnected: boolean;
  chainId?: string;
  networkVersion?: string;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  send: (payload: any, param1?: any, callback?: any) => any;
  sendAsync: (payload: any, param1?: any, callback?: any) => any;
  on: (event: string, handler: Function) => void;
  removeListener: (event: string, handler: Function) => void;
  removeAllListeners: () => void;
  emit?: (event: string, ...args: any[]) => void;
}

export interface KeepKeyWindow extends Window {
  keepkeyInjected?: boolean;
  keepkeyInjectionState?: InjectionState;
  ethereum?: WalletProvider;
  xfi?: Record<ChainType, WalletProvider>;
  keepkey?: Record<ChainType, WalletProvider>;
}
