import 'webextension-polyfill';
// Process polyfill for browser environment
import '../polyfills/process';
// Buffer polyfill for browser environment
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import packageJson from '../../package.json';
import * as wallet from './wallet';
import { resetSolanaState } from './chains/solanaHandler';
import { handleWalletRequest } from './methods';
import { JsonRpcProvider, formatEther } from 'ethers';
import { ChainToNetworkId, Chain, COIN_MAP_LONG, shortListSymbolToCaip, NetworkIdToChain } from './chainConfig';
import {
  requestStorage,
  exampleSidebarStorage,
  web3ProviderStorage,
  blockchainDataStorage,
  blockchainStorage,
  assetContextStorage,
  ethAccountsStorage,
  customEvmNetworksStorage,
} from '@extension/storage';
import { EIP155_CHAINS } from './chains';
import { formatUserError } from './utils';

const TAG = ' | background/index.js | ';
console.log('Background script loaded');
console.log('Version:', packageJson.version);

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

function updateIcon() {
  let iconPath = './icon-128.png';
  // Show green/online icon when connected (state 2) or paired (state 5)
  if (KEEPKEY_STATE === 2 || KEEPKEY_STATE === 5) iconPath = './icon-128-online.png';

  chrome.action.setIcon({ path: iconPath }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting icon:', chrome.runtime.lastError);
    }
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

async function checkKeepKey() {
  const prevState = KEEPKEY_STATE;
  try {
    const response = await fetch('http://localhost:1646/docs');
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
        onStart();
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
    }
    KEEPKEY_STATE = 4; // Set state to errored
    updateIcon();
    if (KEEPKEY_STATE !== prevState) pushStateChangeEvent();
  }
}

// Call checkKeepKey every 5 seconds
setInterval(checkKeepKey, 5000);

updateIcon();
console.log('Background loaded');

const provider = new JsonRpcProvider(EIP155_CHAINS['eip155:1'].rpc);

let ADDRESS = '';

// ---- Balance fetching via Pioneer API ----
let cachedBalances: any[] = [];
let balancesFetchInProgress: Promise<any[]> | null = null;

// All EVM CAPIPs (deduplicated) — used to fan out EVM wildcard addresses
const EVM_CAIPS = [...new Set(Object.values(shortListSymbolToCaip).filter(caip => caip.startsWith('eip155:')))];

