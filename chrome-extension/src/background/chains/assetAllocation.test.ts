/**
 * Side panel (KEEPKEY-191 feedback): the asset is the protagonist. Allocation
 * groups by asset across networks, colours come from official logos (HIVE is
 * Hive red, not a hashed gold), and L2 assets carry their network's official
 * logo as a badge — none at the asset's home network.
 */
import { describe, expect, it } from 'vitest';
import {
  assetTicker,
  badgeNetworkFor,
  brandColor,
  groupAllocationByAsset,
} from '../../../../packages/shared/lib/utils/assetAllocation';
import { renderAssetIcon } from '../../../../pages/side-panel/src/components/AssetIcon.render';
import { NETWORK_LOGOS } from '../../../../pages/side-panel/src/styles/networkLogos';

const hash = () => '#999999';
const ETH_MAIN = {
  networkId: 'eip155:1',
  caip: 'eip155:1/slip44:60',
  symbol: 'ETH',
  isNative: true,
  valueUsd: '958.10',
};
const ETH_BASE = {
  networkId: 'eip155:8453',
  caip: 'eip155:8453/slip44:60',
  symbol: 'BASE',
  isNative: true,
  valueUsd: '41.90',
};
const USDC_MAIN = { networkId: 'eip155:1', caip: 'eip155:1/erc20:0xa0b8', symbol: 'USDC', valueUsd: '10' };
const USDC_POLY = { networkId: 'eip155:137', caip: 'eip155:137/erc20:0x3c49', symbol: 'usdc', valueUsd: '5' };
const HIVE = {
  networkId: 'hive:beeab0de',
  caip: 'hive:beeab0de/slip44:1275',
  symbol: 'HIVE',
  isNative: true,
  valueUsd: '0.20',
  color: '#c2a633',
};
const HBD = { networkId: 'hive:beeab0de', caip: 'hive:beeab0de/token:hbd', symbol: 'HBD', valueUsd: '1.00' };

describe('assetTicker', () => {
  it('names natives by their real ticker (Base native is ETH, Polygon is POL), tokens by symbol', () => {
    expect(assetTicker(ETH_BASE)).toBe('ETH');
    expect(
      assetTicker({ networkId: 'eip155:137', caip: 'eip155:137/slip44:966', isNative: true, symbol: 'MATIC' }),
    ).toBe('POL');
    expect(assetTicker(USDC_POLY)).toBe('USDC');
  });
});

describe('groupAllocationByAsset', () => {
  it('ETH on Ethereum + Base is one ETH segment, with the per-network split', () => {
    const [eth] = groupAllocationByAsset([ETH_MAIN, ETH_BASE], hash);
    expect(eth.label).toBe('ETH');
    expect(eth.value).toBeCloseTo(1000);
    expect(eth.parts).toEqual([
      { networkId: 'eip155:1', value: 958.1 },
      { networkId: 'eip155:8453', value: 41.9 },
    ]);
    expect(eth.color).toBe('#627EEA');
  });

  it('tokens group by symbol across networks; different assets stay apart; sorted by value', () => {
    const groups = groupAllocationByAsset([USDC_POLY, ETH_BASE, USDC_MAIN, HBD, HIVE, ETH_MAIN], hash);
    expect(groups.map(g => g.label)).toEqual(['ETH', 'USDC', 'HBD', 'HIVE']);
    expect(groups.find(g => g.label === 'USDC')!.parts.map(p => p.networkId)).toEqual(['eip155:1', 'eip155:137']);
  });

  it('colours come from the official logo: HIVE is Hive red even when the row says gold', () => {
    const hive = groupAllocationByAsset([HIVE], hash)[0];
    expect(hive.color).toBe('#E31337');
    expect(brandColor('hive')).toBe('#E31337');
    expect(groupAllocationByAsset([{ ...USDC_MAIN, symbol: 'WEIRD' }], hash)[0].color).toBe('#999999');
  });

  it('zero / empty values are left out', () => {
    expect(
      groupAllocationByAsset(
        [
          { ...ETH_MAIN, valueUsd: '0' },
          { ...HBD, valueUsd: undefined },
        ],
        hash,
      ),
    ).toEqual([]);
  });
});

describe('network badge', () => {
  it('ETH on an L2 gets its network; on Ethereum mainnet none', () => {
    expect(badgeNetworkFor(ETH_BASE)).toBe('eip155:8453');
    expect(badgeNetworkFor({ networkId: 'eip155:42161', caip: 'eip155:42161/slip44:60', isNative: true })).toBe(
      'eip155:42161',
    );
    expect(badgeNetworkFor(ETH_MAIN)).toBeUndefined();
  });

  it('chain-native assets at home get none (POL on Polygon, HIVE, BTC); EVM tokens off mainnet get theirs', () => {
    expect(badgeNetworkFor({ networkId: 'eip155:137', caip: 'eip155:137/slip44:966', isNative: true })).toBeUndefined();
    expect(badgeNetworkFor(HIVE)).toBeUndefined();
    expect(badgeNetworkFor(USDC_POLY)).toBe('eip155:137');
    expect(badgeNetworkFor(USDC_MAIN)).toBeUndefined();
  });

  it('renders the official network logo in the corner; nothing when no logo or too small', () => {
    const withBadge = renderAssetIcon({
      src: 'https://example.com/eth.png',
      symbol: 'ETH',
      size: 28,
      badgeNetworkId: 'eip155:8453',
    });
    expect(withBadge).toContain('data-network-badge="eip155:8453"');
    expect(withBadge).toContain(NETWORK_LOGOS['eip155:8453'].slice(0, 40));
    expect(renderAssetIcon({ src: 'https://example.com/eth.png', symbol: 'ETH', size: 28 })).not.toContain(
      'data-network-badge',
    );
    expect(renderAssetIcon({ src: 'x', symbol: 'ETH', size: 28, badgeNetworkId: 'eip155:4663' })).not.toContain(
      'data-network-badge',
    );
    expect(renderAssetIcon({ src: 'x', symbol: 'ETH', size: 20, badgeNetworkId: 'eip155:8453' })).not.toContain(
      'data-network-badge',
    );
  });

  it('badge logos are official vectors without a background disc (Base: blue square, no white circle)', () => {
    const base = decodeURIComponent(NETWORK_LOGOS['eip155:8453']);
    expect(base).toContain('#0000ff');
    expect(base).not.toContain('<circle cx="32" cy="32" r="32" fill="#fff"/>');
    expect(decodeURIComponent(NETWORK_LOGOS['eip155:42161'])).not.toContain(
      '<circle cx="32" cy="32" r="32" fill="#213147"/>',
    );
  });
});
