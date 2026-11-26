import { describe, it, expect } from 'vitest';
import { staticChainAsset } from './chainAssets';
import { ChainToNetworkId, nativeTicker } from './chainConfig';
import { formatQuantity, formatUsdAmount } from '../../../packages/shared/lib/utils/balanceFormat';

const assetFor = (chainKey: string) => staticChainAsset(chainKey, ChainToNetworkId[chainKey]);

describe('static chain catalog symbols (GET_ASSETS)', () => {
  it.each([
    ['OP', 'ETH', 'Optimism'],
    ['BASE', 'ETH', 'Base'],
    ['ARB', 'ETH', 'Arbitrum'],
    ['MATIC', 'POL', 'Polygon'],
    ['THOR', 'RUNE', 'Thorchain'],
    ['GAIA', 'ATOM', 'Cosmos'],
    ['BSC', 'BNB', 'Binance'],
    ['MAYA', 'CACAO', 'Mayachain'],
  ])('%s row is labelled with its native ticker %s', (chainKey, ticker, name) => {
    const asset = assetFor(chainKey);
    expect(asset.symbol).toBe(ticker);
    expect(asset.name).toBe(name);
    // The Pioneer chain id stays available for code that keys on it.
    expect(asset.chain).toBe(chainKey);
    expect(asset.isNative).toBe(true);
  });

  it.each(['ETH', 'BTC', 'LTC', 'DOGE', 'SOL', 'XRP', 'HIVE', 'AVAX', 'TRX', 'TON', 'OSMO'])(
    '%s keeps its key as the ticker',
    chainKey => {
      expect(assetFor(chainKey).symbol).toBe(chainKey);
    },
  );

  it('never labels a catalog row with a bare chain id', () => {
    const chainIdsThatAreNotTickers = ['OP', 'BASE', 'ARB', 'MATIC', 'THOR', 'GAIA', 'BSC', 'MAYA', 'RHD'];
    for (const chainKey of Object.keys(ChainToNetworkId)) {
      expect(chainIdsThatAreNotTickers).not.toContain(nativeTicker(chainKey));
    }
  });

  it('keeps caip and networkId unchanged by the relabel', () => {
    const op = assetFor('OP');
    expect(op.networkId).toBe('eip155:10');
    expect(op.caip).toBe('eip155:10/slip44:60');
  });
});

describe('formatQuantity', () => {
  it('rounds instead of truncating', () => {
    expect(formatQuantity('0.48079')).toBe('0.4808');
    expect(formatQuantity('72.41019')).toBe('72.4102');
  });

  it('widens to 6 decimals when 4 would read as zero', () => {
    expect(formatQuantity('0.0000061')).toBe('0.000006');
    expect(formatQuantity('0.00004')).toBe('0.000040');
  });

  it('marks dust below 6 decimals instead of showing 0.000000', () => {
    expect(formatQuantity('0.0000001')).toBe('<0.000001');
  });

  it('accepts exponent notation and never emits it', () => {
    expect(formatQuantity('5e-7')).toBe('<0.000001');
    expect(formatQuantity(5e-6)).toBe('0.000005');
    expect(formatQuantity('1.5e3')).toBe('1,500.0000');
    expect(formatQuantity(1e21)).not.toMatch(/e/i);
  });

  it('shows zero and garbage as 0', () => {
    expect(formatQuantity('0')).toBe('0');
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity('')).toBe('0');
    expect(formatQuantity(undefined)).toBe('0');
    expect(formatQuantity('abc')).toBe('0');
  });
});

describe('formatUsdAmount', () => {
  it('groups thousands with en-US separators', () => {
    expect(formatUsdAmount(3071.29)).toBe('3,071.29');
    expect(formatUsdAmount('1980.02')).toBe('1,980.02');
    expect(formatUsdAmount(1234567.891)).toBe('1,234,567.89');
  });

  it('always shows 2 decimals and rounds', () => {
    expect(formatUsdAmount(2.4)).toBe('2.40');
    expect(formatUsdAmount('0.005')).toBe('0.01');
    expect(formatUsdAmount(0)).toBe('0.00');
    expect(formatUsdAmount('not a number')).toBe('0.00');
  });
});
