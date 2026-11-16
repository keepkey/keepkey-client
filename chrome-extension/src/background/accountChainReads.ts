/** Demand-only chain reads for send safety. Never use portfolio cache here. */
export const ACCOUNT_NETWORKS: Record<string, { id: string; denom: string; decimals: number; route: string }> = {
  'cosmos:cosmoshub-4': { id: 'cosmos', denom: 'uatom', decimals: 6, route: '/cosmos/sign-amino' },
  'cosmos:osmosis-1': { id: 'osmosis', denom: 'uosmo', decimals: 6, route: '/osmosis/sign-amino' },
  'cosmos:thorchain-mainnet-v1': {
    id: 'thorchain',
    denom: 'rune',
    decimals: 8,
    route: '/thorchain/sign-amino-transfer',
  },
  'cosmos:mayachain-mainnet-v1': {
    id: 'mayachain',
    denom: 'cacao',
    decimals: 10,
    route: '/mayachain/sign-amino-transfer',
  },
};

export const COSMOS_REST: Record<string, readonly string[]> = {
  cosmos: ['https://cosmos-rest.publicnode.com', 'https://rest.cosmos.directory/cosmoshub'],
  osmosis: ['https://lcd.osmosis.zone', 'https://rest.cosmos.directory/osmosis'],
  thorchain: ['https://rest.cosmos.directory/thorchain', 'https://gateway.liquify.com/chain/thorchain_api'],
  mayachain: ['https://mayanode.mayachain.info', 'https://rest.cosmos.directory/mayachain'],
};
export const XRP_NETWORK = 'ripple:4109c6f2045fc7eff4cde8f9905d19c2';
export const XRP_RPC = ['https://s1.ripple.com:51234', 'https://s2.ripple.com:51234'];

export function unsignedInteger(value: unknown): bigint {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isSafeInteger(value)) ||
    !/^\d+$/.test(String(value))
  ) {
    throw new Error('Invalid chain amount');
  }
  return BigInt(value);
}

export async function readChainJson(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<any> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', ...(init.method ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!response.ok) throw new Error(`Chain read returned HTTP ${response.status}`);
  return response.json();
}

export const xrpRead = (endpoint: string, method: string, params: Record<string, unknown>) =>
  readChainJson(endpoint, { method: 'POST', body: JSON.stringify({ method, params: [params] }) });
