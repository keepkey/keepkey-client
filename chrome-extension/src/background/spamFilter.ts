/**
 * Token Spam Filter — multi-tier heuristic detection.
 * Ported from keepkey-vault-v11 spamFilter.ts.
 *
 * Detection order (first match wins):
 *  1. User override (chrome.storage.local 'visible'/'hidden') — absolute precedence
 *  2. Name/symbol contains URL or phishing keywords → CONFIRMED spam
 *  3. Symbol has suspicious characters or excessive length → CONFIRMED spam
 *  4. Known stablecoin symbol with value < $0.50 → CONFIRMED spam
 *  5. Dust airdrop: huge quantity (>1M) + near-zero unit price (<$0.0001) → CONFIRMED spam
 *  6. Value < $1 → POSSIBLE spam
 *  7. Otherwise → clean
 */

export const KNOWN_STABLECOINS = [
  'USDT',
  'USDC',
  'DAI',
  'BUSD',
  'UST',
  'TUSD',
  'USDD',
  'USDP',
  'GUSD',
  'PYUSD',
  'FRAX',
  'LUSD',
  'SUSD',
  'ALUSD',
  'FEI',
  'MIM',
  'DOLA',
  'AGEUR',
  'EURT',
  'EURS',
];

/** Well-known legitimate token symbols — exempt from dust-airdrop heuristic */
const KNOWN_LEGIT_SYMBOLS = new Set([
  // Top tokens by market cap
  'ETH',
  'BTC',
  'WETH',
  'WBTC',
  'BNB',
  'MATIC',
  'POL',
  'AVAX',
  'SOL',
  'DOT',
  'ADA',
  'LINK',
  'UNI',
  'AAVE',
  'MKR',
  'CRV',
  'COMP',
  'SNX',
  'SUSHI',
  'YFI',
  'LDO',
  'RPL',
  'ARB',
  'OP',
  'FTM',
  'ATOM',
  'OSMO',
  'RUNE',
  'CACAO',
  'XRP',
  'DOGE',
  'LTC',
  'BCH',
  'DASH',
  'ZEC',
  'ETC',
  // Wrapped / bridged
  'WAVAX',
  'WBNB',
  'WMATIC',
  'WPOL',
  'WFTM',
  // Major stablecoins
  ...KNOWN_STABLECOINS,
  // Major DeFi / governance
  'GRT',
  'ENS',
  'APE',
  'SHIB',
  'PEPE',
  'WLD',
  'IMX',
  'RNDR',
  'FET',
  'OCEAN',
  'SAND',
  'MANA',
  'AXS',
  'GALA',
  'ILV',
  'BLUR',
  'PENDLE',
  'ENA',
  'ETHFI',
  'STX',
  'INJ',
  'TIA',
  'SEI',
  'SUI',
  'APT',
  'NEAR',
  'FIL',
  'AR',
  // LSTs / LRTs
  'STETH',
  'RETH',
  'CBETH',
  'WSTETH',
  'SWETH',
  'EETH',
  'WEETH',
  'METH',
  'RSETH',
  // FOX
  'FOX',
]);

export type SpamLevel = 'confirmed' | 'suppressed' | 'possible' | null;
export type TokenVisibilityStatus = 'visible' | 'hidden';

/** Curated trusted token CAIPs (lowercased) — exempt from default suppression.
 *  Native assets are already exempt. Seed with blue-chip contracts; extend over time. */
export const TRUSTED_CAIPS = new Set<string>([
  'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  'eip155:1/erc20:0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  'eip155:1/erc20:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
  'eip155:1/erc20:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
]);

/** A non-allowlisted token reporting at least this USD value is treated as a
 *  fabricated-value lure ('Mortal' class) and suppressed by default (recoverable). */
export const SUSPICIOUS_VALUE_FLOOR = 1;

export interface SpamResult {
  isSpam: boolean;
  level: SpamLevel;
  reason: string;
}

/** Balance entry shape used by the extension background */
export interface TokenBalanceEntry {
  symbol?: string;
  name?: string;
  balance?: string;
  valueUsd?: string;
  priceUsd?: string;
  caip?: string;
  isNative?: boolean;
  [key: string]: any;
}

// ── Heuristic helpers ────────────────────────────────────────────────

/** URL-like patterns in name or symbol — nearly always phishing */
const URL_PATTERN = /(?:\.[a-z]{2,6}(?:\/|$))|https?:|www\./i;

