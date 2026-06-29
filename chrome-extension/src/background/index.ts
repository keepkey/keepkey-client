import 'webextension-polyfill';
// Process polyfill for browser environment
import '../polyfills/process';
// Buffer polyfill for browser environment
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import packageJson from '../../package.json';
import * as wallet from './wallet';
import { deriveUtxoAddress } from './utxoDerive';
import { resetSolanaState, prefetchSolanaAccounts, deriveSolanaAccount } from './chains/solanaHandler';
import { handleSwapMessage, resolveAddress } from './swapHandler';
import { startSwapEventStream, stopSwapEventStream } from './swapEventStream';
import { resetTonState, prefetchTonAddress } from './chains/tonHandler';
import { resetTronState, prefetchTronPubkey } from './chains/tronHandler';
import { handleWalletRequest } from './methods';
import { setApprovalBadge } from './popup';
import { fetchJsonWithTimeout } from './fetchUtils';
import { JsonRpcProvider, formatEther } from 'ethers';
import {
  ChainToNetworkId,
  Chain,
  COIN_MAP_LONG,
  shortListSymbolToCaip,
  NetworkIdToChain,
  buildAccountPaths,
  supportsMultiAccount,
  SOLANA_NETWORK_ID,
} from './chainConfig';
import {
  requestStorage,
  exampleSidebarStorage,
  web3ProviderStorage,
  blockchainDataStorage,
  blockchainStorage,
  assetContextStorage,
  ethAccountsStorage,
  accountsByNetworkStorage,
  customEvmNetworksStorage,
  testnetSettingsStorage,
  customTokensStorageApi,
} from '@extension/storage';
import { getChainInfo } from './chains/registry';
import { withRpcFailoverByNetworkId } from './chains/rpcFailover';
import { EVM_TESTNETS, SOLANA_DEVNET, ALL_TESTNET_NETWORK_IDS } from './testnetPresets';
import { formatUserError, createVaultRequiredError } from './utils';
import { partitionSpamTokens, getTokenVisibilityMap, setTokenVisibility } from './spamFilter';

const TAG = ' | background/index.js | ';
console.log('Background script loaded');
console.log('Version:', packageJson.version);

// Make clicking the extension icon open the side panel. Required because
// `chrome.sidePanel.open()` from a dApp-triggered approval flow isn't a
// user gesture and may be ignored — the icon click is the guaranteed
// fallback path. No-op on Firefox (no sidePanel API).
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(e => console.warn(TAG, 'setPanelBehavior failed', e));
}

const PIONEER_API = 'https://api.keepkey.info';

const KEEPKEY_STATES = {
  0: 'unknown',
  1: 'disconnected',
  2: 'connected',
  3: 'busy',
  4: 'errored',
  5: 'paired',
};
let KEEPKEY_STATE = 0;

// MV3 service workers sometimes fail `chrome.action.setIcon({path})` with
// "Failed to fetch" when the worker has just (re-)started — the extension's
// file-map isn't always ready to serve its own packaged assets immediately.
// Guards:
//   1. Deduplicate: don't re-invoke the API when the path hasn't changed
//      (checkKeepKey fires updateIcon every 5s; 99% of those calls are
//       redundant and each one is a chance to hit the transient error).
//   2. Retry by re-running updateIcon() — NOT by replaying the captured
//      path. If KEEPKEY_STATE flipped during the 500 ms gap, re-running
//      reads the current state and applies whatever is correct now,
//      preventing a stale "online" icon from painting over a subsequent
//      "errored" transition.
let lastIconPath: string | null = null;
let iconRetryPending = false;

function currentIconPath(): string {
  // Show green/online icon when connected (state 2) or paired (state 5)
  return KEEPKEY_STATE === 2 || KEEPKEY_STATE === 5 ? './icon-128-online.png' : './icon-128.png';
}

function updateIcon() {
  const iconPath = currentIconPath();
  if (iconPath === lastIconPath) return;
  lastIconPath = iconPath;

  chrome.action.setIcon({ path: iconPath }, () => {
    const err = chrome.runtime.lastError;
    if (!err) return;
    // Clear the dedupe so the retry path can actually re-apply an icon
    // (even if it's the same string) and then call updateIcon() again.
    // Re-running reads CURRENT state, so a state flip during the 500ms
    // backoff doesn't leave us painting a stale icon.
    lastIconPath = null;
    if (iconRetryPending) return; // one retry in flight is enough
    iconRetryPending = true;
    setTimeout(() => {
      iconRetryPending = false;
      updateIcon();
    }, 500);
  });
}

function pushStateChangeEvent() {
  chrome.runtime
    .sendMessage({
      type: 'KEEPKEY_STATE_CHANGED',
      state: KEEPKEY_STATE,
    })
    .catch(() => {
      // Ignore — no popup/sidebar listening
    });
}

// Throttle device-probe attempts to avoid hammering the vault while in view-only mode.
let lastDeviceProbeAt = 0;
const DEVICE_PROBE_INTERVAL_MS = 15_000;

// Separate, longer throttle for the "already-connected, verify deviceId hasn't
// changed" re-probe. Vault + device hot-swap is rare enough that 30s latency
// on detection is fine; keeping this longer than the view-only probe avoids
// doubling the getFeatures traffic on the steady-state path.
let lastDeviceVerifyAt = 0;
const DEVICE_VERIFY_INTERVAL_MS = 30_000;

/**
 * Called when we detect that the vault is now paired with a different
 * KeepKey than the one we had cached. Clears every piece of state keyed
 * to the previous device and re-fetches from the new one.
 */
async function handleDeviceSwitch(newDeviceInfo: any) {
  const tag = TAG + ' | handleDeviceSwitch | ';
  console.warn(tag, 'Device swap detected. Purging caches and re-fetching.');

  // In-memory + storage cache owned by wallet.ts
  await wallet.handleDeviceSwitch(newDeviceInfo);

  // Balance caches — pubkey-keyed, so they're poisoned by the old device
  cachedBalances = [];
  hiddenBalances = [];
  balancesFetchInProgress = null;
  lastFetchError = null;
  cacheFromHydrate = false;
  hydratedFingerprint = null;
  tokenDiscoveryDone = false;

  // Per-chain address caches (Solana/Tron/TON each keep their own lookup
  // cache above the pubkey layer)
  resetSolanaState();
  resetTronState();
  resetTonState();

  // Re-fetch against the new device. refreshPubkeys re-probes and pulls
  // a fresh pubkey batch, then updates state.initialized.
  try {
    await wallet.refreshPubkeys();

    // refreshPubkeys only hits getDefaultPaths() — the big batched
    // derivation. Solana, Tron, and TON addresses are *dynamically*
    // added at onStart via these prefetches (SOL needs solanaGetAddress,
    // TRX needs tronGetAddress, TON needs tonGetAddress — none of which
    // are in the xpub.getPublicKeys batch). Without re-running them on
    // a device swap, those three chains end up with stale per-chain
    // caches (zeroed out by resetXState above) and no pubkeys, so
    // they'd vanish from the network dropdown until a user manually
    // visited the asset or reloaded the extension.
    //
    // Fire in parallel — each is non-throwing, so an individual chain
    // failure won't take the others down.
    await Promise.allSettled([prefetchSolanaAccounts(), prefetchTronPubkey(), prefetchTonAddress()]);

    pushStateChangeEvent();
    pushBalancesUpdated();
    // Kick a fresh balance fetch in the background so the dashboard
    // swaps to the new device's balances without waiting for the next
    // user-triggered refresh.
    fetchBalancesFromPioneer(true).catch(e => console.warn(tag, 'Post-switch balance fetch failed:', e));
  } catch (e) {
    console.error(tag, 'Failed to re-fetch pubkeys after device switch:', (e as Error)?.message || e);
    pushStateChangeEvent();
  }
}

// Singleflight guard: a stalled localhost:1646 request would otherwise
// stack probes every 5s, generating overlapping async work and stale
// state transitions. If the previous tick is still running, skip this
// one. Combined with AbortSignal.timeout(3000) below, the worst case is
// one stalled request hung for 3s before the next tick can run.
let healthPollInflight = false;

