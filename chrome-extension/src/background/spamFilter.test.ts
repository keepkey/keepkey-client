import { describe, it, expect } from 'vitest';
import { detectSpamToken, filterSpamTokens, KNOWN_STABLECOINS, type TokenBalanceEntry } from './spamFilter';

const clean: TokenBalanceEntry = {
  symbol: 'LINK',
  name: 'Chainlink',
  balance: '10',
  valueUsd: '150',
  priceUsd: '15',
  caip: 'eip155:1/erc20:0x514910771af9ca656af840dff83e8264ecf986ca',
};

describe('detectSpamToken — user override (tier 0)', () => {
  it('treats a "visible" override as not-spam regardless of heuristics', () => {
    const phishing: TokenBalanceEntry = { symbol: 'X', name: 'claim reward at evil.com', valueUsd: '0' };
    const r = detectSpamToken(phishing, 'visible');
    expect(r.isSpam).toBe(false);
  });

  it('treats a "hidden" override as confirmed spam regardless of legitimacy', () => {
    const r = detectSpamToken(clean, 'hidden');
    expect(r).toMatchObject({ isSpam: true, level: 'confirmed' });
  });
});

describe('detectSpamToken — confirmed spam', () => {
  it('flags URL-shaped names as phishing', () => {
    const r = detectSpamToken({ symbol: 'AIR', name: 'visit airdrop.xyz', valueUsd: '5' });
    expect(r).toMatchObject({ isSpam: true, level: 'confirmed' });
  });

  it('flags a URL in the symbol field too', () => {
    const r = detectSpamToken({ symbol: 'www.x.io', name: 'Token', valueUsd: '5' });
    expect(r.level).toBe('confirmed');
  });

  it('flags phishing keywords in the name', () => {
    for (const name of ['Claim your bonus', 'FREE gift', 'redeem voucher']) {
      expect(detectSpamToken({ symbol: 'TKN', name, valueUsd: '100' }).level).toBe('confirmed');
    }
  });

  it('flags suspicious symbol characters', () => {
    const r = detectSpamToken({ symbol: 'US$DT', name: 'Tether', valueUsd: '100' });
    expect(r.level).toBe('confirmed');
  });

  it('flags an over-long symbol (> 11 chars)', () => {
    const r = detectSpamToken({ symbol: 'ABCDEFGHIJKL', name: 'Token', valueUsd: '100' });
    expect(r.level).toBe('confirmed');
  });

  it('flags a fake stablecoin trading far from $1', () => {
    const r = detectSpamToken({ symbol: 'USDC', name: 'USD Coin', valueUsd: '0.01' });
    expect(r.level).toBe('confirmed');
    expect(r.reason).toContain('Fake');
  });

  it('flags a dust airdrop (huge quantity, near-zero unit price)', () => {
    const r = detectSpamToken({
      symbol: 'SCAM',
      name: 'Scam',
      balance: '5000000',
      priceUsd: '0.00001',
      valueUsd: '50',
    });
    expect(r.level).toBe('confirmed');
    expect(r.reason).toContain('Dust airdrop');
  });

  it('flags large quantity + $0 price but non-zero value (manipulated)', () => {
    const r = detectSpamToken({ symbol: 'WEIRD', name: 'Weird', balance: '50000', priceUsd: '0', valueUsd: '20' });
    expect(r.level).toBe('confirmed');
  });
});

describe('detectSpamToken — possible spam and clean', () => {
  it('marks low-value (< $1) tokens as POSSIBLE (not confirmed) spam', () => {
    const r = detectSpamToken({ symbol: 'TINY', name: 'Tiny Token', balance: '1', priceUsd: '0.5', valueUsd: '0.5' });
    expect(r).toMatchObject({ isSpam: true, level: 'possible' });
  });

  it('passes a legitimate, valuable token', () => {
    const r = detectSpamToken(clean);
    expect(r).toMatchObject({ isSpam: false, level: null });
  });

  it('does not apply the dust heuristic to known-legit symbols', () => {
    // Large SHIB balance at a tiny unit price is normal, not a dust airdrop.
    const r = detectSpamToken({
      symbol: 'SHIB',
      name: 'Shiba Inu',
      balance: '50000000',
      priceUsd: '0.00002',
      valueUsd: '1000',
    });
    expect(r.isSpam).toBe(false);
  });

  it('exposes a non-empty stablecoin allow-list', () => {
    expect(KNOWN_STABLECOINS).toContain('USDT');
    expect(KNOWN_STABLECOINS).toContain('DAI');
  });
});

describe('filterSpamTokens', () => {
  it('drops confirmed spam but keeps possible spam and clean tokens', () => {
    const confirmed: TokenBalanceEntry = { symbol: 'X', name: 'claim at evil.io', valueUsd: '0', caip: 'a' };
    const possible: TokenBalanceEntry = {
      symbol: 'TINY',
      name: 'Tiny',
      valueUsd: '0.5',
      priceUsd: '0.5',
      balance: '1',
      caip: 'b',
    };
    const out = filterSpamTokens([clean, confirmed, possible]);
    const caips = out.map(t => t.caip);
    expect(caips).toContain(clean.caip);
    expect(caips).toContain('b'); // possible spam kept
    expect(caips).not.toContain('a'); // confirmed spam dropped
  });

  it('always keeps native balances even if they would look like spam', () => {
    const nativeDust: TokenBalanceEntry = { symbol: 'ETH', name: 'Ethereum', isNative: true, valueUsd: '0' };
    const out = filterSpamTokens([nativeDust]);
    expect(out).toHaveLength(1);
  });

  it('honors a user "visible" override against the confirmed-spam heuristic', () => {
    const phishing: TokenBalanceEntry = {
      symbol: 'X',
      name: 'claim at evil.io',
      valueUsd: '0',
      caip: 'eip155:1/erc20:0xABC',
    };
    const overrides = new Map([['eip155:1/erc20:0xabc', 'visible' as const]]);
    const out = filterSpamTokens([phishing], overrides);
    expect(out).toHaveLength(1);
  });

  it('a "hidden" override kills a token that passes every heuristic (the "Mortal" case)', () => {
    // A scam token with a benign symbol and a fabricated >=$1 value passes all
    // heuristic tiers and lands "clean" — only a user override removes it.
    const mortal: TokenBalanceEntry = {
      symbol: 'MORTAL',
      name: 'Mortal',
      valueUsd: '5',
      priceUsd: '5',
      balance: '1',
      caip: 'eip155:1/erc20:0xDEAD',
    };
    // No override → survives (proves the heuristics alone don't catch it).
    expect(filterSpamTokens([mortal]).map(t => t.caip)).toContain(mortal.caip);
    // Hidden override → dropped (the kill switch).
    const hidden = new Map([['eip155:1/erc20:0xdead', 'hidden' as const]]);
    expect(filterSpamTokens([mortal], hidden)).toHaveLength(0);
    // Override removed → reappears.
    expect(filterSpamTokens([mortal], new Map()).map(t => t.caip)).toContain(mortal.caip);
  });
});