/** Phishing action words that appear in scam token names */
const PHISHING_KEYWORDS = /\b(claim|visit|reward|bonus|airdrop|free|voucher|gift|redeem|activate|eligible)\b/i;

/** Symbols should be short alphanumeric; these chars indicate scam */
const SUSPICIOUS_SYMBOL_CHARS = /[./:$!@#%^&*()+=\[\]{}|\\<>,?~`'"]/;

/** Max reasonable symbol length — real tokens are 2-11 chars */
const MAX_SYMBOL_LENGTH = 11;

/**
 * Detect whether a token is spam.
 */
export function detectSpamToken(
  token: TokenBalanceEntry,
  userOverride?: TokenVisibilityStatus | null,
  opts?: { isCustom?: boolean },
): SpamResult {
  // ── Tier 0: User override — absolute precedence ──────────────────
  if (userOverride === 'visible') {
    return { isSpam: false, level: null, reason: 'User marked as safe' };
  }
  if (userOverride === 'hidden') {
    return { isSpam: true, level: 'confirmed', reason: 'User marked as hidden' };
  }

  const usd = parseFloat(token.valueUsd || '0');
  const price = parseFloat(token.priceUsd || '0');
  const sym = (token.symbol || '').toUpperCase();
  const name = token.name || '';

  // ── Tier 1: Name/symbol contains URL → CONFIRMED spam ────────────
  if (URL_PATTERN.test(name) || URL_PATTERN.test(token.symbol || '')) {
    return {
      isSpam: true,
      level: 'confirmed',
      reason: 'Name/symbol contains URL — phishing token',
    };
  }

  // ── Tier 2: Name contains phishing keywords → CONFIRMED spam ─────
  if (PHISHING_KEYWORDS.test(name)) {
    return {
      isSpam: true,
      level: 'confirmed',
      reason: 'Name contains phishing keyword',
    };
  }

  // ── Tier 3: Suspicious symbol characters or length → CONFIRMED ───
  if (SUSPICIOUS_SYMBOL_CHARS.test(token.symbol || '') || (token.symbol || '').length > MAX_SYMBOL_LENGTH) {
    return {
      isSpam: true,
      level: 'confirmed',
      reason: 'Symbol has suspicious characters or is too long',
    };
  }

  // ── Tier 4: Fake stablecoin (symbol matches but value way off) ───
  // Price-aware: only when the row carries a real price — a not-yet-priced
  // legit stablecoin (priceUsd 0) must not be flagged.
  if (price > 0 && KNOWN_STABLECOINS.includes(sym) && usd < 0.5) {
    return {
      isSpam: true,
      level: 'confirmed',
      reason: `Fake ${sym} — real ${sym} is ~$1.00, this has $${usd.toFixed(2)}`,
    };
  }

  // ── Tier 5: Dust airdrop heuristic ───────────────────────────────
  if (!KNOWN_LEGIT_SYMBOLS.has(sym)) {
    const qty = parseFloat(token.balance || '0');
    const price = parseFloat(token.priceUsd || '0');

    if (qty > 1_000_000 && price < 0.0001) {
      return {
        isSpam: true,
        level: 'confirmed',
        reason: `Dust airdrop — ${qty.toLocaleString()} units at $${price.toFixed(8)}/unit`,
      };
    }

    // Moderate quantity + zero price but somehow has USD value (manipulated)
    if (qty > 10_000 && price === 0 && usd > 0) {
      return {
        isSpam: true,
        level: 'confirmed',
        reason: 'Suspicious — large quantity with $0 price but non-zero value',
      };
    }
  }

  // ── Tier 5.5: Non-allowlisted token reporting a fabricated value ──
  // Benign symbol + a non-trivial USD value, not allowlisted and not a
  // user-added custom token = the 'Mortal' lure. Suppressed by DEFAULT but
  // recoverable (routed to the Hidden bucket, never hard-dropped).
  const caipLc = (token.caip || '').toLowerCase();
  if (!opts?.isCustom && !KNOWN_LEGIT_SYMBOLS.has(sym) && !TRUSTED_CAIPS.has(caipLc) && usd >= SUSPICIOUS_VALUE_FLOOR) {
    return {
      isSpam: true,
      level: 'suppressed',
      reason: `Unverified token reporting $${usd.toFixed(2)} — hidden by default (recoverable)`,
    };
  }

  // ── Tier 6: Low value → POSSIBLE spam ────────────────────────────
  // Price-aware: a not-yet-priced legit token (priceUsd 0) is not "low value".
  if (price > 0 && usd < 1) {
    return {
      isSpam: true,
      level: 'possible',
      reason: `Low value ($${usd.toFixed(4)}) — common airdrop spam pattern`,
    };
  }

  // ── Clean — passed all checks ────────────────────────────────────
  return { isSpam: false, level: null, reason: 'Passed all spam checks' };
}

/**
 * Filter spam tokens from a balance array.
 *
 * Only `confirmed` spam (URL-shaped names, phishing keywords, suspicious
 * symbols, fake stablecoins, dust airdrops) and user-marked-hidden tokens
 * are dropped. `possible` spam (the low-USD-value heuristic) is KEPT —
 * the tier-6 `< $1` rule is too coarse to drop silently when there is no
 * override UI: legitimate small holdings, fresh custom tokens, testnet-
 * like balances, and anything with missing price data all land there.
 * Callers that want to visually de-emphasize possible-spam can call
 * `detectSpamToken` themselves and render accordingly.
 *
 * Native chain balances are always kept regardless of classification.
 */
export interface PartitionedBalances {
  visible: TokenBalanceEntry[];
  hidden: TokenBalanceEntry[];
}

/**
 * Partition balances into inline-visible vs a recoverable "Hidden" bucket:
 *  - Native rows: always visible.
 *  - User 'visible' override: always visible (tier 0).
 *  - User 'hidden' override: Hidden bucket (recoverable).
 *  - Heuristic 'confirmed' (URL/keyword/suspicious-symbol/fake-stable/dust):
 *    HARD-DROPPED — phishing must never render, even collapsed.
 *  - Heuristic 'suppressed' (the 'Mortal' fabricated-value class): Hidden bucket
 *    (recoverable) — hidden by default, the user can reveal/un-hide it.
 *  - Otherwise (clean / possible): visible.
 * Hidden rows are tagged `_hidden` + `_hiddenReason` and kept in the cache.
 */
export function partitionSpamTokens(
  balances: TokenBalanceEntry[],
  overrides?: Map<string, TokenVisibilityStatus>,
  isCustom?: (b: TokenBalanceEntry) => boolean,
): PartitionedBalances {
  const visible: TokenBalanceEntry[] = [];
  const hidden: TokenBalanceEntry[] = [];
  for (const b of balances) {
    if (b.isNative) {
      visible.push(b);
      continue;
    }
    const override = overrides?.get(b.caip?.toLowerCase() || '') ?? null;
    if (override === 'visible') {
      visible.push(b);
      continue;
    }
    if (override === 'hidden') {
      hidden.push({ ...b, _hidden: true, _hiddenReason: 'Hidden by you' });
      continue;
    }
    const result = detectSpamToken(b, null, { isCustom: isCustom?.(b) });
    if (result.level === 'confirmed') {
      // phishing — hard drop (not shown anywhere)
      continue;
    }
    if (result.level === 'suppressed') {
      hidden.push({ ...b, _hidden: true, _hiddenReason: result.reason });
      continue;
    }
    visible.push(b);
  }
  return { visible, hidden };
}

/**
 * Back-compat wrapper: returns only the visible balances. Prefer
 * partitionSpamTokens when you need the recoverable Hidden bucket.
 */
export function filterSpamTokens(
  balances: TokenBalanceEntry[],
  overrides?: Map<string, TokenVisibilityStatus>,
): TokenBalanceEntry[] {
  return partitionSpamTokens(balances, overrides).visible;
}

// ── Token visibility persistence (chrome.storage.local) ────────────

const STORAGE_KEY = 'keepkey-token-visibility';

export async function getTokenVisibilityMap(): Promise<Map<string, TokenVisibilityStatus>> {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, data => {
      const raw = data[STORAGE_KEY] || {};
      resolve(new Map(Object.entries(raw) as [string, TokenVisibilityStatus][]));
    });
  });
}

export async function setTokenVisibility(caip: string, status: TokenVisibilityStatus): Promise<void> {
  const map = await getTokenVisibilityMap();
  map.set(caip.toLowerCase(), status);
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: Object.fromEntries(map) }, resolve);
  });
}

export async function removeTokenVisibility(caip: string): Promise<void> {
  const map = await getTokenVisibilityMap();
  map.delete(caip.toLowerCase());
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: Object.fromEntries(map) }, resolve);
  });
}