async function checkKeepKey() {
  if (healthPollInflight) return;
  healthPollInflight = true;
  const prevState = KEEPKEY_STATE;
  try {
    const response = await fetch('http://localhost:1646/docs', { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      if (KEEPKEY_STATE < 2) {
        KEEPKEY_STATE = 2; // Set state to connected
      }
      updateIcon();
      if (KEEPKEY_STATE !== prevState) pushStateChangeEvent();
      // If the wallet is initialized but in view-only mode, try to upgrade by
      // probing the device and re-fetching pubkeys (throttled).
      const now = Date.now();
      const mayProbe = now - lastDeviceProbeAt >= DEVICE_PROBE_INTERVAL_MS;
      if (wallet.isInitialized() && !wallet.isDeviceConnected() && mayProbe) {
        lastDeviceProbeAt = now;
        wallet
          .refreshFromDevice()
          .then(upgraded => {
            if (upgraded) {
              console.log(TAG, 'Device reconnected — refreshed pubkeys from device');
              pushStateChangeEvent();
            }
          })
          .catch(e => console.warn(TAG, 'Device refresh failed:', (e as Error)?.message || e));
      } else if (!wallet.isInitialized() && mayProbe) {
        // First-run case: init failed earlier (no device, no cache) — retry.
        lastDeviceProbeAt = now;
        ensureStarted();
      } else if (wallet.isInitialized() && wallet.isDeviceConnected()) {
        // Steady state: vault-up, device-connected. Periodically re-probe
        // features to verify the same physical device is still paired. A
        // hot-swap to a different KeepKey will look identical to the /docs
        // endpoint but returns a different device_id from getFeatures.
        const mayVerify = now - lastDeviceVerifyAt >= DEVICE_VERIFY_INTERVAL_MS;
        if (mayVerify) {
          lastDeviceVerifyAt = now;
          const beforeId = wallet.getDeviceId();
          wallet
            .probeDevice()
            .then(ok => {
              if (!ok) return; // probe failure — next tick will set state=4
              const afterId = wallet.getDeviceId();
              if (beforeId && afterId && beforeId !== afterId) {
                handleDeviceSwitch(wallet.getDeviceInfo()).catch(e =>
                  console.error(TAG, 'handleDeviceSwitch failed:', e),
                );
              }
            })
            .catch(e => console.warn(TAG, 'Feature re-probe failed:', (e as Error)?.message || e));
        }
      }
    }
  } catch (error: any) {
    if (KEEPKEY_STATE !== 4) {
      console.warn('KeepKey endpoint not found:', error?.message || error);
    }
    // Clear cached per-chain state when transitioning from connected → disconnected
    // so a hot-swapped device doesn't sign against a stale cached address.
    if (prevState === 2 || prevState === 5) {
      resetSolanaState();
      resetTronState();
      resetTonState();
    }
    KEEPKEY_STATE = 4; // Set state to errored
    updateIcon();
    if (KEEPKEY_STATE !== prevState) pushStateChangeEvent();
  } finally {
    healthPollInflight = false;
  }
}

// Call checkKeepKey every 5 seconds
setInterval(checkKeepKey, 5000);

updateIcon();
console.log('Background loaded');

let ADDRESS = '';

// ---- Balance fetching via Pioneer API ----
let cachedBalances: any[] = [];
let balancesFetchInProgress: Promise<any[]> | null = null;
// Set once a forced (discovery) fetch commits. Guards the GET_APP_BALANCES
// auto-discovery backstop so we don't re-poll Pioneer when a wallet genuinely
// holds no tokens.
let tokenDiscoveryDone = false;
// Monotonic sequence so an earlier, slower fetch can't clobber a later fetch's
// result when they overlap. Bumped each time a new fetch actually starts work
// (not for calls that return the in-flight dedup promise).
let latestFetchId = 0;

// ---- Last-good portfolio persistence (chrome.storage.local) ----
// Hydrate cached balances at worker start so the dashboard shows real numbers
// immediately after MV3 evicts the service worker, instead of a $0 flash.
// Scoped to a fingerprint of the active wallet's pubkeys so a different device —
// or a different passphrase wallet on the same device — never shows the previous
// wallet's balances (the GET_APP_BALANCES guard drops a hydrated cache whose
// fingerprint doesn't match the connected wallet).
const PORTFOLIO_CACHE_KEY = 'keepkey-portfolio-cache';
let portfolioUpdatedAt = 0;
let cacheFromHydrate = false;
let hydratedFingerprint: string | null = null;
// Records the most recent real fetch failure (cleared on success). Surfaced
// additively on GET_APP_BALANCES so the UI can show "couldn't load — retry"
// instead of "no assets".
let lastFetchError: string | null = null;
// Tokens suppressed by default (the 'Mortal' fabricated-value class) or user-
// hidden. Kept OUT of cachedBalances so dashboard totals never include scam
// value; surfaced via GET_HIDDEN_TOKENS for the recoverable "Hidden" section.
let hiddenBalances: any[] = [];

function walletFingerprint(): string {
  const pks = wallet.getPubkeys();
  if (!pks.length) return '';
  const addrs = pks
    .map((p: any) => p.address || p.master || p.pubkey || '')
    .filter(Boolean)
    .sort();
  // Direct content fingerprint of the wallet's address set — no hashing, so no
  // collision risk for the cross-wallet cache guard.
  return addrs.join('|');
}

function persistPortfolio(balances: any[]) {
  portfolioUpdatedAt = Date.now();
  chrome.storage.local
    .set({
      [PORTFOLIO_CACHE_KEY]: {
        fingerprint: walletFingerprint(),
        balances,
        hidden: hiddenBalances,
        updatedAt: portfolioUpdatedAt,
      },
    })
    .catch(() => {});
}

// Kicked once at worker start. GET_APP_BALANCES awaits it before reading the
// cache so the very first dashboard paint can use last-good data.
const portfolioHydrated: Promise<void> = (async () => {
  try {
    const data = await chrome.storage.local.get(PORTFOLIO_CACHE_KEY);
    const cached = data[PORTFOLIO_CACHE_KEY];
    if (cached?.balances?.length && cachedBalances.length === 0) {
      cachedBalances = cached.balances;
      hiddenBalances = cached.hidden || [];
      portfolioUpdatedAt = cached.updatedAt || 0;
      hydratedFingerprint = cached.fingerprint || null;
      cacheFromHydrate = true;
      console.log(
        `[portfolio] hydrated ${cachedBalances.length} balances (+${hiddenBalances.length} hidden) from storage`,
      );
    }
  } catch {
    /* no persisted portfolio — ignore */
  }
})();

function pushBalancesUpdated() {
  chrome.runtime.sendMessage({ type: 'BALANCES_UPDATED' }).catch(() => {
    // No popup/sidebar listening — ignore.
  });
}

// Borrow USD prices already present in a fetched balances array to fill held
// natives Pioneer returned at $0 (custom-RPC chains, some L2s). No network calls
// — display-only (never touches balance/caip/address). L2 gas tokens ARE ETH, so
// an unpriced EVM ETH native borrows the mainnet ETH price (same as
// GET_EVM_BALANCE). Anything still unpriced is flagged priceUnavailable so the UI
// can render '—' instead of a misleading $0.
function backfillNativePrices(balances: any[]): void {
  const priceByCaip = new Map<string, string>();
  for (const b of balances) {
    if (b.caip && parseFloat(b.priceUsd || '0') > 0) priceByCaip.set(b.caip, b.priceUsd);
  }
  const ethPrice = balances.find(
    (b: any) => b.networkId === 'eip155:1' && b.isNative && parseFloat(b.priceUsd || '0') > 0,
  )?.priceUsd;
  for (const b of balances) {
    if (!b.isNative) continue;
    if (parseFloat(b.balance || '0') <= 0) continue;
    if (parseFloat(b.priceUsd || '0') > 0) continue;
    const sym = String(b.symbol || '').toUpperCase();
    let price = b.caip ? priceByCaip.get(b.caip) : undefined;
    // Testnets register their native as 'ETH' too — never borrow the real
    // mainnet price for faucet ETH (would put fake money in the dashboard total).
    if (
      !price &&
      b.networkId?.startsWith('eip155:') &&
      sym === 'ETH' &&
      !ALL_TESTNET_NETWORK_IDS.includes(b.networkId)
    ) {
      price = ethPrice;
    }
    if (price) {
      b.priceUsd = price;
      b.valueUsd = (parseFloat(b.balance) * parseFloat(price)).toString();
    } else {
      b.priceUnavailable = true;
    }
  }
}

// Lowercased CAIPs of all user-added custom tokens — used to exempt deliberately
// added tokens from default spam suppression.
async function getCustomTokenCaipSet(): Promise<Set<string>> {
  try {
    const all = await customTokensStorageApi.getAll();
    const set = new Set<string>();
    for (const byUser of Object.values(all || {})) {
      for (const tokens of Object.values(byUser || {})) {
        for (const t of tokens || []) {
          if (t?.caip) set.add(String(t.caip).toLowerCase());
        }
      }
    }
    return set;
  } catch {
    return new Set<string>();
  }
}

// Re-apply the durable per-token visibility overrides to the in-memory cache
// WITHOUT a network refetch, by re-partitioning the combined visible+hidden set.
// So a hide/un-hide is reflected and persisted immediately and survives a failed
// refetch or MV3 worker restart (the override map is the source of truth, not the
// last persisted partition).
async function reconcileVisibility(): Promise<void> {
  const overrides = await getTokenVisibilityMap();
  const customCaips = await getCustomTokenCaipSet();
  const combined = [...cachedBalances, ...hiddenBalances];
  const { visible, hidden } = partitionSpamTokens(
    combined,
    overrides,
    b => !!b.caip && customCaips.has(String(b.caip).toLowerCase()),
  );
  cachedBalances = visible;
  hiddenBalances = hidden;
  persistPortfolio(cachedBalances);
  pushBalancesUpdated();
}

// All EVM CAPIPs (deduplicated) — used to fan out EVM wildcard addresses
const EVM_CAIPS = [...new Set(Object.values(shortListSymbolToCaip).filter(caip => caip.startsWith('eip155:')))];

async function fetchBalancesFromPioneer(forceRefresh = false): Promise<any[]> {
  // Deduplicate concurrent calls — but honor forceRefresh
  if (balancesFetchInProgress && !forceRefresh) return balancesFetchInProgress;

  const myFetchId = ++latestFetchId;
  const thisPromise = (async () => {
    try {
      const allPubkeys = wallet.getPubkeys();
      if (allPubkeys.length === 0) return cachedBalances;

      // Build pubkeys array for Pioneer API: { caip, pubkey }
      const pioneerPubkeys: { caip: string; pubkey: string }[] = [];
      const seen = new Set<string>();

      for (const pk of allPubkeys) {
        const pubkeyValue = pk.address || pk.master || pk.xpub || pk.pubkey;
        if (!pubkeyValue) continue;

        const networks: string[] = pk.networks || [];
        const hasEvmWildcard = networks.includes('eip155:*');

        if (hasEvmWildcard) {
          // Fan out to all supported EVM chains (same address works on all)
          for (const caip of EVM_CAIPS) {
            const key = `${caip}:${pubkeyValue}`;
            if (!seen.has(key)) {
              seen.add(key);
              pioneerPubkeys.push({ caip, pubkey: pubkeyValue });
            }
          }
        }

        // Handle specific (non-wildcard) networks
        for (const networkId of networks) {
          if (networkId === 'eip155:*') continue; // Already handled above
          const symbol = (NetworkIdToChain as any)[networkId];
          if (!symbol) continue;
          const caip = shortListSymbolToCaip[symbol];
          if (!caip) continue;
          const key = `${caip}:${pubkeyValue}`;
          if (!seen.has(key)) {
            seen.add(key);
            pioneerPubkeys.push({ caip, pubkey: pubkeyValue });
          }
        }
      }

      if (pioneerPubkeys.length === 0) return cachedBalances;

      console.log(`[fetchBalances] Sending ${pioneerPubkeys.length} pubkeys to Pioneer API`);
      console.log(`[fetchBalances] Sample pubkeys:`, pioneerPubkeys.slice(0, 3));

      // One call, one endpoint: /api/v1/portfolio (GetPortfolioBalances).
      // Matches the vault's flow exactly — it's the only endpoint that
      // runs Pioneer's token auto-discovery (ERC-20 via Unchained, SPL
      // for Solana, TRC-20 for Tron). The older /charts/portfolio served
      // natives from a pre-computed cache with Zapper-provided EVM tokens
      // but dropped SPL/TRC-20 discovery; splitting traffic across both
      // was the reason USDT-Tron showed $0 in the BEX while the vault
      // dashboard had it. Slower per call (no pre-warm cache), but
      // correctness > speed for balance display.

      // Normalize Pioneer's response networkIds to the canonical form
      // used throughout the codebase. Two distinct problems, same shape:
      //
      //   1. CASING — Pioneer echoes mixed-case IDs (Solana, Tron) back
      //      lowercased. Side-panel uses strict equality against
      //      ChainToNetworkId, so lowercased entries get excluded.
      //
      //   2. TRON'S TWO IDS — Pioneer emits native TRX under the CAIP-2
      //      genesis hash id `tron:27Lqcw`, but TRC-20 tokens under the
      //      hex chain-id `tron:0x2b6653dc`. Both refer to Tron mainnet.
      //      Without aliasing, USDT-TRON is a ghost — the row is present
      //      in the balance cache but no Tron-filtered view ever finds it.
      //
      // Source rewrites (any of these lowercased or exact) → canonical:
      const NETWORK_ID_ALIASES: Record<string, string> = {
        'solana:5eykt4usfv8p8njdtrepy1vzqkqzkvdp': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        'tron:27lqcw': 'tron:27Lqcw',
        'tron:0x2b6653dc': 'tron:27Lqcw',
      };
      const normalizeCasing = (entry: any) => {
        const caip = entry.caip || '';
        const netId = entry.networkId || '';
        const canonical = NETWORK_ID_ALIASES[netId.toLowerCase()];
        if (canonical) {
          entry.networkId = canonical;
          // Rewrite caip's network-id prefix too, keeping the path
          // segment ("slip44:195", "token:TR7NHq...") intact.
          const slashIdx = caip.indexOf('/');
          if (slashIdx > 0) {
            entry.caip = canonical + caip.slice(slashIdx);
          }
        }
        return entry;
      };

      const fetchPortfolio = async (batch: typeof pioneerPubkeys) => {
        if (batch.length === 0) return { balances: [] as any[], tokens: [] as any[] };
        try {
          const url = `${PIONEER_API}/api/v1/portfolio${forceRefresh ? '?forceRefresh=true' : ''}`;
          // 12s budget: portfolio is the heaviest Pioneer endpoint
          // (cold token discovery), so default 8s is too tight on first
          // load. One retry on 5xx absorbs single transient failures.
          const json = await fetchJsonWithTimeout<any>(
            url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                // Pioneer's api_key security reads the Authorization
                // header verbatim (no Bearer prefix). Any unique
                // `key:public-*` string works for anonymous reads; the
                // timestamp is just a cache-busting nonce.
                Authorization: `key:public-${Date.now()}`,
              },
              body: JSON.stringify({ pubkeys: batch }),
            },
            { timeoutMs: 12000, retries: 1 },
          );
          // Unwrap: /portfolio returns { balances: [...] } at the top
          // level; some deployments wrap in { data: { balances } } via
          // middleware, so handle both.
          const allEntries: any[] = json?.balances || json?.data?.balances || [];
          const natives: any[] = [];
          const tokens: any[] = [];
          for (const raw of allEntries) {
            const entry = normalizeCasing({ ...raw });
            // Match vault's classification exactly: token if caip path
            // is not slip44:/native:, or type === 'token', or explicit
            // isNative===false + contract. Covers ERC-20 (erc20:),
            // SPL (spl:/token:), TRC-20 (trc20:/token:) uniformly.
            const caipPath = (entry.caip || '').split('/')[1] || '';
            const isTokenByCaip = caipPath && !caipPath.startsWith('slip44:') && !caipPath.startsWith('native:');
            const isTokenByType = entry.type === 'token' || (entry.isNative === false && entry.contract);
            if (isTokenByCaip || isTokenByType) tokens.push(entry);
            else natives.push(entry);
          }
          console.log(`[fetchBalances] portfolio: ${natives.length} natives, ${tokens.length} tokens`);
          lastFetchError = null; // a parsed response (even empty) is a success, not an error
          return { balances: natives, tokens };
        } catch (e: any) {
          console.warn('[fetchBalances] portfolio error:', e.message);
          lastFetchError = e?.message || 'portfolio fetch failed';
          return { balances: [] as any[], tokens: [] as any[] };
        }
      };

      const portfolioResult = await fetchPortfolio(pioneerPubkeys);
      const rawBalances: any[] = [...portfolioResult.balances];
      const rawTokens: any[] = [...portfolioResult.tokens];

      if (rawBalances.length === 0 && rawTokens.length === 0) {
        console.warn('[fetchBalances] Pioneer returned 0 balances for', pioneerPubkeys.length, 'pubkeys');
        return cachedBalances;
      }

      // Transform native balances. `let` because we reassign after spam
      // filtering below; token entries are appended earlier, filtered later.
      let balances: any[] = rawBalances.map((b: any) => {
        const caip = b.caip || '';
        const networkId = b.networkId || caip.split('/')[0] || '';
        return {
          networkId,
          caip,
          symbol: b.symbol || '',
          name: b.name || b.symbol || '',
          balance: String(b.balance ?? '0'),
          valueUsd: String(b.valueUsd ?? '0'),
          priceUsd: String(b.priceUsd ?? '0'),
          icon: b.icon || (caip ? `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png` : ''),
          isNative: true,
          address: b.address || b.pubkey || '',
        };
      });

      // Add token balances. /portfolio returns tokens in flat format
      // alongside natives (ERC-20, SPL, TRC-20 all classified already).
      for (const t of rawTokens) {
        const caip = t.caip || '';
        const networkId = t.networkId || caip.split('/')[0] || '';
        // Pioneer's token caips vary by chain: erc20 (EVM), spl+token
        // (Solana), token+trc20 (Tron). Match all so `contractAddress`
        // is populated uniformly; fall back to `t.contract` which
        // Pioneer also emits for TRC-20 / SPL discovery rows.
        const contractMatch = caip.match(/\/(?:erc20|spl|trc20|token):([^\s]+)/);
        balances.push({
          networkId,
          caip,
          symbol: t.symbol || t.ticker || '',
          name: t.name || t.symbol || '',
          balance: String(t.balance ?? '0'),
          valueUsd: String(t.valueUsd ?? '0'),
          priceUsd: String(t.priceUsd ?? '0'),
          icon:
            t.icon || t.image || (caip ? `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png` : ''),
          decimals: t.decimals ?? t.decimal,
          isNative: false,
          token: true,
          address: t.pubkey || t.address || '',
          contractAddress: contractMatch ? contractMatch[1] : t.contract || t.contractAddress || '',
        });
      }

      // Enrich with direct RPC balances for custom EVM chains Pioneer doesn't know about
      try {
        const savedChains = await blockchainStorage.getAllBlockchains();
        const coveredNetworks = new Set(balances.filter((b: any) => b.isNative).map((b: any) => b.networkId));
        const evmAddress = allPubkeys.find((pk: any) => pk.networks?.includes('eip155:*'))?.address;

        if (evmAddress) {
          for (const networkId of savedChains || []) {
            if (coveredNetworks.has(networkId)) continue;
            if (!networkId.startsWith('eip155:')) continue;

            const chainData = await blockchainDataStorage.getBlockchainData(networkId);
            if (!chainData?.providerUrl) continue;

            try {
              // Use the failover stack so every URL in providers[] is
              // tried, not just providerUrl — testnets ship multiple RPCs.
              const rawBal = await withRpcFailoverByNetworkId(networkId, p => p.getBalance(evmAddress), {
                timeoutMs: 5000,
              });
              const balStr = (Number(rawBal) / 1e18).toString();
              const caip = chainData.caip || `${networkId}/slip44:60`;
              balances.push({
                networkId,
                caip,
                symbol: chainData.symbol || chainData.nativeCurrency?.symbol || '',
                name: chainData.name || networkId,
                balance: balStr,
                valueUsd: '0',
                priceUsd: '0',
                icon: chainData.icon || `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png`,
                isNative: true,
                address: evmAddress,
              });
              console.log(`[fetchBalances] RPC balance for ${chainData.name}: ${balStr}`);
            } catch (e: any) {
              console.warn(`[fetchBalances] RPC balance failed for ${networkId}:`, e.message);
            }
          }

          // Solana devnet: Pioneer only indexes mainnet, so fetch the
          // devnet native balance directly. Same address works on every
          // cluster. Best-effort — failure just leaves it absent.
          const savedChainsSet = new Set(savedChains || []);
          if (savedChainsSet.has(SOLANA_DEVNET.networkId) && !coveredNetworks.has(SOLANA_DEVNET.networkId)) {
            const solAddr = allPubkeys.find((pk: any) =>
              (pk.networks || []).some((n: string) => n.startsWith('solana:')),
            )?.address;
            if (solAddr) {
              try {
                const resp = await fetch(SOLANA_DEVNET.rpcs[0], {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [solAddr] }),
                  signal: AbortSignal.timeout(5000),
                });
                const json = await resp.json();
                const lamports = json?.result?.value ?? 0;
                balances.push({
                  networkId: SOLANA_DEVNET.networkId,
                  caip: SOLANA_DEVNET.caip,
                  symbol: SOLANA_DEVNET.symbol,
                  name: SOLANA_DEVNET.name,
                  balance: (lamports / 1e9).toString(),
                  valueUsd: '0',
                  priceUsd: '0',
                  isNative: true,
                  address: solAddr,
                });
                console.log(`[fetchBalances] Solana devnet balance: ${lamports / 1e9}`);
              } catch (e: any) {
                console.warn('[fetchBalances] Solana devnet balance failed:', e.message);
              }
            }
          }
        }
      } catch (e: any) {
        console.warn('[fetchBalances] Custom chain enrichment error:', e.message);
      }

      // Backfill USD prices for held natives Pioneer returned at $0, reusing
      // prices already in this response (no network call). After custom-chain
      // enrichment so RPC-derived natives are included.
      backfillNativePrices(balances);

      const preFilterCount = balances.length;
      // Spam handling at the single chokepoint: honor per-token user overrides
      // (tier 0), HARD-DROP confirmed phishing, and route 'Mortal'-class
      // fabricated-value tokens into a recoverable Hidden bucket (kept OUT of the
      // cache/totals; surfaced via GET_HIDDEN_TOKENS). User-added custom tokens
      // are exempt from default suppression.
      const visibilityOverrides = await getTokenVisibilityMap();
      const customCaips = await getCustomTokenCaipSet();
      const { visible, hidden } = partitionSpamTokens(
        balances,
        visibilityOverrides,
        b => !!b.caip && customCaips.has(String(b.caip).toLowerCase()),
      );
      balances = visible;
      if (hidden.length > 0) {
        console.log(`[fetchBalances] Spam: ${visible.length} visible, ${hidden.length} hidden of ${preFilterCount}`);
      }

      console.log(
        `[fetchBalances] Got ${balances.length} balance entries (${balances.filter((b: any) => b.isNative).length} native, ${balances.filter((b: any) => !b.isNative).length} tokens)`,
      );
      // Only commit if we are still the most recent fetch AND our pubkey
      // snapshot hasn't been invalidated by a subsequent addPubkey. The
      // id check alone is not enough: concurrent prefetches all bump
      // latestFetchId at start, so a fetch that *started last* (highest
      // id) wins the id check even if its snapshot was taken *before*
      // prefetchTonAddress / prefetchSolanaPubkey / prefetchTronPubkey
      // landed their dynamic pubkey. That's exactly how a
      // post-prefetch "committed" snapshot can be missing TON — the
      // fetch that came in latest was also the one that missed the
      // add. Compare pubkey counts now vs at snapshot; if the set has
      // grown, supersede ourselves so the next (already queued)
      // force-refetch that DID see the new pubkey can commit cleanly.
      const currentPubkeyCount = wallet.getPubkeys().length;
      const snapshotStale = currentPubkeyCount > allPubkeys.length;
      if (myFetchId === latestFetchId && !snapshotStale) {
        cachedBalances = balances;
        // Adopt the Hidden bucket only on the winning commit (mirrors cachedBalances)
        // so a superseded fetch can't leave the Hidden section out of sync.
        hiddenBalances = hidden;
        // This commit is authoritative for the connected wallet — supersede any
        // hydrated last-good cache and persist the fresh set for next worker start.
        cacheFromHydrate = false;
        lastFetchError = null;
        persistPortfolio(balances);
        // A forced fetch performs token discovery (ERC-20/SPL/TRC-20); record
        // that so the GET_APP_BALANCES backstop stops re-triggering.
        if (forceRefresh) tokenDiscoveryDone = true;
        // Native-row summary keyed by networkId — makes it easy to spot
        // a chain that got dropped silently between fetches. One line
        // per fetch commit; if a balance looks missing on the dashboard,
        // this is the quickest place to see whether the cache actually
        // has the row at all.
        const nativeSummary = balances
          .filter((b: any) => b.isNative)
          .map((b: any) => `${b.networkId}=${b.balance}`)
          .join('; ');
        console.log(`[fetchBalances] #${myFetchId} committed. natives: ${nativeSummary}`);
        pushBalancesUpdated();
      } else if (snapshotStale) {
        console.log(
          `[fetchBalances] discarding #${myFetchId} — pubkey set grew from ${allPubkeys.length} to ${currentPubkeyCount} since snapshot`,
        );
      } else {
        console.log(
          `[fetchBalances] discarding result from superseded fetch #${myFetchId} (latest: #${latestFetchId})`,
        );
      }
      return balances;
    } catch (e: any) {
      console.error('[fetchBalances] Error:', e.message || e);
      // Only the winning fetch may record an error — a superseded/late failure
      // must not clobber a newer fetch's cleared state.
      if (myFetchId === latestFetchId) lastFetchError = e?.message || 'balance fetch failed';
      return cachedBalances;
    } finally {
      // Only clear the in-flight ref if WE are still the active fetch — a newer
      // forceRefresh bumps latestFetchId (and replaces balancesFetchInProgress)
      // while we run. Comparing fetch ids avoids referencing thisPromise from
      // inside its own initializer (which would force a `let` + self-reference).
      if (myFetchId === latestFetchId) {
        balancesFetchInProgress = null;
      }
    }
  })();

  balancesFetchInProgress = thisPromise;
  return thisPromise;
}

