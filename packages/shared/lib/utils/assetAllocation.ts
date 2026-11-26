/**
 * Side panel: the ASSET is the protagonist, the network is context.
 *
 *  - Allocation groups by asset (ETH on Ethereum + Base = one "ETH" segment),
 *    with a per-network breakdown for the legend.
 *  - A network badge shows only when the asset lives away from its home
 *    network (ETH on Base/Arbitrum/Optimism, a token on an L2). On its home
 *    network an asset shows no badge — the cleanest, consistent rule.
 *  - Colours come from each asset's official logo, not a hash.
 */
import { NetworkIdToChain, nativeTicker } from './chainConfig';

/** Official brand colours (the dominant colour of each asset's own logo). */
export const ASSET_BRAND_COLORS: Record<string, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  HIVE: '#E31337',
  HBD: '#E31337',
  USDC: '#2775CA',
  USDT: '#26A17B',
  DAI: '#F5AC37',
  WBTC: '#F7931A',
  SOL: '#9945FF',
  BNB: '#F3BA2F',
  POL: '#8247E5',
  MATIC: '#8247E5',
  AVAX: '#E84142',
  ARB: '#28A0F0',
  OP: '#FF0420',
  RUNE: '#33FF99',
  CACAO: '#3EA0FF',
  ATOM: '#6F7390',
  OSMO: '#750BBB',
  DOGE: '#C2A633',
  LTC: '#345D9D',
  BCH: '#0AC18E',
  DASH: '#008CE7',
  ZEC: '#F4B728',
  TRX: '#EB0029',
  TON: '#0098EA',
  XRP: '#8A92B2',
};

export const brandColor = (ticker?: string): string | undefined =>
  ticker ? ASSET_BRAND_COLORS[ticker.toUpperCase()] : undefined;

/** Networks where a shared ticker is "at home" (no badge there). */
const NATIVE_HOME_NETWORK: Record<string, string> = { ETH: 'eip155:1' };
const TOKEN_HOME_NETWORK = 'eip155:1';

export type BalanceLike = {
  networkId?: string;
  caip?: string;
  symbol?: string;
  ticker?: string;
  isNative?: boolean;
  valueUsd?: string | number;
  color?: string;
};

export const isNativeBalance = (b: BalanceLike): boolean =>
  b.isNative === true || (!!b.caip && /\/slip44:/.test(b.caip));

/** The asset a balance is: natives by their real ticker (Base native → ETH), tokens by symbol. */
export function assetTicker(b: BalanceLike): string {
  if (isNativeBalance(b) && b.networkId) {
    const chainKey = NetworkIdToChain[b.networkId];
    if (chainKey) return nativeTicker(chainKey);
  }
  return String(b.symbol || b.ticker || '?').toUpperCase();
}

/** Network to badge on this asset's icon, or undefined at home. */
export function badgeNetworkFor(b: {
  networkId?: string;
  caip?: string;
  isNative?: boolean;
  symbol?: string;
}): string | undefined {
  const networkId = b.networkId ?? b.caip?.split('/')[0];
  if (!networkId) return undefined;
  if (isNativeBalance(b)) {
    const home = NATIVE_HOME_NETWORK[assetTicker({ ...b, networkId })];
    return home && home !== networkId ? networkId : undefined;
  }
  // Tokens: EVM tokens are at home on Ethereum mainnet; elsewhere show where they are.
  return networkId.startsWith('eip155:') && networkId !== TOKEN_HOME_NETWORK ? networkId : undefined;
}

export type AllocationPart = { networkId: string; value: number };
export type AssetAllocation = { id: string; label: string; color: string; value: number; parts: AllocationPart[] };

/** Group balances by asset; parts are per network, largest first. */
export function groupAllocationByAsset(
  balances: BalanceLike[],
  fallbackColor: (ticker: string) => string,
): AssetAllocation[] {
  const byAsset = new Map<string, AssetAllocation>();
  for (const b of balances) {
    const value = Number(b.valueUsd ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const ticker = assetTicker(b);
    const networkId = b.networkId ?? b.caip?.split('/')[0] ?? 'unknown';
    let seg = byAsset.get(ticker);
    if (!seg) {
      seg = {
        id: ticker,
        label: ticker,
        color: brandColor(ticker) ?? b.color ?? fallbackColor(ticker),
        value: 0,
        parts: [],
      };
      byAsset.set(ticker, seg);
    }
    seg.value += value;
    const part = seg.parts.find(p => p.networkId === networkId);
    if (part) part.value += value;
    else seg.parts.push({ networkId, value });
  }
  const out = [...byAsset.values()];
  out.forEach(s => s.parts.sort((a, b) => b.value - a.value));
  return out.sort((a, b) => b.value - a.value);
}