async function fetchBalancesFromPioneer(forceRefresh = false): Promise<any[]> {
  // Deduplicate concurrent calls — but honor forceRefresh
  if (balancesFetchInProgress && !forceRefresh) return balancesFetchInProgress;

  const thisPromise: Promise<any[]> = (async () => {
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

      // Use /api/v1/charts/portfolio endpoint — blocking, includes Zapper/Unchained token fetch
      const portfolioUrl = `${PIONEER_API}/api/v1/charts/portfolio`;

      // Split into address-based (EVM, Cosmos, etc.) and xpub-based (UTXO) batches
      // to prevent a bad xpub from poisoning the entire request
      const addressPubkeys = pioneerPubkeys.filter(
        p => !p.pubkey.startsWith('xpub') && !p.pubkey.startsWith('zpub') && !p.pubkey.startsWith('ypub'),
      );
      const xpubPubkeys = pioneerPubkeys.filter(
        p => p.pubkey.startsWith('xpub') || p.pubkey.startsWith('zpub') || p.pubkey.startsWith('ypub'),
      );

      const fetchBatch = async (batch: typeof pioneerPubkeys, label: string) => {
        if (batch.length === 0) return { balances: [] as any[], tokens: [] as any[] };
        try {
          const response = await fetch(portfolioUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pubkeys: batch, forceRefresh }),
          });
          if (!response.ok) {
            console.warn(`[fetchBalances] ${label} batch returned ${response.status}`);
            return { balances: [] as any[], tokens: [] as any[] };
          }
          const json = await response.json();
          const data = json?.data || {};
          console.log(
            `[fetchBalances] ${label} batch: ${data.balances?.length || 0} balances, ${data.tokens?.length || 0} tokens`,
          );
          return { balances: data.balances || [], tokens: data.tokens || [] };
        } catch (e: any) {
          console.warn(`[fetchBalances] ${label} batch error:`, e.message);
          return { balances: [] as any[], tokens: [] as any[] };
        }
      };

      // Fetch both batches in parallel
      const [addressResult, xpubResult] = await Promise.all([
        fetchBatch(addressPubkeys, 'address'),
        fetchBatch(xpubPubkeys, 'xpub'),
      ]);

      const rawBalances: any[] = [...addressResult.balances, ...xpubResult.balances];
      const rawTokens: any[] = [...addressResult.tokens, ...xpubResult.tokens];

      if (rawBalances.length === 0 && rawTokens.length === 0) {
        console.warn('[fetchBalances] Pioneer returned 0 balances for', pioneerPubkeys.length, 'pubkeys');
        return cachedBalances;
      }

      // Transform native balances
      const balances: any[] = rawBalances.map((b: any) => {
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

      // Add token balances (ERC-20s etc.)
      // /charts/portfolio returns tokens in nested format:
      //   { assetCaip, networkId, pubkey, token: { symbol, name, balance, price, balanceUSD, icon, decimal } }
      // OR flat format from /charts: { caip, symbol, balance, ... }
      for (const t of rawTokens) {
        const isNested = t.token && typeof t.token === 'object';
        const tok = isNested ? t.token : t;
        const caip = t.assetCaip || t.caip || '';
        const networkId = t.networkId || caip.split('/')[0] || '';
        const contractMatch = caip.match(/\/erc20:(0x[a-fA-F0-9]+)/);
        balances.push({
          networkId,
          caip,
          symbol: tok.symbol || tok.ticker || '',
          name: tok.name || tok.symbol || '',
          balance: String(tok.balance ?? '0'),
          valueUsd: String(isNested ? (tok.balanceUSD ?? '0') : (tok.valueUsd ?? '0')),
          priceUsd: String(isNested ? (tok.price ?? '0') : (tok.priceUsd ?? '0')),
          icon:
            tok.icon ||
            tok.image ||
            (caip ? `https://api.keepkey.info/coins/${btoa(caip).replace(/=+$/, '')}.png` : ''),
          decimals: tok.decimal || tok.decimals,
          isNative: false,
          token: true,
          address: t.pubkey || t.address || '',
          contractAddress: contractMatch ? contractMatch[1] : tok.contractAddress || tok.contract || '',
        });
      }

      // Enrich with direct RPC balances for custom EVM chains Pioneer doesn't know about
      try {
        const savedChains = await blockchainStorage.getAllBlockchains();
        const coveredNetworks = new Set(balances.filter((b: any) => b.isNative).map((b: any) => b.networkId));
        const evmAddress = allPubkeys.find((pk: any) => pk.networks?.includes('eip155:*'))?.address;

        if (evmAddress) {
          for (const networkId of savedChains) {
            if (coveredNetworks.has(networkId)) continue;
            if (!networkId.startsWith('eip155:')) continue;

            const chainData = await blockchainDataStorage.getBlockchainData(networkId);
            if (!chainData?.providerUrl) continue;

            try {
              const rpcProvider = new JsonRpcProvider(chainData.providerUrl);
              const rawBal = await Promise.race([
                rpcProvider.getBalance(evmAddress),
                new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
              ]);
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
        }
      } catch (e: any) {
        console.warn('[fetchBalances] Custom chain enrichment error:', e.message);
      }

      cachedBalances = balances;
      console.log(
        `[fetchBalances] Got ${balances.length} balance entries (${balances.filter((b: any) => b.isNative).length} native, ${balances.filter((b: any) => !b.isNative).length} tokens)`,
      );
      return balances;
    } catch (e: any) {
      console.error('[fetchBalances] Error:', e.message || e);
      return cachedBalances;
    } finally {
      // Only clear the in-flight ref if it still points to this promise — a newer
      // forceRefresh call may have replaced it while we were running.
      if (balancesFetchInProgress === thisPromise) {
        balancesFetchInProgress = null;
      }
    }
  })();

  balancesFetchInProgress = thisPromise;
  return thisPromise;
}