/**
 * Drop pending approval events left in `requestStorage` from a previous
 * service-worker lifecycle.
 *
 * Why: `requireApproval` (in methods.ts) stores the event, sets the
 * badge, and waits for an `eth_sign_response` message via an in-memory
 * `chrome.runtime.onMessage` listener. When the SW dies mid-flight (MV3
 * idle eviction, manual reload, dev rebuild) the storage entry survives
 * but the listener doesn't. A user who clicks Approve in the side panel
 * after restart sends a message into the void; nothing happens; the
 * dApp eventually times out at 5min.
 *
 * BUT — `requestStorage` is also briefly used as a "post-broadcast
 * holding pen" for some chains. EVM writes `txid` into the same entry
 * after broadcast (ethereumHandler.ts), and the side-panel TxidPage
 * only moves the entry to `approvalStorage` when the user clicks
 * Close. Solana flips status to 'broadcasted'; TON to 'completed'. We
 * MUST NOT cancel those — the tx has already gone out and the user is
 * still seeing the success page.
 *
 * Heuristic for "truly pending and now orphaned":
 *   - no broadcast artifact (txid / txHash / signedTx) AND
 *   - status is undefined or 'request'
 *
 * Anything else is post-action; preserve and let the normal UI path
 * complete the lifecycle (Close → moveTo approvalStorage).
 */
function isOrphanedPendingEvent(ev: any): boolean {
  if (!ev) return false;
  if (ev.txid || ev.txHash || ev.signedTx) return false;
  const status = ev.status;
  if (status && status !== 'request') return false;
  return true;
}

async function clearOrphanedApprovalEvents() {
  const tag = TAG + ' | clearOrphanedApprovalEvents | ';
  try {
    const events = (await requestStorage.getEvents()) || [];
    if (events.length === 0) return;
    const orphans = events.filter(isOrphanedPendingEvent);
    if (orphans.length === 0) {
      console.log(tag, `${events.length} event(s) in storage; all post-broadcast — preserving for UI completion`);
      return;
    }
    console.log(
      tag,
      `dropping ${orphans.length} orphaned pending event(s) (preserving ${events.length - orphans.length} post-broadcast)`,
    );
    for (const ev of orphans) {
      // Notify side-panel UI (no-op if no panel is listening). The
      // dApp side already received a port-closed error when the SW
      // died, so we don't need to signal there.
      chrome.runtime
        .sendMessage({
          action: 'transaction_error',
          eventId: ev.id,
          error: 'Request cancelled — wallet restarted',
          kind: 'cancelled',
        })
        .catch(() => {});
      try {
        await requestStorage.removeEventById(ev.id);
      } catch (e) {
        console.warn(tag, 'failed to remove orphan', ev.id, e);
      }
    }
    // The badge was set when the request was created; the cleanup
    // that would have unset it died with the SW. Reset only if every
    // event in storage is now gone — otherwise a preserved post-
    // broadcast entry may still legitimately want the badge.
    const remaining = (await requestStorage.getEvents()) || [];
    if (remaining.length === 0) setApprovalBadge(false);
  } catch (e) {
    console.warn(tag, 'unexpected error', e);
  }
}

