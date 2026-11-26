// Catalog row for a static chain (GET_ASSETS). Pure so the labelling can be
// unit-tested: `symbol` is the native asset's real ticker (ETH on Base, POL on
// Polygon, RUNE on THORChain, ATOM on Cosmos), while `chain` keeps the Pioneer
// chain id the rest of the code keys on.
import { COIN_MAP_LONG, nativeTicker, shortListSymbolToCaip } from './chainConfig';

export interface StaticChainAsset {
  symbol: string;
  networkId: string;
  name: string;
  caip: string;
  icon: string;
  chain: string;
  /** Catalog rows always describe the chain's native asset. */
  isNative: true;
}

export function staticChainAsset(chainKey: string, networkId: string): StaticChainAsset {
  const name = COIN_MAP_LONG[chainKey] || chainKey.toLowerCase();
  const caip = shortListSymbolToCaip[chainKey] || networkId;
  return {
    symbol: nativeTicker(chainKey),
    networkId,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    caip,
    icon: `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png`,
    chain: chainKey,
    isNative: true,
  };
}