const onStart = async function () {
  const tag = TAG + ' | onStart | ';
  try {
    console.log(tag, 'Starting...');
    resetSolanaState(); // clear stale cached address before re-init
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

      const defaultProvider: any = {
        chainId: '0x1',
        caip: 'eip155:1/slip44:60',
        blockExplorerUrls: ['https://etherscan.io'],
        name: 'Ethereum',
        providerUrl: 'https://eth.llamarpc.com',
        fallbacks: [],
      };
      // Get current provider
      const currentProvider = await web3ProviderStorage.getWeb3Provider();
      if (!currentProvider) {
        console.log(tag, 'No provider set, setting default provider');
        await web3ProviderStorage.saveWeb3Provider(defaultProvider);
      }

      // Fetch balances in background (non-blocking)
      fetchBalancesFromPioneer().catch(e => console.warn(tag, 'Initial balance fetch failed:', e));
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

setTimeout(() => {
  onStart();
}, 5000);

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  (async () => {
    const tag = TAG + ' | chrome.runtime.onMessage | ';

    try {
      switch (message.type) {
        case 'WALLET_REQUEST': {
          if (!wallet.isInitialized()) throw Error('Wallet not initialized');
          const { requestInfo } = message;
          const { method, params, chain } = requestInfo;

          if (method) {
            try {
              // KEEPKEY_WALLET and ADDRESS are passed for backward compat with handler signatures
              const result = await handleWalletRequest(requestInfo, chain, method, params, null, ADDRESS);
              sendResponse({ result });
            } catch (error) {
              sendResponse({ error: formatUserError(error) });
            }
          } else {
            sendResponse({ error: 'Invalid request: missing method' });
          }
          break;
        }

        case 'open_sidebar':
        case 'OPEN_SIDEBAR': {
          console.log(tag, 'Opening sidebar ** ');
          chrome.tabs.query({}, tabs => {
            if (chrome.runtime.lastError) {
              console.error('Error querying tabs:', chrome.runtime.lastError);
              return;
            }

            const webPageTabs = tabs.filter(tab => {
              return (
                tab.url &&
                !tab.url.startsWith('chrome://') &&
                !tab.url.startsWith('chrome-extension://') &&
                !tab.url.startsWith('about:')
              );
            });

            if (webPageTabs.length > 0) {
              webPageTabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
              const tab = webPageTabs[0];
              const windowId = tab.windowId;

              console.log(tag, 'Opening sidebar in tab:', tab);

              chrome.sidePanel.open({ windowId }, () => {
                if (chrome.runtime.lastError) {
                  console.error('Error opening side panel:', chrome.runtime.lastError);
                } else {
                  console.log('Side panel opened successfully.');
                }
              });
            } else {
              console.error('No suitable web page tabs found to open the side panel.');
            }
          });
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
          onStart();
          setTimeout(() => {
            sendResponse({ state: KEEPKEY_STATE });
          }, 15000);
          break;
        }

        case 'CLEAR_CACHE': {
          cachedBalances = [];
          balancesFetchInProgress = null;
          sendResponse({ success: true });
          break;
        }

        case 'RESET_APP': {
          console.log(tag, 'Resetting app...');
          chrome.runtime.reload();
          sendResponse({ result: true });
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

            const response = await fetch(`${PIONEER_API}/api/v1/insight`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tx, source }),
            });
            const result = await response.json();
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
            const evmProvider = new JsonRpcProvider(providerInfo.providerUrl);
            const feeData = await evmProvider.getFeeData();
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
                const networkPubkeys = wallet.getPubkeys(asset.networkId);
                // For EVM wildcard, also try the base eip155 network
                if (networkPubkeys.length === 0 && asset.networkId.startsWith('eip155')) {
                  const evmPubkeys = wallet
                    .getPubkeys()
                    .filter((pk: any) => pk.networks?.includes('eip155:*') || pk.networks?.includes(asset.networkId));
                  if (evmPubkeys.length > 0) asset.pubkeys = evmPubkeys;
                } else {
                  asset.pubkeys = networkPubkeys;
                }
                // Set address from first pubkey
                if (!asset.address && asset.pubkeys?.[0]?.address) {
                  asset.address = asset.pubkeys[0].address;
                }
              }

              // Track previous address/chain to detect changes for dApp notification
              const prevAddress = ADDRESS;
              const prevProvider = await web3ProviderStorage.getWeb3Provider();
              const prevChainId = prevProvider?.chainId;

              // Update global ADDRESS for EVM signing when account changes
              if (asset.networkId?.startsWith('eip155:') && asset.address) {
                ADDRESS = asset.address;
                console.log(tag, 'Updated global ADDRESS to:', ADDRESS);
              }

              // Store in assetContextStorage for GET_ASSET_CONTEXT
              await assetContextStorage.updateContext(asset);

              // If eip155 then set web3 provider
              let newChainId: string | undefined;
              if (asset.networkId && asset.networkId.includes('eip155')) {
                // Try to get provider data from custom chains first (user-added networks)
                let providerData = await blockchainDataStorage.getBlockchainData(asset.networkId);

                // Fallback to static chain list if not found in custom storage
                if (!providerData) {
                  const chainInfo = EIP155_CHAINS[asset.networkId];
                  if (chainInfo) {
                    providerData = {
                      chainId: chainInfo.chainId,
                      caip: chainInfo.caip,
                      blockExplorerUrls: [],
                      name: chainInfo.name,
                      providerUrl: chainInfo.rpc,
                      fallbacks: [],
                    };
                  } else {
                    console.error(tag, 'Network not found in custom or static chains:', asset.networkId);
                  }
                }

                if (providerData) {
                  await web3ProviderStorage.saveWeb3Provider(providerData);
                  newChainId = providerData.chainId;
                }
              }

              chrome.runtime
                .sendMessage({
                  type: 'ASSET_CONTEXT_UPDATED',
                  assetContext: asset,
                })
                .catch(() => {});

              // EIP-1193: Notify dApps of account/chain changes via content script relay
              if (asset.networkId?.startsWith('eip155:')) {
                const addressChanged = asset.address && asset.address !== prevAddress;
                const chainChanged = newChainId && newChainId !== prevChainId;

                if (addressChanged || chainChanged) {
                  chrome.tabs.query({}, tabs => {
                    for (const tab of tabs) {
                      if (!tab.id) continue;
                      if (addressChanged) {
                        chrome.tabs
                          .sendMessage(tab.id, {
                            type: 'ACCOUNTS_CHANGED',
                            accounts: [ADDRESS],
                          })
                          .catch(() => {});
                      }
                      if (chainChanged) {
                        chrome.tabs
                          .sendMessage(tab.id, {
                            type: 'CHAIN_CHANGED',
                            provider: { chainId: newChainId },
                          })
                          .catch(() => {});
                      }
                    }
                  });
                }
              }

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
          // Return first pubkey as context
          const pubkeys = wallet.getPubkeys();
          sendResponse({ pubkeyContext: pubkeys.length > 0 ? pubkeys[0] : null });
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
            sendResponse({ success: true, accounts });
          } catch (error) {
            console.error('Error removing ETH account:', error);
            sendResponse({ error: 'Failed to remove ETH account' });
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
            sendResponse({ success: true, networks });
          } catch (error) {
            console.error('Error removing custom EVM network:', error);
            sendResponse({ error: 'Failed to remove custom EVM network' });
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

            // Get RPC provider for the network
            const chainInfo = EIP155_CHAINS[networkId];
            if (chainInfo && ADDRESS) {
              const evmProvider = new JsonRpcProvider(chainInfo.rpc);
              const balance = await evmProvider.getBalance(ADDRESS);
              sendResponse('0x' + balance.toString(16));
            } else {
              sendResponse('0');
            }
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
            const response = await fetch(`${PIONEER_API}/api/v1/nodes?chainId=${encodeURIComponent(chainId)}`);
            const data = await response.json();
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
            for (const networkId of savedChains) {
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
            if (cachedBalances.length > 0) {
              sendResponse({ balances: cachedBalances });
            } else if (wallet.isInitialized()) {
              const balances = await fetchBalancesFromPioneer();
              sendResponse({ balances });
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
            sendResponse({ balances });
          } catch (error: any) {
            console.error(tag, 'REFRESH_ALL_BALANCES error:', error);
            sendResponse({ balances: cachedBalances, error: error.message });
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

            // Find RPC URL — try custom chains first, then static list
            let rpcUrl: string | undefined;
            let chainName = evmNetworkId;
            let chainSymbol = 'ETH';

            const customChain = await blockchainDataStorage.getBlockchainData(evmNetworkId);
            if (customChain?.providerUrl) {
              rpcUrl = customChain.providerUrl;
              chainName = customChain.name || evmNetworkId;
              chainSymbol = customChain.nativeCurrency?.symbol || customChain.symbol || 'ETH';
            } else if (EIP155_CHAINS[evmNetworkId]) {
              rpcUrl = EIP155_CHAINS[evmNetworkId].rpc;
              chainName = EIP155_CHAINS[evmNetworkId].name;
            }

            if (!rpcUrl) {
              sendResponse({ balance: '0', valueUsd: '0', error: 'No RPC for network' });
              break;
            }

            const rpcProvider = new JsonRpcProvider(rpcUrl);
            const rawBal = await Promise.race([
              rpcProvider.getBalance(evmAddress),
              new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ]);
            const balStr = formatEther(rawBal);

            // Try to get USD price from cached balances for this network
            let nativeCached = cachedBalances.find((b: any) => b.networkId === evmNetworkId && b.isNative);
            // Fallback: L2 chains (Base, Arbitrum, Optimism, etc.) use ETH as native gas —
            // if no cached price for this specific chain, use Ethereum mainnet ETH price.
            if (!nativeCached?.priceUsd && evmNetworkId !== 'eip155:1') {
              nativeCached = cachedBalances.find((b: any) => b.networkId === 'eip155:1' && b.isNative) || nativeCached;
            }
            const priceUsd = parseFloat(nativeCached?.priceUsd || '0');
            const valueUsd = (parseFloat(balStr) * priceUsd).toString();

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
            let balances = cachedBalances;
            if (balances.length === 0 && wallet.isInitialized()) {
              balances = await fetchBalancesFromPioneer();
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

            const response = await fetch(`${PIONEER_API}/api/v1/tokens/metadata`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await response.json();
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

            const response = await fetch(`${PIONEER_API}/api/v1/tokens/custom`, {
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
            });
            const data = await response.json();
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

            const response = await fetch(url);
            const data = await response.json();
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

            const response = await fetch(
              `${PIONEER_API}/api/v1/tokens/balances?networkId=${encodeURIComponent(networkId)}&address=${encodeURIComponent(address)}`,
            );
            const data = await response.json();
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

            const response = await fetch(`${PIONEER_API}/api/v1/tokens/custom`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userAddress, networkId, tokenAddress }),
            });
            const data = await response.json();
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

            // Get RPC provider for the network
            const chainInfo = EIP155_CHAINS[networkId];
            if (!chainInfo) {
              sendResponse({ valid: false, error: 'Unsupported network' });
              break;
            }

            const rpcProvider = new JsonRpcProvider(chainInfo.rpc);

            // ERC-20 ABI for name, symbol, and decimals
            const ERC20_ABI = [
              'function name() view returns (string)',
              'function symbol() view returns (string)',
              'function decimals() view returns (uint8)',
            ];

            const { Contract } = await import('ethers');
            const tokenContract = new Contract(contractAddress, ERC20_ABI, rpcProvider);

            const [name, symbol, decimals] = await Promise.all([
              tokenContract.name(),
              tokenContract.symbol(),
              tokenContract.decimals(),
            ]);

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
      sendResponse({ error: error.message });
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
          chrome.sidePanel.open({ tabId: tab.id }, () => {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getMaskingSettings') {
    chrome.storage.local.get(['enableMetaMaskMasking', 'enableXfiMasking', 'enableKeplrMasking'], result => {
      console.log('getMaskingSettings result: ', result);
      sendResponse(result);
    });
    return true;
  }
});