// Fire as the SW spawns — BEFORE the 5s wallet-init delay below, so the
// side panel doesn't have a window to render and accept clicks on a
// stale orphan event during boot. Async; we don't await at top level
// (would block other listener registrations in MV3).
void clearOrphanedApprovalEvents();

const onStart = async function () {
  const tag = TAG + ' | onStart | ';
  try {
    console.log(tag, 'Starting...');
    // Orphan cleanup runs at module-load time (above) so the side
    // panel can't render stale events during the 5s wallet-init
    // delay. Don't repeat it here.
    resetSolanaState(); // clear stale cached address before re-init
    resetTronState();
    resetTonState();
    await wallet.init();
    console.log(tag, 'Wallet initialized');

    if (!wallet.isInitialized()) {
      // No device + no cached pubkeys. Show errored icon but don't crash the
      // service worker — a later device plug-in will trigger a refresh.
      console.warn(tag, 'No pubkeys available (no device and no cache). Plug in KeepKey to initialize.');
      KEEPKEY_STATE = 4;
      updateIcon();
      pushStateChangeEvent();
      return;
    }
    if (!wallet.isDeviceConnected()) {
      console.log(tag, 'Running in view-only mode — signing will require device reconnect');
    }

    // Load persisted ETH accounts and derive any beyond account 0
    try {
      const savedAccounts = await ethAccountsStorage.getAccounts();
      const HARDENED = 0x80000000;
      let needsRefresh = false;
      for (const idx of savedAccounts) {
        if (idx === 0) continue; // account 0 is in default paths
        const existingPaths = wallet.getPaths();
        const alreadyExists = existingPaths.some((p: any) => p.note === `Ethereum account ${idx}`);
        if (!alreadyExists) {
          wallet.addPath({
            note: `Ethereum account ${idx}`,
            networks: ['eip155:1'],
            script_type: 'ethereum',
            type: 'address',
            addressNList: [HARDENED + 44, HARDENED + 60, HARDENED + idx, 0, 0],
            addressNListMaster: [HARDENED + 44, HARDENED + 60, HARDENED + idx, 0, 0],
            curve: 'secp256k1',
            showDisplay: false,
            accountIndex: idx,
          });
          needsRefresh = true;
        }
      }
      if (needsRefresh) {
        await wallet.refreshPubkeys();
        console.log(tag, 'Refreshed pubkeys with', savedAccounts.length, 'ETH accounts');
      }
    } catch (e) {
      console.warn(tag, 'Failed to load persisted ETH accounts:', e);
    }

    // Load persisted non-EVM batch accounts (UTXO non-BTC + Cosmos-family) and
    // re-add their paths so refreshPubkeys derives them — same contract as the
    // ETH reload above. Solana is off-batch and handled by prefetchSolanaAccounts.
    try {
      const map = (await accountsByNetworkStorage.get()) || {};
      let needsNonEvmRefresh = false;
      for (const [networkId, indices] of Object.entries(map)) {
        if (!supportsMultiAccount(networkId) || networkId === SOLANA_NETWORK_ID) continue;
        for (const idx of indices as number[]) {
          if (idx === 0) continue; // account 0 lives in the default paths
          for (const p of buildAccountPaths(networkId, idx)) {
            if (!wallet.getPaths().some((e: any) => e.note === p.note)) {
              wallet.addPath(p);
              needsNonEvmRefresh = true;
            }
          }
        }
      }
      if (needsNonEvmRefresh) {
        await wallet.refreshPubkeys();
        console.log(tag, 'Refreshed pubkeys with persisted non-EVM accounts');
      }
    } catch (e) {
      console.warn(tag, 'Failed to load persisted non-EVM accounts:', e);
    }

    const pubkeys = wallet.getPubkeys();
    console.log(tag, 'pubkeys:', pubkeys.length);

    // Run migration check once per session
    const { pubkeyStorage: migrationStorage } = await import('@extension/storage');
    try {
      const migrated = await migrationStorage.migrateFromVault();
      if (migrated) {
        console.log('Successfully migrated pubkeys from vault');
      }
    } catch (error) {
      console.warn('Migration check failed (normal if vault not installed):', error);
    }

    const pubkeysEth = wallet.getPubkeys(ChainToNetworkId[Chain.Ethereum]);
    if (pubkeysEth.length > 0) {
      console.log(tag, 'Ethereum pubkeys:', pubkeysEth.length);
      const address = pubkeysEth[0].address;
      if (address) {
        console.log(tag, 'Ethereum address:', address);
        ADDRESS = address;
        KEEPKEY_STATE = 5;
        updateIcon();
        pushStateChangeEvent();
      }

      // Get current provider — only build a default if none is stored.
      // Source the default from Pioneer rather than a hardcoded URL so
      // we never ship a stale RPC behind a release.
      const currentProvider = await web3ProviderStorage.getWeb3Provider();
      if (!currentProvider) {
        console.log(tag, 'No provider set, fetching default ETH config from Pioneer');
        const ethInfo = await getChainInfo('eip155:1');
        if (ethInfo?.rpc) {
          await web3ProviderStorage.saveWeb3Provider({
            chainId: ethInfo.chainId,
            caip: ethInfo.caip,
            networkId: ethInfo.networkId,
            blockExplorerUrls: ethInfo.explorer ? [ethInfo.explorer] : [],
            name: ethInfo.name,
            // Carry the explorer tx-link prefix so TxidPage can deep-link the
            // txid after a send. Without it the success screen shows a bare
            // hash with no "View on Explorer" link.
            explorerTxLink: ethInfo.explorerTxLink,
            providerUrl: ethInfo.rpc,
            // Full list (primary included) under `providers` — the key the
            // failover loops (getProvider / withRpcFailover) actually read.
            providers: ethInfo.rpcs,
          } as any);
        } else {
          console.warn(tag, 'Pioneer did not return ETH chain info — leaving provider unset until user picks one');
        }
      }

      // Fetch balances in background (non-blocking). First pass covers EVM/UTXO
      // quickly — on first run the Solana / Tron / TON pubkeys haven't been
      // derived yet, so they won't be in this request.
      fetchBalancesFromPioneer().catch(e => console.warn(tag, 'Initial balance fetch failed:', e));

      // Solana / Tron / TON addresses are derived outside the batch xpub
      // flow (firmware message type is separate). Each prefetch internally
      // calls wallet.addPubkey, so once they all settle the wallet has the
      // complete pubkey set. We then fire ONE force-refresh against Pioneer
      // /portfolio with everyone present — that's the request whose
      // snapshot won't be invalidated mid-flight, so its commit actually
      // lands.
      //
      // Why not chain a force-fetch after each individual prefetch (the
      // old shape)? Because they ran in parallel: each fetch's snapshot
      // misses the pubkeys still being added by the other two prefetches,
      // and the staleness guard at fetchBalancesFromPioneer's commit step
      // discards them. With three parallel prefetches, only the last one
      // to commit could survive — and if that one was Tron/TON without
      // Solana having fully landed yet, SPL tokens never made it into
      // cachedBalances. Users saw "No tokens" until they hit the manual
      // Discover button (which by coincidence runs after the slowest
      // prefetch finally lands).
      Promise.allSettled([prefetchSolanaAccounts(), prefetchTronPubkey(), prefetchTonAddress()])
        .then(() => fetchBalancesFromPioneer(true))
        .catch(e => console.warn(tag, 'Post-prefetch balance fetch failed:', e));
    } else {
      console.error(tag, 'FAILED TO INIT, No Ethereum address found');
    }
  } catch (e) {
    KEEPKEY_STATE = 4; // errored
    updateIcon();
    pushStateChangeEvent();
    console.error(tag, 'Error:', e);
  }
};

// Single-flight wrapper around onStart(). A dApp typically fires several RPCs
// the instant it connects (eth_requestAccounts + eth_chainId + eth_accounts),
// and the side panel's ON_START plus the 5s health-poll retry can overlap them.
// wallet.init() is already single-flight, but the account-loading / migration /
// ADDRESS-resolution tail of onStart is not — without this each caller would run
// a full onStart (redundant account reloads, parallel device xpub batches).
// Collapse concurrent callers into one run.
let onStartInFlight: Promise<void> | null = null;
function ensureStarted(): Promise<void> {
  if (onStartInFlight) return onStartInFlight;
  onStartInFlight = onStart().finally(() => {
    onStartInFlight = null;
  });
  return onStartInFlight;
}

setTimeout(() => {
  ensureStarted();
}, 5000);

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  (async () => {
    const tag = TAG + ' | chrome.runtime.onMessage | ';

    try {
      switch (message.type) {
        case 'WALLET_REQUEST': {
          // MV3 evicts the service worker after ~30s idle, wiping all in-memory
          // wallet state. A dApp's first RPC (typically eth_requestAccounts)
          // wakes the worker, but boot init runs on a 5s timer and the retry-
          // aware vault probe can take several seconds more — so throwing here
          // rejected any request that landed in that window ("Wallet not
          // initialized"). Init on demand and wait for it instead of rejecting
          // the dApp; ensureStarted() single-flights so a burst of connect-time
          // RPCs shares one init. Only throw if the wallet is genuinely
          // uninitialized (no device and no cached pubkeys) after init runs.
          if (!wallet.isInitialized()) {
            console.warn(tag, 'WALLET_REQUEST before wallet ready — initializing on demand');
            await ensureStarted();
          }
          if (!wallet.isInitialized()) {
            // Distinguish "vault is closed" (state 4) from a transient init race
            // so the dApp gets the actionable "launch the Vault" message instead
            // of a bare "Wallet not initialized". The side panel already shows
            // the Connect/Vault-Required card off the same state.
            if (KEEPKEY_STATE === 4) throw createVaultRequiredError();
            throw Error('Wallet not initialized');
          }
          const { requestInfo } = message;
          const { method, params, chain } = requestInfo;

          // Tag the request with the sender's browser tab/window so the
          // approval side panel opens in the SAME window the dApp lives
          // in — not whichever web tab was focused last. Using "most
          // recently accessed" risked surfacing a signing prompt in a
          // completely different browser window than the one that
          // triggered it, which is a real phishing / mis-sign risk now
          // that the sidebar is the sole approval surface.
          if (sender?.tab) {
            requestInfo.__senderTabId = sender.tab.id;
            requestInfo.__senderWindowId = sender.tab.windowId;
          }

          if (method) {
            try {
              // KEEPKEY_WALLET and ADDRESS are passed for backward compat with handler signatures
              const result = await handleWalletRequest(requestInfo, chain, method, params, null, ADDRESS);

              // [HANDOFF] log: emit params + result on a single line per call so a
              // dApp-flow audit can be reconstructed by `grep '[HANDOFF]'` in the
              // background console. Especially valuable for read-side RPCs (eth_call,
              // eth_getBalance, eth_estimateGas, eth_getCode, eth_getTransactionCount)
              // that build the dApp's view of wallet state — if any of those return a
              // value that contradicts mainnet, the dApp builds a doomed request body
              // (e.g. wrong Permit2 nonce → /v1/swap 404).
              const resultType = typeof result;
              const resultPreview =
                resultType === 'string'
                  ? `len=${(result as string).length} value=${result}`
                  : `value=${JSON.stringify(result)}`;
              console.log(
                `[HANDOFF] BEX → content script (${chain}/${method})\n  params=${JSON.stringify(params)}\n  type=${resultType} ${resultPreview}`,
              );
              sendResponse({ result });
            } catch (error) {
              console.log(
                `[HANDOFF] BEX → content script (${chain}/${method}) ERROR\n  params=${JSON.stringify(params)}\n  error=`,
                error,
              );
              sendResponse({ error: formatUserError(error) });
            }
          } else {
            sendResponse({ error: 'Invalid request: missing method' });
          }
          break;
        }

        case 'GET_KEEPKEY_STATE': {
          sendResponse({ state: KEEPKEY_STATE });
          break;
        }

        case 'UPDATE_EVENT_BY_ID': {
          const { id, updatedEvent } = message.payload;
          const success = await requestStorage.updateEventById(id, updatedEvent);
          if (success) {
            console.log(`Event with id ${id} has been updated successfully.`);
          } else {
            console.error(`Failed to update event with id ${id}.`);
          }
          break;
        }

        case 'GET_BALANCE': {
          try {
            const { networkId } = message;
            // Try cached balances first
            const cached = cachedBalances.filter((b: any) => b.networkId === networkId);
            if (cached.length > 0) {
              sendResponse({ balances: cached });
            } else if (wallet.isInitialized()) {
              // Trigger full balance fetch if not cached
              const balances = await fetchBalancesFromPioneer();
              const filtered = balances.filter((b: any) => b.networkId === networkId);
              sendResponse({ balances: filtered });
            } else {
              sendResponse({ balances: [] });
            }
          } catch (error: any) {
            console.error(tag, 'GET_BALANCE error:', error);
            sendResponse({ error: error.message });
          }
          break;
        }

        case 'ON_START': {
          ensureStarted();
          setTimeout(() => {
            sendResponse({ state: KEEPKEY_STATE });
          }, 15000);
          break;
        }

        case 'CLEAR_CACHE': {
          cachedBalances = [];
          hiddenBalances = [];
          balancesFetchInProgress = null;
          lastFetchError = null;
          cacheFromHydrate = false;
          hydratedFingerprint = null;
          tokenDiscoveryDone = false;
          // Also drop the persisted portfolio so a worker restart can't re-hydrate
          // the stale set we just cleared.
          chrome.storage.local.remove(PORTFOLIO_CACHE_KEY).catch(() => {});
          sendResponse({ success: true });
          break;
        }

        case 'RESET_APP': {
          console.log(tag, 'Resetting app...');
          // Reply FIRST so the caller sees the ack before the service worker
          // reload tears down the message channel. Every other handler in
          // this file returns `{ success: true }` — align here too so UI
          // callers that branch on `response?.success` don't log/toast a
          // false failure on a successful reset.
          sendResponse({ success: true });
          chrome.runtime.reload();
          break;
        }

        case 'GET_APP': {
          // Return wallet state instead of full APP object
          sendResponse({
            app: {
              pubkeys: wallet.getPubkeys(),
              initialized: wallet.isInitialized(),
              deviceInfo: wallet.getDeviceInfo(),
            },
          });
          break;
        }

        case 'GET_ASSET_CONTEXT': {
          // Asset context lives in assetContextStorage (set by SET_ASSET_CONTEXT)
          const assetCtx = await assetContextStorage.get();
          // The context may have been stored before the first balance
          // fetch landed (SET_ASSET_CONTEXT enriches from cachedBalances
          // at write time). Re-attach price data at read time so the fee
          // card can render USD once balances arrive.
          if (assetCtx?.networkId && (!assetCtx.priceUsd || assetCtx.priceUsd === '0')) {
            const exact = assetCtx.caip && cachedBalances.find((b: any) => b.caip === assetCtx.caip);
            const nativeFallback = cachedBalances.find((b: any) => b.networkId === assetCtx.networkId && b.isNative);
            const match = exact || nativeFallback;
            if (match?.priceUsd && match.priceUsd !== '0') {
              assetCtx.priceUsd = match.priceUsd;
              if (!assetCtx.balance) assetCtx.balance = match.balance;
            }
          }
          sendResponse({ assets: assetCtx && Object.keys(assetCtx).length > 0 ? assetCtx : null });
          break;
        }

        case 'GET_TX_INSIGHT': {
          try {
            const providerInfo = await web3ProviderStorage.getWeb3Provider();
            if (!providerInfo) throw new Error('Invalid asset context. Missing provider.');
            const { tx, source } = message;
            tx.chainId = providerInfo.chainId;
            console.log(tag, 'GET_TX_INSIGHT', tx, source);
            if (!tx) throw new Error('Invalid request: missing tx');
            if (!source) throw new Error('Invalid request: missing source');

            const result = await fetchJsonWithTimeout<any>(
              `${PIONEER_API}/api/v1/insight`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tx, source }),
              },
              { timeoutMs: 8000, retries: 1 },
            );
            console.log(tag, 'GET_TX_INSIGHT result:', result);
            sendResponse(result);
          } catch (error: any) {
            console.error(tag, 'GET_TX_INSIGHT error:', error);
            sendResponse({ error: error.message });
          }
          break;
        }

        case 'GET_GAS_ESTIMATE': {
          try {
            const providerInfo = await web3ProviderStorage.getWeb3Provider();
            if (!providerInfo) throw Error('Failed to get provider info');
            const rawChainId = String(providerInfo.chainId ?? '');
            const chainIdNum = /^0x/i.test(rawChainId) ? parseInt(rawChainId, 16) : parseInt(rawChainId, 10);
            const networkId = providerInfo.networkId || (Number.isFinite(chainIdNum) ? `eip155:${chainIdNum}` : '');
            if (!networkId) throw Error('Cannot resolve networkId for active provider');
            // A single rate-limited primary must not kill the approval
            // flow — fail over custom → Pioneer → last-resort like the
            // other read sites.
            const feeData = await withRpcFailoverByNetworkId(networkId, p => p.getFeeData());
            sendResponse(feeData);
          } catch (error: any) {
            sendResponse({ error: error.message });
          }
          break;
        }

        case 'GET_MAX_SPENDABLE': {
          // SwapKit dependency removed — max spendable estimation deferred
          sendResponse({ error: 'Max spendable estimation not yet implemented' });
          break;
        }

        case 'CLEAR_ASSET_CONTEXT': {
          await assetContextStorage.clearContext();
          chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_CLEARED' }).catch(() => {});
          sendResponse({ success: true });
          break;
        }

        case 'SET_ASSET_CONTEXT': {
          const { asset } = message;
          if (asset && asset.caip) {
            try {
              console.log(tag, 'Setting asset context:', asset);

              // Enrich asset with pubkeys from wallet so Asset.tsx has addresses
              if (asset.networkId) {
                // An EVM address is identical on every EVM chain, so all
                // ETH-derived accounts (0/1/2/...) are valid receive targets
                // regardless of which EVM network is selected. Accounts 1+ are
                // registered with networks:['eip155:1'] (only account 0 carries
                // eip155:*), so a literal getPubkeys(networkId) drops them on
                // every non-mainnet EVM chain — Receive then collapses to
                // account 0. Mirror buildEvmAccounts() in headerUtils.ts.
                if (asset.networkId.startsWith('eip155:')) {
                  asset.pubkeys = wallet
                    .getPubkeys()
                    .filter((pk: any) => pk.networks?.includes('eip155:1') || pk.networks?.includes('eip155:*'));
                } else {
                  asset.pubkeys = wallet.getPubkeys(asset.networkId);
                }
                // Set address from first pubkey
                if (!asset.address && asset.pubkeys?.[0]?.address) {
                  asset.address = asset.pubkeys[0].address;
                }

                // UTXO assets coming from non-header paths (global
                // Receive, dashboard balance click, asset list) don't
                // carry a specific note/script_type. Without one,
                // GET_PUBKEY_CONTEXT falls back to scoped[0] and
                // Receive shows a different address from what the
                // header dropdown displays.
                //
                // Default selection mirrors what the header builders do
                // so all entry points stay in sync:
                //   - BTC: first p2wpkh (buildBtcAccounts marks Native
                //     Segwit as isDefault).
                //   - Other UTXO (LTC, DOGE, DASH, BCH): first scoped
                //     pubkey in chainConfig order — buildUtxoAccounts
                //     uses items.length === 0, so e.g. LTC defaults to
                //     legacy p2pkh (configured before p2wpkh) and we
                //     must NOT silently shift it to native segwit.
                const BTC_GENESIS_PREFIX = 'bip122:000000000019d6689c085ae165831e93';
                if (asset.networkId.startsWith('bip122:') && !asset.note && !asset.script_type) {
                  const scoped = wallet.getPubkeys(asset.networkId);
                  const isBtc = asset.networkId.startsWith(BTC_GENESIS_PREFIX);
                  const preferred = isBtc
                    ? scoped.find((pk: any) => pk.script_type === 'p2wpkh') || scoped[0]
                    : scoped[0];
                  if (preferred) {
                    asset.note = preferred.note;
                    asset.script_type = preferred.script_type;
                  }
                }
              }

              // Enrich asset with cached native balance so Send/Transfer can
              // read a scalar `balance`. GET_ASSETS returns the catalog (no
              // balance), so without this step the Transfer component saw
              // `undefined` and fell back to 0 — Max/50% became no-ops and the
              // "Sending X SOL" hero read 0. Prefer exact caip match, then the
              // native row for the network.
              if (asset.networkId && !asset.balance) {
                const exact = asset.caip && cachedBalances.find((b: any) => b.caip === asset.caip);
                const nativeFallback = cachedBalances.find((b: any) => b.networkId === asset.networkId && b.isNative);
                const match = exact || nativeFallback;
                if (match) {
                  asset.balance = match.balance;
                  if (!asset.priceUsd) asset.priceUsd = match.priceUsd;
                  if (!asset.valueUsd) asset.valueUsd = match.valueUsd;
                  if (!asset.icon && match.icon) asset.icon = match.icon;
                }
              }

              // Update global ADDRESS for EVM signing when account changes
              if (asset.networkId?.startsWith('eip155:') && asset.address) {
                ADDRESS = asset.address;
                console.log(tag, 'Updated global ADDRESS to:', ADDRESS);
              }

              // Store in assetContextStorage for GET_ASSET_CONTEXT
              await assetContextStorage.updateContext(asset);

              // If eip155 then set web3 provider
              if (asset.networkId && asset.networkId.includes('eip155')) {
                // Try to get provider data from custom chains first (user-added networks)
                let providerData = await blockchainDataStorage.getBlockchainData(asset.networkId);

                // Fall through to Pioneer registry if user hasn't added
                // this chain manually. Pioneer is the source of truth for
                // RPC + chain metadata; misses here mean Pioneer doesn't
                // know the chain (rare — its catalog has 196+ EVMs).
                if (!providerData) {
                  const chainInfo = await getChainInfo(asset.networkId);
                  if (chainInfo) {
                    providerData = {
                      chainId: chainInfo.chainId,
                      caip: chainInfo.caip,
                      networkId: chainInfo.networkId,
                      blockExplorerUrls: chainInfo.explorer ? [chainInfo.explorer] : [],
                      name: chainInfo.name,
                      // Carry the explorer tx-link prefix so TxidPage deep-links
                      // the txid (otherwise the success screen shows a bare hash).
                      explorerTxLink: chainInfo.explorerTxLink,
                      providerUrl: chainInfo.rpc,
                      providers: chainInfo.rpcs,
                    };
                  } else {
                    console.error(tag, 'Network not found in custom storage or Pioneer:', asset.networkId);
                  }
                }

                if (providerData) {
                  await web3ProviderStorage.saveWeb3Provider(providerData);
                }
              }

              chrome.runtime
                .sendMessage({
                  type: 'ASSET_CONTEXT_UPDATED',
                  assetContext: asset,
                })
                .catch(() => {});

              sendResponse(asset);
            } catch (error) {
              console.error('Error setting asset context:', error);
              sendResponse({ error: 'Failed to set asset context' });
            }
          } else {
            sendResponse({ error: 'Invalid asset' });
          }
          break;
        }

        case 'GET_PUBKEY_CONTEXT': {
          // Scope to the currently selected asset so Receive shows the correct
          // address. Returning pubkeys[0] unconditionally meant a multi-account
          // or multi-chain wallet would surface account-0 / Bitcoin for every
          // asset switch — a foot-gun serious enough to send funds to the
          // wrong place. Fall back to pubkeys[0] only if no asset context is
          // set (cold-start before any selection).
          try {
            const ctx = await assetContextStorage.get();
            const allPubkeys = wallet.getPubkeys();
            let chosen: any = null;

            if (ctx?.networkId) {
              // EVM addresses are identical across all EVM chains, and accounts
              // 1+ are registered only under eip155:1 (no eip155:* wildcard). A
              // literal getPubkeys(networkId) returns empty on non-mainnet EVM
              // chains, so the accountIndex match below would never run and
              // selection would fall through to allPubkeys[0]. Scope to all EVM
              // pubkeys instead — matches SET_ASSET_CONTEXT enrichment.
              const scoped = ctx.networkId.startsWith('eip155:')
                ? wallet
                    .getPubkeys()
                    .filter((pk: any) => pk.networks?.includes('eip155:1') || pk.networks?.includes('eip155:*'))
                : wallet.getPubkeys(ctx.networkId);
              if (scoped.length > 0) {
                // Match priority: note → script_type → accountIndex →
                // scoped[0]. Note is the only identifier that's unique
                // across every chainConfig path; script_type collapses
                // BTC account 0 / account 1 (both p2wpkh) and would
                // always pick the first one. accountIndex is fine for
                // multi-account EVM but is unset on UTXO header rows.
                const ctxNote = (ctx as any).note;
                const ctxScriptType = (ctx as any).script_type;
                if (ctxNote) {
                  chosen = scoped.find((pk: any) => pk.note === ctxNote);
                }
                if (!chosen && ctxScriptType) {
                  chosen = scoped.find((pk: any) => pk.script_type === ctxScriptType);
                }
                if (!chosen && (ctx as any).accountIndex !== undefined) {
                  chosen = scoped.find((pk: any) => pk.accountIndex === (ctx as any).accountIndex);
                }
                if (!chosen) chosen = scoped[0];
              }
            }

            if (!chosen) chosen = allPubkeys[0] ?? null;
            sendResponse({ pubkeyContext: chosen });
          } catch (e) {
            console.error('GET_PUBKEY_CONTEXT failed:', e);
            const pubkeys = wallet.getPubkeys();
            sendResponse({ pubkeyContext: pubkeys[0] ?? null });
          }
          break;
        }

        case 'SET_PUBKEY_CONTEXT': {
          // Just broadcast the update — no SDK call needed
          const { pubkey } = message;
          try {
            chrome.runtime
              .sendMessage({
                type: 'PUBKEY_CONTEXT_UPDATED',
                pubkeyContext: pubkey,
              })
              .catch(() => {});
            sendResponse({ success: true, pubkeyContext: pubkey });
          } catch (error) {
            console.error('Error setting pubkey context:', error);
            sendResponse({ error: 'Failed to set pubkey context' });
          }
          break;
        }

        case 'GET_PUBKEYS_FOR_NETWORK': {
          const { networkId } = message;
          const pubkeys = wallet.getPubkeys(networkId);
          sendResponse({ pubkeys });
          break;
        }

        // Derive a UTXO receive address locally from the xpub held in the
        // matching pubkey entry. Needed because /api/pubkeys/batch returns
        // UTXO rows with { pubkey: "<xpub>", address: "" } — showing the
        // xpub as an address was the endless-spinner / wrong-address bug on
        // the Receive page. Pubkey-to-address is pure BIP32 + script-type
        // encoding, so no device round-trip is required; this works in
        // view-only mode too. Not cached: derivation is microseconds, and
        // a session-storage cache keyed without the xpub would surface the
        // previous device's address after a hot-swap.
        case 'GET_UTXO_ADDRESS': {
          const { networkId, scriptType, note } = message as {
            networkId: string;
            scriptType?: string;
            note?: string;
          };
          try {
            const scoped = wallet.getPubkeys(networkId);
            if (scoped.length === 0) {
              sendResponse({ error: 'No pubkey for network' });
              break;
            }
            // `note` is unique per path config, so match it first —
            // multiple accounts can share a script_type (e.g. several BTC
            // p2wpkh accounts), and matching by script_type first would
            // always pick the first one regardless of which account the
            // caller asked for. Raw pubkey objects use snake_case
            // `script_type`, matching chainConfig.ts and the SDK request
            // shape; do not rename them here.
            const match =
              (note && scoped.find((pk: any) => pk.note === note)) ||
              (scriptType && scoped.find((pk: any) => pk.script_type === scriptType)) ||
              scoped[0];
            const xpub: string | undefined = match.pubkey || match.master;
            if (!xpub) {
              sendResponse({ error: 'No xpub on pubkey entry' });
              break;
            }
            const address = deriveUtxoAddress({
              xpub,
              scriptType: match.script_type,
              networkId,
            });
            sendResponse({ address, scriptType: match.script_type });
          } catch (e: any) {
            console.error('GET_UTXO_ADDRESS failed:', e);
            sendResponse({ error: e?.message || 'deriveUtxoAddress failed' });
          }
          break;
        }

        case 'ADD_ACCOUNT_PATH': {
          const { path } = message;
          try {
            wallet.addPath(path);
            const pubkeys = await wallet.refreshPubkeys();
            sendResponse({ success: true, pubkeys });
          } catch (error) {
            console.error('Error adding account path:', error);
            sendResponse({ error: 'Failed to add account path' });
          }
          break;
        }

        case 'GET_ETH_ACCOUNTS': {
          try {
            const accounts = await ethAccountsStorage.getAccounts();
            sendResponse({ accounts });
          } catch (error) {
            console.error('Error getting ETH accounts:', error);
            sendResponse({ accounts: [0] });
          }
          break;
        }

        case 'ADD_ETH_ACCOUNT': {
          const { accountIndex } = message;
          try {
            const HARDENED = 0x80000000;
            const accounts = await ethAccountsStorage.addAccount(accountIndex);
            // Build path config for this account and derive on device
            const path = {
              note: `Ethereum account ${accountIndex}`,
              networks: accountIndex === 0 ? ['eip155:1', 'eip155:*'] : ['eip155:1'],
              script_type: 'ethereum',
              type: 'address',
              addressNList:
                accountIndex === 0
                  ? [HARDENED + 44, HARDENED + 60, HARDENED + accountIndex]
                  : [HARDENED + 44, HARDENED + 60, HARDENED + accountIndex, 0, 0],
              addressNListMaster: [HARDENED + 44, HARDENED + 60, HARDENED + accountIndex, 0, 0],
              curve: 'secp256k1',
              showDisplay: false,
              accountIndex,
            };
            wallet.addPath(path);
            const pubkeys = await wallet.refreshPubkeys();
            sendResponse({ success: true, accounts, pubkeys });
          } catch (error) {
            console.error('Error adding ETH account:', error);
            sendResponse({ error: 'Failed to add ETH account' });
          }
          break;
        }

        case 'REMOVE_ETH_ACCOUNT': {
          const { accountIndex: removeIdx } = message;
          try {
            const accounts = await ethAccountsStorage.removeAccount(removeIdx);
            // Without clearing runtime state the signer and pubkey list keep
            // the removed account — the UI shows it gone while the wallet
            // still holds it, and the next request could sign against the
            // supposedly-removed account.
            await wallet.removePathByNote(`Ethereum account ${removeIdx}`);
            sendResponse({ success: true, accounts, pubkeys: wallet.getPubkeys() });
          } catch (error) {
            console.error('Error removing ETH account:', error);
            sendResponse({ error: 'Failed to remove ETH account' });
          }
          break;
        }

        // ---- Multi-account for non-EVM families (UTXO non-BTC, Cosmos, Solana) ----
        // EVM uses ADD_ETH_ACCOUNT above (cross-chain wildcard); these handlers
        // are per-network and keyed by networkId in accountsByNetworkStorage.
        case 'GET_ACCOUNTS_FOR_NETWORK': {
          const { networkId } = message;
          try {
            const accounts = await accountsByNetworkStorage.getAccounts(networkId);
            sendResponse({ accounts });
          } catch (error) {
            console.error('Error getting accounts for network:', error);
            sendResponse({ accounts: [0] });
          }
          break;
        }

        case 'ADD_ACCOUNT': {
          const { networkId, accountIndex } = message;
          try {
            if (!supportsMultiAccount(networkId)) {
              sendResponse({ error: `Network ${networkId} does not support multiple accounts` });
              break;
            }
            const accounts = await accountsByNetworkStorage.addAccount(networkId, accountIndex);
            if (networkId === SOLANA_NETWORK_ID) {
              // Solana derives outside the batch xpub flow (device call).
              await deriveSolanaAccount(accountIndex);
            } else {
              // UTXO / Cosmos: clone account-0 template(s), add to the batch, re-derive.
              const paths = buildAccountPaths(networkId, accountIndex);
              if (paths.length === 0) {
                sendResponse({ error: `No path template for ${networkId}` });
                break;
              }
              for (const p of paths) wallet.addPath(p);
              await wallet.refreshPubkeys();
            }
            sendResponse({ success: true, accounts, pubkeys: wallet.getPubkeys() });
          } catch (error) {
            console.error('Error adding account:', error);
            sendResponse({ error: `Failed to add account: ${(error as Error)?.message || error}` });
          }
          break;
        }

        case 'REMOVE_ACCOUNT': {
          const { networkId, accountIndex: removeIdx } = message;
          try {
            const accounts = await accountsByNetworkStorage.removeAccount(networkId, removeIdx);
            if (networkId === SOLANA_NETWORK_ID) {
              await wallet.removePathByNote(`Solana account ${removeIdx}`);
            } else {
              // Regenerate the same notes deterministically to clear every
              // script-type path this account produced.
              for (const p of buildAccountPaths(networkId, removeIdx)) {
                await wallet.removePathByNote(p.note);
              }
            }
            sendResponse({ success: true, accounts, pubkeys: wallet.getPubkeys() });
          } catch (error) {
            console.error('Error removing account:', error);
            sendResponse({ error: 'Failed to remove account' });
          }
          break;
        }

        case 'GET_CUSTOM_EVM_NETWORKS': {
          try {
            const networks = await customEvmNetworksStorage.getNetworks();
            sendResponse({ networks });
          } catch (error) {
            console.error('Error getting custom EVM networks:', error);
            sendResponse({ networks: [] });
          }
          break;
        }

        case 'ADD_CUSTOM_EVM_NETWORK': {
          const { network } = message;
          try {
            const networks = await customEvmNetworksStorage.addNetwork(network);
            // Mirror into the storages the SET_ASSET_CONTEXT handler reads
            // for provider config. Without this, the header dropdown renders
            // the new network (from customEvmNetworksStorage) but selecting
            // it falls through to the Pioneer registry, which won't have
            // the user's custom RPC URL — only the chain's public ones.
            // Persisting here keeps the user's overrides authoritative.
            const cleanRpc = (network.rpc || '').trim();
            const cleanExplorer = (network.explorerUrl || '').trim();
            const chainIdHex = '0x' + Number(network.chainId).toString(16);
            await blockchainDataStorage.addBlockchainData(network.networkId, {
              chainId: chainIdHex,
              caip: `${network.networkId}/slip44:60`,
              name: network.name,
              symbol: network.symbol,
              explorer: cleanExplorer,
              explorerAddressLink: cleanExplorer ? `${cleanExplorer}/address/` : '',
              explorerTxLink: cleanExplorer ? `${cleanExplorer}/tx/` : '',
              blockExplorerUrls: cleanExplorer ? [cleanExplorer] : [],
              providerUrl: cleanRpc,
              providers: cleanRpc ? [cleanRpc] : [],
              nativeCurrency: { name: network.symbol, symbol: network.symbol, decimals: 18 },
              type: 'evm',
            } as any);
            await blockchainStorage.addBlockchain(network.networkId);
            sendResponse({ success: true, networks });
          } catch (error) {
            console.error('Error adding custom EVM network:', error);
            sendResponse({ error: 'Failed to add custom EVM network' });
          }
          break;
        }

        case 'REMOVE_CUSTOM_EVM_NETWORK': {
          const { networkId: removeNetId } = message;
          try {
            const networks = await customEvmNetworksStorage.removeNetwork(removeNetId);
            await blockchainStorage.removeBlockchain(removeNetId);
            // blockchainDataStorage has no remove API; drop the key via the
            // raw set helper so we don't leave an orphaned provider entry.
            await blockchainDataStorage.set((prev: any) => {
              if (!prev || !(removeNetId in prev)) return prev || {};
              const next = { ...prev };
              delete next[removeNetId];
              return next;
            });
            // If the removed network was actively selected, the asset
            // context and web3 provider still point at it — the signer
            // would keep using a chain the user just deleted. Clear both
            // and tell the sidebar so it can drop its drawer / header
            // selection.
            const currentCtx = await assetContextStorage.get().catch(() => null);
            const currentProvider = await web3ProviderStorage.getWeb3Provider().catch(() => null);
            if ((currentCtx as any)?.networkId === removeNetId) {
              await assetContextStorage.clearContext().catch(() => {});
              chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_CLEARED' }).catch(() => {});
            }
            if ((currentProvider as any)?.networkId === removeNetId) {
              await web3ProviderStorage.clearWeb3Provider().catch(() => {});
            }
            sendResponse({ success: true, networks });
          } catch (error) {
            console.error('Error removing custom EVM network:', error);
            sendResponse({ error: 'Failed to remove custom EVM network' });
          }
          break;
        }

        case 'GET_TESTNETS_ENABLED': {
          try {
            const enabled = await testnetSettingsStorage.getShowTestnets();
            sendResponse({ enabled });
          } catch (error) {
            sendResponse({ enabled: false });
          }
          break;
        }

        case 'SET_TESTNETS_ENABLED': {
          const enabled = !!message.enabled;
          try {
            await testnetSettingsStorage.setShowTestnets(enabled);

            if (enabled) {
              // EVM testnets: register exactly like a user-added custom
              // network so the header dropdown + balance enrichment +
              // rpcFailover all pick them up. providers[] carries every
              // public RPC so failover has fallbacks.
              for (const t of EVM_TESTNETS) {
                await customEvmNetworksStorage.addNetwork({
                  networkId: t.networkId,
                  chainId: t.chainId,
                  name: t.name,
                  rpc: t.rpcs[0],
                  symbol: t.symbol,
                  explorerUrl: t.explorerUrl,
                });
                await blockchainDataStorage.addBlockchainData(t.networkId, {
                  chainId: '0x' + t.chainId.toString(16),
                  caip: `${t.networkId}/slip44:60`,
                  name: t.name,
                  symbol: t.symbol,
                  explorer: t.explorerUrl,
                  explorerAddressLink: `${t.explorerUrl}/address/`,
                  explorerTxLink: `${t.explorerUrl}/tx/`,
                  blockExplorerUrls: [t.explorerUrl],
                  providerUrl: t.rpcs[0],
                  providers: t.rpcs,
                  nativeCurrency: { name: t.symbol, symbol: t.symbol, decimals: 18 },
                  type: 'evm',
                  isTestnet: true,
                } as any);
                await blockchainStorage.addBlockchain(t.networkId);
              }
              // Solana devnet: register in the chain storages. RPC routing
              // is handled by solanaHandler when this network is selected.
              await blockchainDataStorage.addBlockchainData(SOLANA_DEVNET.networkId, {
                caip: SOLANA_DEVNET.caip,
                name: SOLANA_DEVNET.name,
                symbol: SOLANA_DEVNET.symbol,
                explorer: SOLANA_DEVNET.explorerUrl,
                providerUrl: SOLANA_DEVNET.rpcs[0],
                providers: SOLANA_DEVNET.rpcs,
                nativeCurrency: { name: SOLANA_DEVNET.symbol, symbol: SOLANA_DEVNET.symbol, decimals: 9 },
                type: 'solana',
                isTestnet: true,
              } as any);
              await blockchainStorage.addBlockchain(SOLANA_DEVNET.networkId);
            } else {
              const ids = [...EVM_TESTNETS.map(t => t.networkId), SOLANA_DEVNET.networkId];
              for (const id of ids) {
                await customEvmNetworksStorage.removeNetwork(id).catch(() => {});
                await blockchainStorage.removeBlockchain(id);
                await blockchainDataStorage.set((prev: any) => {
                  if (!prev || !(id in prev)) return prev || {};
                  const next = { ...prev };
                  delete next[id];
                  return next;
                });
                // Drop asset context if it points at a removed testnet.
                const currentCtx = await assetContextStorage.get().catch(() => null);
                if ((currentCtx as any)?.networkId === id) {
                  await assetContextStorage.clearContext().catch(() => {});
                  chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_CLEARED' }).catch(() => {});
                }
              }
            }

            const networks = await customEvmNetworksStorage.getNetworks();
            sendResponse({ success: true, enabled, networks });
          } catch (error) {
            console.error('Error toggling testnets:', error);
            sendResponse({ error: 'Failed to toggle testnets' });
          }
          break;
        }

        case 'GET_TX_HISTORY': {
          // TX history API disabled for now
          sendResponse({ txs: [] });
          break;
        }

        case 'GET_DAPPS_BY_NETWORKID': {
          // Dapps discovery disabled for now
          sendResponse({ dapps: [] });
          break;
        }

        case 'DISCOVERY_DAPP': {
          // Dapps discovery disabled for now
          sendResponse({ success: false, error: 'Dapps discovery disabled' });
          break;
        }

        case 'GET_ASSET_BALANCE': {
          try {
            console.log(tag, 'GET_ASSET_BALANCE');
            const { networkId } = message;

            if (!ADDRESS) {
              sendResponse('0');
              break;
            }
            // Fail over across user-override → Pioneer → last-resort if
            // any candidate rate-limits or 5xx's.
            const balance = await withRpcFailoverByNetworkId(networkId, p => p.getBalance(ADDRESS));
            sendResponse('0x' + balance.toString(16));
          } catch (error) {
            console.error('Error fetching balance:', error);
            sendResponse({ error: 'Failed to fetch balance' });
          }
          break;
        }

        case 'GET_ASSETS_INFO': {
          try {
            const { networkId } = message;
            const chainId = networkId.replace('eip155:', '');
            const data = await fetchJsonWithTimeout<any>(
              `${PIONEER_API}/api/v1/nodes?chainId=${encodeURIComponent(chainId)}`,
              {},
              { timeoutMs: 5000, retries: 1 },
            );
            sendResponse(data);
          } catch (error) {
            console.error('Error fetching asset info:', error);
            sendResponse({ error: 'Failed to fetch asset info' });
          }
          break;
        }

        case 'GET_ASSETS': {
          // Return available chain assets from static config + custom-added chains
          try {
            const assetMap = new Map<string, any>();

            // Static chains
            for (const [symbol, networkId] of Object.entries(ChainToNetworkId)) {
              const name = COIN_MAP_LONG[symbol] || symbol.toLowerCase();
              const caip = shortListSymbolToCaip[symbol] || networkId;
              assetMap.set(networkId, {
                symbol,
                networkId,
                name: name.charAt(0).toUpperCase() + name.slice(1),
                caip,
                icon: `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png`,
                chain: symbol,
              });
            }

            // Custom chains from storage (dApp-added via wallet_addEthereumChain)
            const savedChains = await blockchainStorage.getAllBlockchains();
            for (const networkId of savedChains || []) {
              if (assetMap.has(networkId)) continue;
              const data = await blockchainDataStorage.getBlockchainData(networkId);
              if (data) {
                const caip = data.caip || `${networkId}/slip44:60`;
                assetMap.set(networkId, {
                  symbol: data.symbol || data.nativeCurrency?.symbol || '',
                  networkId,
                  name: data.name || networkId,
                  caip,
                  icon: data.icon || `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png`,
                  chain: data.symbol || '',
                });
              }
            }

            sendResponse({ assets: Array.from(assetMap.values()) });
          } catch (error) {
            console.error('Error fetching assets:', error);
            sendResponse({ error: 'Failed to fetch assets' });
          }
          break;
        }

        case 'GET_APP_PUBKEYS': {
          sendResponse({ balances: wallet.getPubkeys() });
          break;
        }

        case 'GET_APP_BALANCES': {
          try {
            await portfolioHydrated;
            // Drop a hydrated last-good cache that belongs to a different wallet
            // (different device, or a different passphrase on the same device)
            // once the connected wallet's pubkeys are known.
            if (cacheFromHydrate && wallet.isInitialized() && walletFingerprint() !== hydratedFingerprint) {
              // Drop a hydrated cache that doesn't match the connected wallet —
              // including a legacy entry with no fingerprint (untrusted).
              cachedBalances = [];
              hiddenBalances = [];
              cacheFromHydrate = false;
              hydratedFingerprint = null;
              lastFetchError = null;
            }
            if (cachedBalances.length > 0) {
              // Backstop for the "empty tokens until manual Refresh" bug: a
              // non-empty cache that holds only natives (no token rows) means
              // token discovery hasn't run for this worker yet.
              //
              // `discovering` reports that a discovery is warranted REGARDLESS of
              // whether one is already in flight — so a page opened during the
              // cold-start / post-prefetch force refresh shows "Discovering…"
              // instead of a premature "No Tokens Found". We only START a new
              // force-refresh when one isn't already running, and stop entirely
              // once a discovery has committed (tokenDiscoveryDone).
              const discovering = !tokenDiscoveryDone && !cachedBalances.some((b: any) => b.token === true);
              sendResponse({
                balances: cachedBalances,
                discovering,
                updatedAt: portfolioUpdatedAt,
                error: lastFetchError || undefined,
              });
              if (discovering && !balancesFetchInProgress) {
                fetchBalancesFromPioneer(true).catch(e => console.warn(tag, 'auto token-discovery failed:', e));
              }
            } else if (wallet.isInitialized()) {
              // Empty cache (fresh worker): force-refresh so the first read
              // discovers tokens too, not just native balances.
              const balances = await fetchBalancesFromPioneer(true);
              sendResponse({ balances, error: balances.length === 0 ? lastFetchError || undefined : undefined });
            } else {
              sendResponse({ balances: [] });
            }
          } catch (error: any) {
            console.error(tag, 'GET_APP_BALANCES error:', error);
            sendResponse({ balances: cachedBalances });
          }
          break;
        }

        case 'REFRESH_ALL_BALANCES': {
          try {
            if (!wallet.isInitialized()) {
              sendResponse({ balances: [], error: 'Wallet not initialized' });
              break;
            }
            const balances = await fetchBalancesFromPioneer(true);
            sendResponse({ balances, error: balances.length === 0 ? lastFetchError || undefined : undefined });
          } catch (error: any) {
            console.error(tag, 'REFRESH_ALL_BALANCES error:', error);
            sendResponse({ balances: cachedBalances, error: error.message });
          }
          break;
        }

        case 'GET_HIDDEN_TOKENS': {
          // Tokens suppressed by default or user-hidden — for the recoverable
          // "Hidden" section in Tokens.tsx. Optional networkId filter.
          const netFilter = message?.networkId;
          const rows = netFilter ? hiddenBalances.filter((b: any) => b.networkId === netFilter) : hiddenBalances;
          sendResponse({ hidden: rows });
          break;
        }

        case 'SET_TOKEN_VISIBILITY': {
          // Per-token user override (spamFilter tier-0): permanently hide a scam
          // token (e.g. a fabricated-value 'Mortal') or re-show a false positive.
          try {
            const { caip, status } = message as { caip?: string; status?: 'visible' | 'hidden' };
            if (!caip || (status !== 'visible' && status !== 'hidden')) {
              sendResponse({ success: false, error: 'caip and status (visible|hidden) required' });
              break;
            }
            await setTokenVisibility(caip, status);
            // Apply the override to the in-memory set DETERMINISTICALLY (no network):
            // re-partition + persist + push, so the change is durable immediately
            // and survives a failed refetch / worker restart.
            await reconcileVisibility();
            sendResponse({ success: true });
            // Freshness only — the override is already applied + persisted above.
            fetchBalancesFromPioneer(true).catch(e => console.warn(tag, 'visibility refresh failed:', e));
          } catch (error: any) {
            console.error(tag, 'SET_TOKEN_VISIBILITY error:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        }

        case 'GET_EVM_BALANCE': {
          // Fetch fresh native balance for a specific address on any EVM chain via RPC
          const { networkId: evmNetworkId, address: evmAddress } = message;
          try {
            if (!evmNetworkId?.startsWith('eip155:') || !evmAddress) {
              sendResponse({ balance: '0', valueUsd: '0', error: 'Invalid params' });
              break;
            }

            // Resolve display metadata. The actual RPC call goes through
            // withRpcFailoverByNetworkId below, which iterates the same
            // priority list (custom → Pioneer → last-resort) on transient
            // failure. If neither custom nor Pioneer knows the chain, the
            // failover helper itself throws — caught and surfaced.
            let chainName = evmNetworkId;
            let chainSymbol = 'ETH';
            const customChain = await blockchainDataStorage.getBlockchainData(evmNetworkId);
            if (customChain) {
              chainName = customChain.name || evmNetworkId;
              chainSymbol = customChain.nativeCurrency?.symbol || customChain.symbol || 'ETH';
            } else {
              const pioneerChain = await getChainInfo(evmNetworkId);
              if (pioneerChain) {
                chainName = pioneerChain.name;
                chainSymbol = pioneerChain.symbol || 'ETH';
              }
            }

            const rawBal = await withRpcFailoverByNetworkId(evmNetworkId, p => p.getBalance(evmAddress), {
              timeoutMs: 8000,
            });
            const balStr = formatEther(rawBal);

            // Try to get USD price from cached balances for this network
            let nativeCached = cachedBalances.find((b: any) => b.networkId === evmNetworkId && b.isNative);
            // Fallback: L2 chains (Base, Arbitrum, Optimism, etc.) use ETH as native gas —
            // if no cached price for this specific chain, use Ethereum mainnet ETH price.
            // NOT for testnets — faucet ETH is worthless (and this value is now
            // written back into the cached/persisted row by the reconcile block below).
            if (
              !nativeCached?.priceUsd &&
              evmNetworkId !== 'eip155:1' &&
              !ALL_TESTNET_NETWORK_IDS.includes(evmNetworkId)
            ) {
              nativeCached = cachedBalances.find((b: any) => b.networkId === 'eip155:1' && b.isNative) || nativeCached;
            }
            const priceUsd = parseFloat(nativeCached?.priceUsd || '0');
            const valueUsd = (parseFloat(balStr) * priceUsd).toString();

            // Reconcile: write the fresh live balance back into the matching
            // cached native row keyed by BOTH networkId AND address. Native rows
            // are per-account, so matching on address never clobbers another
            // account's row; the dashboard's per-network SUM stays correct and now
            // reflects the fresh value. Skip when no row matches (don't synthesize
            // a row the portfolio fan-out didn't produce — would double-count).
            const liveRow = cachedBalances.find(
              (b: any) =>
                b.isNative &&
                b.networkId === evmNetworkId &&
                String(b.address || '').toLowerCase() === evmAddress.toLowerCase(),
            );
            if (liveRow) {
              liveRow.balance = balStr;
              liveRow.priceUsd = priceUsd.toString();
              liveRow.valueUsd = valueUsd;
              delete liveRow.priceUnavailable;
              persistPortfolio(cachedBalances);
              pushBalancesUpdated();
            }

            sendResponse({
              balance: balStr,
              valueUsd,
              priceUsd: priceUsd.toString(),
              symbol: nativeCached?.symbol || chainSymbol,
              name: nativeCached?.name || chainName,
            });
          } catch (error: any) {
            console.error(tag, 'GET_EVM_BALANCE error:', error.message);
            sendResponse({ balance: '0', valueUsd: '0', error: error.message });
          }
          break;
        }

        case 'GET_CHARTS': {
          try {
            const { networkIds } = message;
            let balances = cachedBalances;
            if (balances.length === 0 && wallet.isInitialized()) {
              balances = await fetchBalancesFromPioneer();
            }
            // Honor the networkIds filter the UI hooks send. Previously this
            // parameter was ignored and "discover tokens for this network"
            // returned the global set, making stale/unrelated balances leak
            // into single-network views.
            if (Array.isArray(networkIds) && networkIds.length > 0) {
              const allow = new Set<string>(networkIds);
              balances = balances.filter((b: any) => allow.has(b.networkId));
            }
            const totalValueUsd = balances.reduce((sum: number, b: any) => sum + parseFloat(b.valueUsd || '0'), 0);
            sendResponse({
              success: true,
              balances,
              dashboard: { totalValueUsd },
            });
          } catch (error: any) {
            console.error(tag, 'GET_CHARTS error:', error);
            sendResponse({ success: false, balances: cachedBalances, error: error.message });
          }
          break;
        }

        case 'LOOKUP_TOKEN_METADATA': {
          try {
            const { networkId, contractAddress, userAddress } = message;
            if (!networkId || !contractAddress) {
              throw new Error('networkId and contractAddress are required');
            }

            const payload: any = { networkId, contractAddress };
            if (userAddress) payload.userAddress = userAddress;

            const data = await fetchJsonWithTimeout<any>(
              `${PIONEER_API}/api/v1/tokens/metadata`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              },
              { timeoutMs: 8000, retries: 1 },
            );
            sendResponse({ success: true, data });
          } catch (error: any) {
            console.error('Error looking up token metadata:', error);
            sendResponse({ success: false, error: error.message || 'Failed to lookup token metadata' });
          }
          break;
        }

        case 'ADD_CUSTOM_TOKEN': {
          try {
            const { userAddress, token } = message;
            if (!userAddress || !token) {
              throw new Error('userAddress and token are required');
            }

            const data = await fetchJsonWithTimeout<any>(
              `${PIONEER_API}/api/v1/tokens/custom`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userAddress,
                  token: {
                    networkId: token.networkId,
                    address: token.address,
                    caip: token.caip,
                    name: token.name,
                    symbol: token.symbol,
                    decimals: token.decimals,
                    icon: token.icon,
                    coingeckoId: token.coingeckoId,
                  },
                }),
              },
              { timeoutMs: 8000, retries: 1 },
            );
            sendResponse({ success: data?.success || false, data });
          } catch (error: any) {
            console.error('Error adding custom token:', error);
            sendResponse({ success: false, error: error.message || 'Failed to add custom token' });
          }
          break;
        }

        case 'GET_CUSTOM_TOKENS': {
          try {
            const { userAddress, networkId } = message;
            if (!userAddress) {
              throw new Error('userAddress is required');
            }

            let url = `${PIONEER_API}/api/v1/tokens/custom?userAddress=${encodeURIComponent(userAddress)}`;
            if (networkId) url += `&networkId=${encodeURIComponent(networkId)}`;

            const data = await fetchJsonWithTimeout<any>(url, {}, { timeoutMs: 8000, retries: 1 });
            const tokens = data?.data?.tokens || data?.tokens || [];
            sendResponse({ success: true, tokens });
          } catch (error: any) {
            console.error('Error getting custom tokens:', error);
            sendResponse({ success: false, error: error.message, tokens: [] });
          }
          break;
        }

        case 'GET_CUSTOM_TOKEN_BALANCES': {
          try {
            const { networkId, address } = message;
            if (!networkId || !address) {
              throw new Error('networkId and address are required');
            }

            const data = await fetchJsonWithTimeout<any>(
              `${PIONEER_API}/api/v1/tokens/balances?networkId=${encodeURIComponent(networkId)}&address=${encodeURIComponent(address)}`,
              {},
              { timeoutMs: 8000, retries: 1 },
            );
            const tokens = data?.data?.tokens || data?.tokens || [];
            sendResponse({ success: true, tokens });
          } catch (error: any) {
            console.error('Error getting custom token balances:', error);
            sendResponse({ success: false, error: error.message, tokens: [] });
          }
          break;
        }

        case 'REMOVE_CUSTOM_TOKEN': {
          try {
            const { userAddress, networkId, tokenAddress } = message;
            if (!userAddress || !networkId || !tokenAddress) {
              throw new Error('userAddress, networkId, and tokenAddress are required');
            }

            const data = await fetchJsonWithTimeout<any>(
              `${PIONEER_API}/api/v1/tokens/custom`,
              {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userAddress, networkId, tokenAddress }),
              },
              { timeoutMs: 8000, retries: 1 },
            );
            sendResponse({ success: data?.success || false, data });
          } catch (error: any) {
            console.error('Error removing custom token:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        }

        case 'VALIDATE_ERC20_TOKEN': {
          try {
            const { contractAddress, networkId } = message;

            if (!contractAddress) {
              sendResponse({ valid: false, error: 'Contract address is required' });
              break;
            }

            if (!networkId) {
              sendResponse({ valid: false, error: 'Network ID is required' });
              break;
            }

            // ERC-20 ABI for name, symbol, and decimals
            const ERC20_ABI = [
              'function name() view returns (string)',
              'function symbol() view returns (string)',
              'function decimals() view returns (uint8)',
            ];

            const { Contract } = await import('ethers');

            // Run all three reads against the same provider per failover
            // attempt — splitting them across providers would risk a
            // partial result if one URL rate-limits mid-validation.
            // ERC20 reads are read-only views; if they fail, the next
            // candidate URL gets the whole bundle.
            const { name, symbol, decimals } = await withRpcFailoverByNetworkId(
              networkId,
              async rpcProvider => {
                const tokenContract = new Contract(contractAddress, ERC20_ABI, rpcProvider);
                const [n, s, d] = await Promise.all([
                  tokenContract.name(),
                  tokenContract.symbol(),
                  tokenContract.decimals(),
                ]);
                return { name: n, symbol: s, decimals: d };
              },
              { timeoutMs: 8000 },
            );

            const caip = `${networkId}/erc20:${contractAddress.toLowerCase()}`;

            const tokenData = {
              address: contractAddress,
              symbol,
              name,
              decimals: Number(decimals),
              caip,
              networkId,
            };

            console.log(tag, 'Token validated successfully:', tokenData);
            sendResponse({ valid: true, token: tokenData });
          } catch (error: any) {
            console.error(tag, 'Error validating ERC-20 token:', error);
            sendResponse({
              valid: false,
              error: error.message || 'Failed to validate token. Make sure it is a valid ERC-20 contract.',
            });
          }
          break;
        }

        case 'INJECTION_SUCCESS': {
          console.log(tag, 'Injection successful:', message.url);
          sendResponse({ success: true });
          break;
        }

        case 'CLEAR_APPROVAL_BADGE': {
          // Sent from info-only side-panel surfaces (e.g. chain-not-enabled
          // card) that bypass the requireApproval flow. The standard
          // approval path manages its own badge in popup.ts; this lets
          // out-of-band cards clean up after themselves.
          setApprovalBadge(false);
          sendResponse({ success: true });
          break;
        }

        case 'GET_CACHED_PUBKEYS_STATUS': {
          const { pubkeyStorage } = await import('@extension/storage');
          try {
            const [hasCached, deviceInfo, cacheEnabled] = await Promise.all([
              pubkeyStorage.hasStoredPubkeys(),
              pubkeyStorage.getDeviceInfo(),
              pubkeyStorage.isCacheEnabled(),
            ]);

            sendResponse({
              hasCached,
              deviceInfo,
              cacheEnabled,
              isViewOnlyMode: hasCached && !wallet.isInitialized(),
            });
          } catch (error) {
            sendResponse({ error: 'Failed to get cache status' });
          }
          break;
        }

        case 'CLEAR_CACHED_PUBKEYS': {
          const { pubkeyStorage } = await import('@extension/storage');
          try {
            const success = await pubkeyStorage.clearPubkeys();
            sendResponse({ success });
          } catch (error) {
            sendResponse({ error: 'Failed to clear cache' });
          }
          break;
        }

        case 'SET_CACHE_ENABLED': {
          const { pubkeyStorage } = await import('@extension/storage');
          const { enabled } = message;
          try {
            const success = await pubkeyStorage.setCacheEnabled(enabled);
            sendResponse({ success, enabled });
          } catch (error) {
            sendResponse({ error: 'Failed to update cache setting' });
          }
          break;
        }

        case 'SWAP_REQUEST': {
          // Native side-panel swap → vault headless swap REST (see swapHandler.ts).
          sendResponse(await handleSwapMessage(message, cachedBalances));
          break;
        }

        case 'SWAP_WATCH': {
          // Accelerator: open Pioneer's SSE feed on the swap's from/to addresses.
          // A `tx:incoming` on the destination nudges the side panel to refresh
          // immediately. The vault tracker poll stays the source of truth.
          try {
            const from = resolveAddress(message.fromCaip, cachedBalances);
            const to = resolveAddress(message.toCaip, cachedBalances);
            const entries = [
              to ? { address: to, networkId: String(message.toCaip).split('/')[0] } : null,
              from ? { address: from, networkId: String(message.fromCaip).split('/')[0] } : null,
            ].filter(Boolean) as { address: string; networkId: string }[];
            startSwapEventStream(entries, event => {
              try {
                chrome.runtime.sendMessage({ type: 'SWAP_EVENT', txid: message.txid, event });
              } catch {
                /* no listener (panel closed) — harmless */
              }
            });
            sendResponse({ ok: true, watching: entries.length });
          } catch (error: any) {
            sendResponse({ ok: false, error: error?.message || String(error) });
          }
          break;
        }

        case 'SWAP_UNWATCH': {
          stopSwapEventStream();
          sendResponse({ ok: true });
          break;
        }

        default:
          // Handle action-based messages (like eth_sign_response) that are handled by other listeners
          if (message.action) {
            sendResponse({ success: true });
          } else {
            console.error('Unknown message:', message);
            sendResponse({ error: 'Unknown message type: ' + message.type });
          }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    }
  })();

  // Return true to indicate that the response will be sent asynchronously
  return true;
});

exampleSidebarStorage
  .get()
  .then(openSidebar => {
    chrome.action.onClicked.addListener((tab: any) => {
      if (openSidebar === true) {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          chrome.sidePanel.open({ tabId: tab.id, windowId: tab.windowId }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error opening side panel:', chrome.runtime.lastError);
            }
          });
        });
      }
    });
  })
  .catch(error => {
    console.error('Error fetching sidebar storage:', error);
  });

// Masking settings are read directly by the content script from
// chrome.storage.local before injection; there's no background handler
// for them.
