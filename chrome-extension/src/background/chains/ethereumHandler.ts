/*
    Ethereum Provider Refactored
*/

import { JsonRpcProvider, parseEther, Transaction } from 'ethers';
import { createProviderRpcError, ProviderRpcError } from '../utils';
import {
  requestStorage,
  web3ProviderStorage,
  assetContextStorage,
  blockchainDataStorage,
  blockchainStorage,
} from '@extension/storage';
import { v4 as uuidv4 } from 'uuid';
import { ChainToNetworkId, caipToNetworkId, networkIdToIcon } from '../chainConfig';
import * as wallet from '../wallet';
import { buildFeeWarning, type FeeChoice, type FeeWarning } from './feeFloors';
import { openSidePanel, setApprovalBadge } from '../popup';
import { getChainInfo } from './registry';

const TAG = ' | ethereumHandler | ';
const DOMAIN_WHITE_LIST = [];

const HARDENED = 0x80000000;

/**
 * Derive the addressNList for the currently selected ETH account.
 * Looks up the pubkey matching ADDRESS to find its account index.
 * Uses explicit accountIndex field (set during path enrichment), with note regex as fallback.
 * Falls back to account 0 path if not found.
 */
const getAddressNListForAddress = (address: string): number[] => {
  const DEFAULT_PATH = [HARDENED + 44, HARDENED + 60, HARDENED + 0, 0, 0];
  if (!address) return DEFAULT_PATH;

  const allPubkeys = wallet.getPubkeys();
  const normalizedAddr = address.toLowerCase();
  const match = allPubkeys.find(
    (pk: any) =>
      (pk.networks?.includes('eip155:1') || pk.networks?.includes('eip155:*')) &&
      (pk.address?.toLowerCase() === normalizedAddr || pk.master?.toLowerCase() === normalizedAddr),
  );

  if (!match) return DEFAULT_PATH;

  // Prefer explicit accountIndex (set during pubkey enrichment in wallet.ts)
  let accountIndex: number;
  if (match.accountIndex !== undefined) {
    accountIndex = match.accountIndex;
  } else {
    // Fallback: parse from note field
    const accountMatch = match.note?.match(/account\s*(\d+)/i);
    accountIndex = accountMatch ? parseInt(accountMatch[1], 10) : 0;
  }

  if (accountIndex === 0) {
    return [HARDENED + 44, HARDENED + 60, HARDENED + 0, 0, 0];
  }
  return [HARDENED + 44, HARDENED + 60, HARDENED + accountIndex, 0, 0];
};

interface ChainInfo {
  chainId: string;
  name: string;
  logo: string;
  rgb: string;
  rpc: string;
  namespace: string;
  caip: string;
}

interface Eip155Chains {
  [key: string]: ChainInfo;
}

type Event = {
  id: string;
  type: string;
  request: any;
  status: 'request' | 'approval' | 'completed';
  timestamp: string;
};

const convertHexToDecimalChainId = (hexChainId: string): number => {
  return parseInt(hexChainId, 16);
};

const sanitizeChainId = (chainId: string): string => {
  return chainId.replace(/^0x0x/, '0x');
};

// Track failed RPCs to avoid retrying them immediately
const failedRpcs = new Map<string, number>(); // URL -> timestamp of failure
const RPC_RETRY_DELAY = 60000; // Don't retry failed RPC for 1 minute

// Helper function to get the provider with RPC failover
const getProvider = async (): Promise<JsonRpcProvider> => {
  const tag = TAG + ' | getProvider | ';

  // Clean up expired RPC failure entries
  const now = Date.now();
  for (const [url, failedAt] of failedRpcs) {
    if (now - failedAt >= RPC_RETRY_DELAY) {
      failedRpcs.delete(url);
    }
  }

  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  console.log(tag, 'currentProvider from storage:', currentProvider);

  if (!currentProvider) {
    throw createProviderRpcError(4900, 'Provider not properly configured');
  }

  // Get all available RPC URLs
  const rpcUrls =
    currentProvider.providers && currentProvider.providers.length > 0
      ? currentProvider.providers
      : [currentProvider.providerUrl];
  if (!rpcUrls || rpcUrls.length === 0 || !rpcUrls[0]) {
    throw createProviderRpcError(4900, 'No RPC URLs available');
  }

  console.log(tag, 'Available RPCs:', rpcUrls.length);

  // Filter out recently failed RPCs
  const availableRpcs = rpcUrls.filter(url => {
    const failedAt = failedRpcs.get(url);
    if (failedAt && now - failedAt < RPC_RETRY_DELAY) {
      console.log(tag, 'Skipping recently failed RPC:', url);
      return false;
    }
    return true;
  });

  if (availableRpcs.length === 0) {
    console.warn(tag, 'All RPCs recently failed, retrying anyway...');
    failedRpcs.clear(); // Reset failures and try again
    availableRpcs.push(...rpcUrls);
  }

  // Try each RPC until one works
  const errors = [];
  for (const rpcUrl of availableRpcs) {
    try {
      const cleanUrl = rpcUrl.trim();
      console.log(tag, `Trying RPC [${availableRpcs.indexOf(rpcUrl) + 1}/${availableRpcs.length}]:`, cleanUrl);

      const provider = new JsonRpcProvider(cleanUrl);

      // Test the connection with a quick call (with timeout)
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 5000));
      const blockNumber = await Promise.race([provider.getBlockNumber(), timeoutPromise]);

      console.log(tag, '✅ RPC working! Block:', blockNumber, 'URL:', cleanUrl);

      // Update the primary URL to the working one
      if (currentProvider.providerUrl !== cleanUrl) {
        currentProvider.providerUrl = cleanUrl;
        await web3ProviderStorage.saveWeb3Provider(currentProvider);
        console.log(tag, 'Updated primary RPC to:', cleanUrl);
      }

      return provider;
    } catch (error) {
      console.error(tag, '❌ RPC failed:', rpcUrl, error.message);
      errors.push({ url: rpcUrl, error: error.message });
      failedRpcs.set(rpcUrl, now);
    }
  }

  // All RPCs failed
  console.error(tag, 'All RPCs failed:', errors);
  throw createProviderRpcError(
    4900,
    `All ${availableRpcs.length} RPC endpoints failed. Errors: ${errors.map(e => `${e.url}: ${e.error}`).join('; ')}`,
  );
};

// Handler functions for each method

/**
 * Normalize a stored chainId to a number. The codebase has TWO conventions
 * in the wild:
 *   - decimal string (legacy switch path: "56")
 *   - hex string (custom-add + Pioneer-discovered path: "0x38")
 * Be robust to both. Returns null when unparseable.
 */
const parseChainId = (raw: unknown): number | null => {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  const n = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

const handleEthChainId = async () => {
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  const n = parseChainId(currentProvider?.chainId);
  if (n == null) {
    console.warn(TAG, 'eth_chainId: unparseable stored chainId, defaulting to 0x1:', currentProvider?.chainId);
    return '0x1';
  }
  const chainIdHex = '0x' + n.toString(16);
  console.log(TAG, 'eth_chainId returning:', chainIdHex, '(stored:', currentProvider?.chainId, ')');
  return chainIdHex;
};

const handleNetVersion = async () => {
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  const n = parseChainId(currentProvider?.chainId);
  // net_version is the decimal chainId as a string. Falling back to "1"
  // matches the eth_chainId default above.
  return (n ?? 1).toString();
};

const handleEthGetBlockByNumber = async params => {
  // Passthrough raw RPC. ethers v6 `provider.getBlock(...)` returns a
  // `Block` class instance whose field set is a SUBSET of the JSON-RPC
  // spec response (drops sha3Uncles, logsBloom, transactionsRoot,
  // stateRoot, receiptsRoot, difficulty, totalDifficulty, size, uncles)
  // and whose prototype/methods are stripped when we send the value
  // through `chrome.runtime.sendMessage`. dApps parse the JSON-RPC shape,
  // not the wrapper. See docs/RPC_PASSTHROUGH_AUDIT.md.
  const provider = await getProvider();
  return provider.send('eth_getBlockByNumber', params);
};

const handleEthBlockNumber = async () => {
  const provider = await getProvider();
  const blockNumber = await provider.getBlockNumber();
  return '0x' + blockNumber.toString(16);
};

const handleEthGetBalance = async params => {
  const tag = TAG + ' | handleEthGetBalance | ';
  try {
    console.log(tag, 'Getting balance for address:', params[0], 'block:', params[1]);
    const provider = await getProvider();
    console.log(tag, 'Provider created, calling getBalance...');

    const balance = await provider.getBalance(params[0], params[1]);
    console.log(tag, 'Balance retrieved:', balance.toString());

    return '0x' + balance.toString(16);
  } catch (error) {
    console.error(tag, 'Error getting balance:', error);
    throw error;
  }
};

const handleEthGetTransactionReceipt = async params => {
  // Passthrough raw RPC — see docs/RPC_PASSTHROUGH_AUDIT.md. ethers v6
  // `provider.getTransactionReceipt(...)` returns a `TransactionReceipt`
  // class with `index` (vs spec `transactionIndex`), reshaped `logs[]`,
  // and stripped methods after structured-clone — dApps parse the
  // JSON-RPC spec shape and reject the wrapper.
  const provider = await getProvider();
  return provider.send('eth_getTransactionReceipt', params);
};

const handleEthGetTransactionByHash = async params => {
  // Passthrough raw RPC — see docs/RPC_PASSTHROUGH_AUDIT.md. ethers v6
  // `provider.getTransaction(...)` returns a `TransactionResponse` class
  // whose field names diverge from the JSON-RPC spec: `gasLimit` vs
  // `gas`, `data` vs `input`, `index` vs `transactionIndex`, nested
  // `signature.{v,r,s}` vs flat. After structured-clone the methods are
  // gone too. This is the polling endpoint Uniswap (and most dApps) use
  // to track a tx after `eth_sendTransaction`; the wrapper shape was
  // breaking that handoff.
  const provider = await getProvider();
  return provider.send('eth_getTransactionByHash', params);
};

const handleWeb3ClientVersion = async () => {
  const provider = await getProvider();
  const clientVersion = await provider.send('web3_clientVersion', []);
  return clientVersion;
};

const handleEthCall = async params => {
  // ethers v6 provider.call(tx) ignores extra args, dropping blockTag AND
  // stateOverride. Uniswap's pre-quote simulation uses stateOverride to
  // model the not-yet-broadcasted Permit2 approval; if we drop it the
  // simulation reverts and the quote is rejected (/v1/swap returns 404).
  // Passthrough raw RPC so the dApp's params arrive byte-identical.
  const provider = await getProvider();
  return provider.send('eth_call', params);
};

const handleEthMaxPriorityFeePerGas = async () => {
  const provider = await getProvider();
  const feeData = await provider.getFeeData();
  return feeData.maxPriorityFeePerGas ? '0x' + feeData.maxPriorityFeePerGas.toString(16) : '0x0';
};

const handleEthMaxFeePerGas = async () => {
  const provider = await getProvider();
  const feeData = await provider.getFeeData();
  return feeData.maxFeePerGas ? '0x' + feeData.maxFeePerGas.toString(16) : '0x0';
};

const handleEthEstimateGas = async params => {
  // ethers v6 provider.estimateGas(tx) takes 1 arg and drops blockTag.
  // Passthrough raw RPC for spec-compliant behavior.
  const provider = await getProvider();
  return provider.send('eth_estimateGas', params);
};

const handleEthGasPrice = async () => {
  const provider = await getProvider();
  const feeData = await provider.getFeeData();
  return feeData.gasPrice ? '0x' + feeData.gasPrice.toString(16) : '0x0';
};

const handleEthFeeHistory = async params => {
  // Raw passthrough — modern dApps (incl. Uniswap's UI via ethers v6 fee
  // estimator) call eth_feeHistory for percentile-based fee math. Without
  // this case the request hits the default branch and throws "method not
  // supported", forcing the dApp onto a stale eth_gasPrice fallback.
  const provider = await getProvider();
  return provider.send('eth_feeHistory', params);
};

const handleEthGetCode = async params => {
  const provider = await getProvider();
  const code = await provider.getCode(params[0], params[1]);
  return code;
};

const handleEthGetStorageAt = async params => {
  const provider = await getProvider();
  const storage = await provider.getStorageAt(params[0], params[1], params[2]);
  return storage;
};

const handleEthGetTransactionCount = async params => {
  const provider = await getProvider();
  const transactionCount = await provider.getTransactionCount(params[0], params[1]);
  return '0x' + transactionCount.toString(16);
};

const handleEthSendRawTransaction = async params => {
  // Decode-friendly handoff log — captures the dApp-supplied raw tx
  // (already signed externally) BEFORE we relay it to the RPC. Paste
  // params[0] into an EVM tx decoder to inspect its contents.
  console.log(`[HANDOFF] dApp → BEX (eth_sendRawTransaction) rawTx=${params[0]}`);
  const provider = await getProvider();
  const txResponse = await provider.broadcastTransaction(params[0]);
  console.log(`[HANDOFF] RPC → BEX (eth_sendRawTransaction result) hash=${txResponse?.hash}`);
  return txResponse.hash;
};

// Helper function to switch to a provider and update contexts
const switchToProvider = async (currentProvider: any, KEEPKEY_WALLET: any, tag: string) => {
  console.log(tag, 'Switching to provider (raw):', currentProvider);

  if (!currentProvider.caip) {
    throw createProviderRpcError(4900, 'Invalid provider configuration - missing caip');
  }
  if (!currentProvider.networkId) {
    throw createProviderRpcError(4900, 'Invalid provider configuration - missing networkId');
  }

  // Clean provider URLs to handle malformed data from storage or dApps
  const cleanedProvider = {
    ...currentProvider,
    providerUrl: currentProvider.providerUrl?.trim(),
    explorer: currentProvider.explorer?.trim(),
    explorerAddressLink: currentProvider.explorerAddressLink?.trim(),
    explorerTxLink: currentProvider.explorerTxLink?.trim(),
    providers: Array.isArray(currentProvider.providers)
      ? currentProvider.providers.map((url: string) => url?.trim()).filter((url: string) => url && url.length > 0)
      : [],
  };

  // Enrich with icon, pubkeys, and address (same as SET_ASSET_CONTEXT does)
  if (!cleanedProvider.icon) {
    cleanedProvider.icon = networkIdToIcon(cleanedProvider.networkId);
  }
  if (cleanedProvider.networkId.startsWith('eip155')) {
    const allPubkeys = wallet.getPubkeys();
    const evmPubkeys = allPubkeys.filter(
      (pk: any) => pk.networks?.includes('eip155:*') || pk.networks?.includes(cleanedProvider.networkId),
    );
    if (evmPubkeys.length > 0) {
      cleanedProvider.pubkeys = evmPubkeys;
      if (!cleanedProvider.address && evmPubkeys[0]?.address) {
        cleanedProvider.address = evmPubkeys[0].address;
      }
    }
  }

  console.log(tag, 'Cleaned provider URL:', cleanedProvider.providerUrl);

  // Save cleaned provider (this will fix stored data)
  await web3ProviderStorage.saveWeb3Provider(cleanedProvider);
  await assetContextStorage.updateContext(cleanedProvider);

  // Notify extension UI listeners
  chrome.runtime.sendMessage({ type: 'PROVIDER_CHANGED', provider: cleanedProvider });
  chrome.runtime.sendMessage({ type: 'ASSET_CONTEXT_UPDATED', assetContext: cleanedProvider });

  // EIP-1193: Notify dApps via content script relay
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'CHAIN_CHANGED',
          provider: { chainId: cleanedProvider.chainId },
        })
        .catch(() => {});
      // Also send accountsChanged with current address since chain context may affect visible account
      if (cleanedProvider.address) {
        chrome.tabs
          .sendMessage(tab.id, {
            type: 'ACCOUNTS_CHANGED',
            accounts: [cleanedProvider.address],
          })
          .catch(() => {});
      }
    }
  });
  console.log(tag, 'Chain switched successfully');
};

// Handle wallet_switchEthereumChain - switch to existing chain only
const handleWalletSwitchEthereumChain = async (params, KEEPKEY_WALLET, requestInfo: any) => {
  const tag = TAG + ' | handleWalletSwitchEthereumChain | ';
  console.log(tag, 'Switch Chain params: ', params);

  if (!params || !params[0] || !params[0].chainId) {
    throw createProviderRpcError(4001, 'Invalid chainId parameter (Required)');
  }

  const chainIdHex = params[0].chainId;
  const chainIdDecimal = parseInt(chainIdHex, 16);
  const networkId = 'eip155:' + chainIdDecimal;
  console.log(tag, 'networkId: ', networkId);

  // 1) User-managed custom chain (rpcUrls overridden in Add Network UI)
  //    — always wins, even if Pioneer also knows the chain. The user
  //    explicitly told us which RPC to use; respect that.
  const storedChainData = await blockchainDataStorage.getBlockchainData(networkId);
  if (storedChainData) {
    console.log(tag, 'Chain found in custom storage, switching...');
    await switchToProvider(storedChainData, KEEPKEY_WALLET, tag);
    return null;
  }

  // 2) Pioneer registry — one-step add+switch. Pioneer knows ~196 EVM
  //    chains today; for any of those we provision the provider, persist
  //    to local storage so subsequent switches are zero-RTT, and switch.
  //    No user prompt — the chain is already trusted (Pioneer is our
  //    canonical catalog) and the dApp explicitly asked to switch.
  const pioneerChain = await getChainInfo(networkId);
  if (pioneerChain?.rpc) {
    console.log(tag, 'Chain found in Pioneer registry, provisioning + switching...');
    try {
      // @ts-expect-error storage typing is loose
      await blockchainDataStorage.addBlockchainData(networkId, {
        chainId: pioneerChain.chainId,
        caip: pioneerChain.caip,
        name: pioneerChain.name,
        symbol: pioneerChain.symbol,
        explorer: pioneerChain.explorer,
        explorerAddressLink: pioneerChain.explorerAddressLink,
        explorerTxLink: pioneerChain.explorerTxLink,
        blockExplorerUrls: pioneerChain.explorer ? [pioneerChain.explorer] : [],
        providerUrl: pioneerChain.rpc,
        providers: pioneerChain.rpcs,
        nativeCurrency: {
          name: pioneerChain.symbol || pioneerChain.name,
          symbol: pioneerChain.symbol || 'ETH',
          decimals: pioneerChain.decimals,
        },
        type: 'evm',
      });
      await blockchainStorage.addBlockchain(networkId);
    } catch (e) {
      console.warn(tag, 'Failed to persist Pioneer-discovered chain (continuing with switch anyway):', e);
    }
    await switchToProvider(
      {
        chainId: pioneerChain.chainId,
        caip: pioneerChain.caip,
        networkId,
        name: pioneerChain.name,
        providerUrl: pioneerChain.rpc,
        providers: pioneerChain.rpcs,
      },
      KEEPKEY_WALLET,
      tag,
    );
    return null;
  }

  // 3) Chain unknown to both local storage AND Pioneer — fall back to
  //    the chain-not-enabled info card and throw 4902. This should only
  //    happen for very obscure / new chains; everything in active use is
  //    in Pioneer's catalog.
  try {
    const eventId = (requestInfo?.id as string) || uuidv4();
    if (requestInfo) requestInfo.id = eventId;
    // @ts-expect-error storage typing is loose
    await requestStorage.addEvent({
      id: eventId,
      networkId,
      chain: 'ethereum',
      href: requestInfo?.href,
      siteUrl: requestInfo?.siteUrl,
      requestInfo,
      type: 'chain_not_enabled',
      request: params,
      unsignedTx: { chainIdHex, chainIdDecimal, networkId },
      status: 'request',
      timestamp: new Date().toISOString(),
    });
    setApprovalBadge(true);
    await openSidePanel(requestInfo);
    chrome.runtime.sendMessage({ type: 'TRANSACTION_CONTEXT_UPDATED', id: eventId }).catch(() => {});
  } catch (e) {
    console.warn(tag, 'Failed to surface chain-not-enabled popup:', e);
  }

  console.log(tag, 'Chain not enabled, returning 4902 error');
  throw createProviderRpcError(
    4902,
    `Unrecognized chain ID "${chainIdHex}". Try adding the chain using wallet_addEthereumChain first.`,
  );
};

// Handle wallet_addEthereumChain - add new chain with user approval
const handleWalletAddEthereumChain = async (params, KEEPKEY_WALLET, requestInfo, requireApproval) => {
  const tag = TAG + ' | handleWalletAddEthereumChain | ';
  console.log(tag, 'Add Chain params: ', params);
  console.log(tag, 'KEEPKEY_WALLET exists:', !!KEEPKEY_WALLET);
  console.log(tag, 'KEEPKEY_WALLET.pioneer exists:', !!KEEPKEY_WALLET?.pioneer);

  if (!params || !params[0] || !params[0].chainId) {
    throw createProviderRpcError(4001, 'Invalid chainId parameter (Required)');
  }

  const chainIdHex = params[0].chainId;
  const chainIdDecimal = parseInt(chainIdHex, 16);
  const chainId = chainIdDecimal.toString();
  const networkId = 'eip155:' + chainIdDecimal;
  console.log(tag, 'Adding Chain networkId: ', networkId);

  // Check if dApp provided RPC URLs (full chain details)
  if (!params[0].rpcUrls || !params[0].rpcUrls[0]) {
    // No RPC URLs provided - cannot add chain without details
    throw createProviderRpcError(
      4001,
      `Missing rpcUrls parameter. To add chain ${chainIdHex}, please provide rpcUrls, chainName, and nativeCurrency.`,
    );
  }

  // Validate required parameters for adding chain
  if (!params[0].chainName) {
    throw createProviderRpcError(4001, 'Missing chainName parameter');
  }
  if (!params[0].nativeCurrency) {
    throw createProviderRpcError(4001, 'Missing nativeCurrency parameter');
  }

  // Build provider config from dApp params
  console.log(tag, 'Adding custom chain:', params[0].chainName);

  // Clean and validate RPC URLs (trim whitespace)
  const cleanRpcUrls = params[0].rpcUrls.map((url: string) => url.trim()).filter((url: string) => url.length > 0);
  if (cleanRpcUrls.length === 0) {
    throw createProviderRpcError(4001, 'Invalid rpcUrls - all URLs are empty after cleaning');
  }

  const cleanExplorer = params[0].blockExplorerUrls?.[0]?.trim() || '';

  const newProvider = {
    explorer: cleanExplorer,
    explorerAddressLink: cleanExplorer ? `${cleanExplorer}/address/` : '',
    explorerTxLink: cleanExplorer ? `${cleanExplorer}/tx/` : '',
    chainId,
    networkId,
    caip: `eip155:${chainIdDecimal}/slip44:60`,
    name: params[0].chainName.trim(),
    type: 'evm',
    identifier: params[0].chainName.trim(),
    nativeCurrency: params[0].nativeCurrency,
    symbol: params[0].nativeCurrency.symbol.trim(),
    precision: params[0].nativeCurrency.decimals,
    providerUrl: cleanRpcUrls[0],
    providers: cleanRpcUrls,
  };

  console.log(tag, 'Cleaned provider config:', newProvider);

  // Require user approval before adding chain. The event id MUST match
  // requestInfo.id — methods.ts:requireApproval() keys its eth_sign_response
  // listener on requestInfo.id, and the sidebar echoes the stored event.id
  // back. The previous code stored a fresh uuid while leaving requestInfo.id
  // alone, so approvals never resolved and every wallet_addEthereumChain
  // silently timed out after 10 minutes. Match the pattern used by
  // handleSigningMethods / handleTransfer below: mutate requestInfo.id to a
  // uuid first (collision-safe across concurrent dApp requests) and then
  // use it as the event id.
  requestInfo.id = uuidv4();
  const approvalEvent = {
    id: requestInfo.id,
    networkId,
    chain: 'ethereum',
    type: 'wallet_addEthereumChain',
    request: params,
    status: 'request' as const,
    timestamp: new Date().toISOString(),
    unsignedTx: null,
    chainName: params[0].chainName,
    chainId: chainIdHex,
    requestInfo,
  };
  await requestStorage.addEvent(approvalEvent);
  const approval = await requireApproval(networkId, requestInfo, 'ethereum', 'wallet_addEthereumChain', params[0]);
  if (!approval?.success) {
    // UI removes the event on reject, but guard against duplicate state if
    // reject came from the approval timeout instead of the user button.
    await requestStorage.removeEventById(requestInfo.id).catch(() => {});
    throw createProviderRpcError(4001, 'User rejected adding the chain');
  }

  // Store the custom chain
  await blockchainStorage.addBlockchain(newProvider.networkId);
  await blockchainDataStorage.addBlockchainData(newProvider.networkId, newProvider);
  console.log(tag, 'Custom chain stored:', newProvider);

  // Switch to the newly added chain
  await switchToProvider(newProvider, KEEPKEY_WALLET, tag);

  // Unlike signing methods this flow has no txHash and no on-device step,
  // so neither signMessage nor sendTransaction emit anything for us. Clean
  // up the pending event ourselves and reuse `signature_complete` — it's
  // the contract the sidebar uses to dismiss the overlay without trying
  // to build a TxidPage (transaction_complete would demand a txHash).
  await requestStorage.removeEventById(requestInfo.id).catch(() => {});
  chrome.runtime
    .sendMessage({
      action: 'signature_complete',
      eventId: requestInfo.id,
    })
    .catch(() => {});

  return null;
};

const handleWalletGetSnaps = async () => {
  return [];
};

const handleWalletWatchAsset = async () => {
  return true;
};

const handleWalletPermissions = async () => {
  const permissions = [{ parentCapability: 'eth_accounts' }];
  return permissions;
};

const handleWalletGetCapabilities = async (params: any[]) => {
  // wallet_getCapabilities is used by dApps to determine what features the wallet supports
  // Uniswap uses this to check for things like atomic batch transactions
  const address = params[0]?.toLowerCase();

  // Return capabilities for the specified address or all addresses
  const capabilities: Record<string, any> = {};

  // Add base capabilities that KeepKey supports
  const baseCapabilities = {
    atomicBatch: {
      supported: false, // KeepKey doesn't support atomic batch transactions yet
    },
    paymasterService: {
      supported: false, // No paymaster service support
    },
  };

  if (address) {
    capabilities[address] = baseCapabilities;
  } else {
    // Return for all addresses if none specified
    capabilities['0x0000000000000000000000000000000000000000'] = baseCapabilities;
  }

  return capabilities;
};

const handleEthAccounts = async ADDRESS => {
  const accounts = [ADDRESS];
  return accounts;
};

const handleEthRequestAccounts = async ADDRESS => {
  const requestAccounts = [ADDRESS];
  return requestAccounts;
};

const handleSigningMethods = async (method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval) => {
  const tag = TAG + ` | handleSigningMethods | `;
  console.log(tag, 'method:', method);
  console.log(tag, 'params:', params);
  const currentProvider = await web3ProviderStorage.getWeb3Provider();
  console.log(tag, 'currentProvider:', currentProvider);

  const networkId = currentProvider?.networkId || caipToNetworkId(currentProvider?.caip || 'eip155:1/slip44:60');
  console.log(tag, 'networkId:', networkId);
  if (!networkId) throw Error('Failed to set context before sending!');
  // Require user approval
  const unsignedTx = params[0];
  requestInfo.id = uuidv4();

  // Compute the fee-floor warning ONCE up front so the side-panel can render
  // the banner without doing its own RPC. Only meaningful for tx-signing
  // methods (eth_sendTransaction / eth_signTransaction); message-signing
  // flows have no fees to warn about. Also probes nonce state in the same
  // round-trip — pending vs latest tells us whether this tx will replace
  // an in-flight one (the EIP-1559 replacement-underpriced footgun).
  let feeWarning: FeeWarning | null = null;
  let nonceInfo: { latest: number; pending: number; willReplace: boolean } | null = null;
  if ((method === 'eth_sendTransaction' || method === 'eth_signTransaction') && unsignedTx) {
    try {
      const provider = await getProvider();
      const fromAddr = unsignedTx.from || ADDRESS;
      const [feeData, latestBlock, latestNonce, pendingNonce] = await Promise.all([
        provider.getFeeData(),
        provider.getBlock('latest'),
        fromAddr ? provider.getTransactionCount(fromAddr, 'latest') : Promise.resolve(0),
        fromAddr ? provider.getTransactionCount(fromAddr, 'pending') : Promise.resolve(0),
      ]);
      feeWarning = buildFeeWarning({
        chainId: unsignedTx.chainId ?? currentProvider?.chainId ?? 1,
        dappMaxFeePerGas: unsignedTx.maxFeePerGas,
        dappMaxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas,
        baseFeeWei: latestBlock?.baseFeePerGas ?? null,
        oracleMaxFeePerGas: feeData.maxFeePerGas ?? null,
        oracleMaxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? null,
      });
      if (feeWarning) console.log(tag, 'fee warning attached:', feeWarning);
      // Pending > latest means there's already a tx queued at nonce=latest,
      // and the new tx (whose nonce we'll derive at sign time, also from
      // 'pending') will be the *next* slot. willReplace flags the case
      // where the dApp explicitly set a nonce equal to a pending one.
      const dappNonce =
        unsignedTx.nonce && typeof unsignedTx.nonce === 'string'
          ? parseInt(unsignedTx.nonce.replace(/^0x/, ''), 16)
          : null;
      const willReplace = dappNonce !== null && dappNonce < pendingNonce;
      nonceInfo = { latest: latestNonce, pending: pendingNonce, willReplace };
      console.log(tag, 'nonce info:', nonceInfo);
    } catch (e) {
      // Don't block signing on a failed fee oracle — degrade silently.
      console.warn(tag, 'fee/nonce probe failed:', e);
    }
  }

  const event = {
    id: requestInfo.id,
    networkId,
    href: requestInfo.href,
    language: requestInfo.language,
    platform: requestInfo.platform,
    referrer: requestInfo.referrer,
    requestTime: requestInfo.requestTime,
    scriptSource: requestInfo.scriptSource,
    siteUrl: requestInfo.siteUrl,
    userAgent: requestInfo.userAgent,
    injectScriptVersion: requestInfo.version,
    chain: 'ethereum', //TODO I dont like this
    requestInfo,
    unsignedTx,
    feeWarning, // null when fees are fine; otherwise side-panel renders the banner
    nonceInfo, // null on non-tx flows; { latest, pending, willReplace } otherwise
    type: method,
    request: params,
    status: 'request',
    timestamp: new Date().toISOString(),
  };
  console.log(tag, 'Requesting approval for event:', event);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-expect-error
  const eventSaved = await requestStorage.addEvent(event);
  console.log(tag, 'eventSaved:', eventSaved);

  const result = await requireApproval(networkId, requestInfo, 'ethereum', method, params[0]);
  console.log(tag, 'requireApproval result:', result);

  if (result.success) {
    //TODO reload the params from storage (it may have updated!)
    const approvalResponse = await processApprovedEvent(method, params, KEEPKEY_WALLET, ADDRESS, requestInfo.id);
    return approvalResponse;
  } else {
    throw createProviderRpcError(4200, 'User denied transaction');
  }
};

const convertToHex = (amountInEther: string) => {
  const amountInWei = parseEther(amountInEther || '0');
  return '0x' + amountInWei.toString(16);
};

// For 'transfer', build transaction info before calling requireApproval
const handleTransfer = async (params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval) => {
  const tag = TAG + ' | handleTransfer | ';
  console.log(tag, 'method: transfer');
  console.log(tag, 'params:', params);
  console.log(tag, 'requestInfo:', requestInfo);

  const currentProviderCtx = await web3ProviderStorage.getWeb3Provider();
  const caip = currentProviderCtx?.caip || 'eip155:1/slip44:60';
  const networkId = currentProviderCtx?.networkId || caipToNetworkId(caip);
  console.log(tag, 'networkId:', networkId);
  if (!networkId) throw Error('Failed to set context before sending!');

  // Build EVM transfer locally
  const provider = await getProvider();
  const amountWei = '0x' + parseEther(params[0].amount?.amount || params[0].amount || '0').toString(16);
  const chainId = currentProviderCtx?.chainId || '1';

  requestInfo.id = uuidv4();

  const unsignedTx: any = {
    from: ADDRESS,
    to: params[0].recipient || params[0].to,
    value: amountWei,
    chainId,
    data: '0x',
  };

  // Get nonce and gas — 'pending' so an in-flight tx from this account
  // doesn't get reused (see signTransaction comment for the failure mode).
  const nonce = await provider.getTransactionCount(ADDRESS, 'pending');
  unsignedTx.nonce = '0x' + nonce.toString(16);
  try {
    let estimatedGas = await provider.estimateGas({ from: ADDRESS, to: unsignedTx.to, value: unsignedTx.value });
    const gasBuffer = BigInt(estimatedGas) / BigInt(5);
    estimatedGas = BigInt(estimatedGas) + gasBuffer;
    unsignedTx.gasLimit = '0x' + estimatedGas.toString(16);
  } catch (e) {
    unsignedTx.gasLimit = '0x' + BigInt(21000).toString(16);
  }
  const feeData = await provider.getFeeData();
  if (feeData.maxFeePerGas) {
    unsignedTx.maxFeePerGas = '0x' + feeData.maxFeePerGas.toString(16);
    unsignedTx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      ? '0x' + feeData.maxPriorityFeePerGas.toString(16)
      : '0x0';
  } else if (feeData.gasPrice) {
    unsignedTx.gasPrice = '0x' + feeData.gasPrice.toString(16);
  }

  console.log(tag, 'unsignedTx:', unsignedTx);
  requestInfo.unsignedTx = unsignedTx;
  await requestStorage.updateEventById(requestInfo.id, requestInfo);

  const event = {
    id: requestInfo.id,
    networkId,
    href: requestInfo.href,
    language: requestInfo.language,
    platform: requestInfo.platform,
    referrer: requestInfo.referrer,
    requestTime: requestInfo.requestTime,
    scriptSource: requestInfo.scriptSource,
    siteUrl: requestInfo.siteUrl,
    userAgent: requestInfo.userAgent,
    injectScriptVersion: requestInfo.version,
    chain: 'ethereum', //TODO I dont like this
    requestInfo,
    unsignedTx,
    type: 'transfer',
    request: params,
    status: 'request',
    timestamp: new Date().toISOString(),
  };
  console.log(tag, 'Requesting approval for event:', event);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-expect-error
  const eventSaved = await requestStorage.addEvent(event);
  console.log(tag, 'eventSaved:', eventSaved);
  if (!eventSaved) throw Error('Failed to create event!');

  // Now call requireApproval with the transaction info
  const result = await requireApproval(networkId, requestInfo);

  console.log(tag, 'requireApproval result:', result);
  //get payload from storage
  const response = await requestStorage.getEventById(requestInfo.id);
  console.log(tag, 'response:', response);

  if (result.success && response.unsignedTx) {
    console.log(tag, 'FINAL: unsignedTx: ', response.unsignedTx);

    // Sign using vault SDK directly
    const signedTx = await signTransaction(response.unsignedTx, KEEPKEY_WALLET);
    console.log(tag, 'signedTx:', signedTx);

    // Update storage with signed transaction
    requestInfo.signedTx = signedTx;
    await requestStorage.updateEventById(requestInfo.id, requestInfo);

    // Broadcast the transaction
    const txid = await broadcastTransaction(signedTx, response.unsignedTx?.from);
    console.log(tag, 'txid:', txid);

    // Update storage with transaction hash
    requestInfo.txid = txid;
    await requestStorage.updateEventById(requestInfo.id, requestInfo);

    // Notify transaction completion
    chrome.runtime.sendMessage({
      action: 'transaction_complete',
      eventId: requestInfo.id,
      txHash: txid,
      explorerTxLink: currentProviderCtx?.explorerTxLink,
      networkId,
    });

    return txid;
  } else {
    throw createProviderRpcError(4200, 'User denied transaction');
  }
};

// Main handler function
export const handleEthereumRequest = async (
  method: string,
  params: any[],
  requestInfo: any,
  ADDRESS: string,
  KEEPKEY_WALLET: any,
  requireApproval: (networkId: string, requestInfo: any, chain: any, method: string, params: any) => Promise<any>,
): Promise<any> => {
  const tag = ' | handleEthereumRequest | ';
  console.log(tag, 'method: ', method);

  switch (method) {
    case 'eth_chainId':
      return await handleEthChainId();

    case 'net_version':
      return await handleNetVersion();

    case 'eth_getBlockByNumber':
      return await handleEthGetBlockByNumber(params);

    case 'eth_blockNumber':
      return await handleEthBlockNumber();

    case 'eth_getBalance':
      return await handleEthGetBalance(params);

    case 'eth_getTransactionReceipt':
      return await handleEthGetTransactionReceipt(params);

    case 'eth_getTransactionByHash':
      return await handleEthGetTransactionByHash(params);

    case 'web3_clientVersion':
      return await handleWeb3ClientVersion();

    case 'eth_call':
      return await handleEthCall(params);

    case 'eth_maxPriorityFeePerGas':
      return await handleEthMaxPriorityFeePerGas();

    case 'eth_maxFeePerGas':
      return await handleEthMaxFeePerGas();

    case 'eth_estimateGas':
      return await handleEthEstimateGas(params);

    case 'eth_gasPrice':
      return await handleEthGasPrice();

    case 'eth_feeHistory':
      return await handleEthFeeHistory(params);

    case 'eth_getCode':
      return await handleEthGetCode(params);

    case 'eth_getStorageAt':
      return await handleEthGetStorageAt(params);

    case 'eth_getTransactionCount':
      return await handleEthGetTransactionCount(params);

    case 'eth_sendRawTransaction':
      return await handleEthSendRawTransaction(params);

    case 'wallet_switchEthereumChain':
      return await handleWalletSwitchEthereumChain(params, KEEPKEY_WALLET, requestInfo);

    case 'wallet_addEthereumChain':
      return await handleWalletAddEthereumChain(params, KEEPKEY_WALLET, requestInfo, requireApproval);

    case 'wallet_getSnaps':
      return await handleWalletGetSnaps();

    case 'wallet_watchAsset':
      return await handleWalletWatchAsset();

    case 'wallet_getPermissions':
    case 'wallet_requestPermissions':
      return await handleWalletPermissions();

    case 'wallet_getCapabilities':
      return await handleWalletGetCapabilities(params);

    case 'request_accounts':
    case 'eth_accounts':
      return await handleEthAccounts(ADDRESS);

    case 'eth_requestAccounts':
      return await handleEthRequestAccounts(ADDRESS);

    case 'eth_sendTransaction':
    case 'eth_signTransaction':
    case 'personal_sign':
    case 'eth_sign':
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return await handleSigningMethods(method, params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);

    case 'transfer':
      return await handleTransfer(params, requestInfo, ADDRESS, KEEPKEY_WALLET, requireApproval);

    case 'eth_getEncryptionPublicKey':
      throw createProviderRpcError(4200, 'Method eth_getEncryptionPublicKey not supported');

    default:
      throw createProviderRpcError(4200, `Method ${method} not supported`);
  }
};

// Helper functions for processing approvals and signing

const processApprovedEvent = async (method: string, params: any, KEEPKEY_WALLET: any, ADDRESS: string, id: string) => {
  try {
    console.log(TAG, 'processApprovedEvent method:', method);
    console.log(TAG, 'processApprovedEvent params:', params);

    let result;
    switch (method) {
      case 'personal_sign':
        // EIP-191 personal_sign: params = [message, address]. Prefer the dApp-supplied
        // address so multi-account wallets sign with the correct derivation path.
        result = await signMessage(params[0], KEEPKEY_WALLET, params[1] || ADDRESS, id);
        break;
      case 'eth_sign':
        result = await signMessage(params[1], KEEPKEY_WALLET, params[0], id);
        break;
      case 'eth_sendTransaction':
        result = await sendTransaction(params, KEEPKEY_WALLET, ADDRESS, id);
        break;
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        result = await signTypedData(params, KEEPKEY_WALLET, ADDRESS, id);
        break;
      case 'eth_signTransaction': {
        // Mirror sendTransaction's pre-flight: pin chainId/from from the
        // active provider/account, then apply any feeChoice the user picked
        // in the side-panel fee-warning banner. Without this, `Use suggested`
        // and `Custom…` are no-ops for eth_signTransaction (regression
        // surfaced in PR #55 review).
        const tx = params[0];
        const currentProvider = await web3ProviderStorage.getWeb3Provider();
        if (currentProvider?.chainId) tx.chainId = currentProvider.chainId;
        tx.from = ADDRESS;
        await applyFeeChoiceFromStorage(tx, id, ' | eth_signTransaction | ');
        result = await signTransaction(tx, KEEPKEY_WALLET);
        break;
      }
      default:
        console.error(TAG, `Unsupported event type: ${method}`);
        throw createProviderRpcError(4200, `Method ${method} not supported`);
    }

    console.log(TAG, `Returning result for method ${method}:`, result);
    return result;
  } catch (error) {
    console.error(TAG, 'Error processing approved event:', error);
    throw error; // Re-throw the error so it can be handled upstream if needed
  }
};

const signMessage = async (message, KEEPKEY_WALLET, ADDRESS: string, eventId?: string) => {
  const tag = TAG + ' [signMessage] ';
  try {
    console.log(tag, '**** message: ', message);
    console.log(tag, '**** ADDRESS: ', ADDRESS);

    // Vault SDK requires hex-encoded message (0x...).
    // personal_sign may pass plain UTF-8 text — convert if needed.
    let hexMessage = message;
    if (typeof message === 'string' && !message.startsWith('0x')) {
      hexMessage = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('');
    }

    const sdk = wallet.getSdk();
    const output = await sdk.eth.ethSignMessage({
      address: ADDRESS,
      addressNList: getAddressNListForAddress(ADDRESS),
      message: hexMessage,
    });
    console.log(`${tag} Transaction output: `, output);

    // EIP-1193: personal_sign/eth_sign must return hex signature string, not object.
    // Vault SDK returns { address, signature } — extract just the signature.
    const signatureHex = output?.signature || output;

    // Notify popup that signature is complete
    chrome.runtime.sendMessage({
      action: 'signature_complete',
      eventId,
      signature: signatureHex,
    });

    return signatureHex;
  } catch (e) {
    console.error(e);

    // Extract meaningful error message
    const errorMessage = e?.message || JSON.stringify(e);

    // Transform device-specific errors to user-friendly messages
    if (errorMessage.includes('unrecognized address')) {
      throw createProviderRpcError(4000, 'Please restart KeepKey Desktop, invalid state');
    } else if (errorMessage.includes('device not found') || errorMessage.includes('disconnected')) {
      throw createProviderRpcError(4000, 'KeepKey device not detected. Please check your USB connection.');
    } else if (errorMessage.includes('user rejected') || errorMessage.includes('cancelled')) {
      throw createProviderRpcError(4001, 'User rejected the signature request.');
    } else if (errorMessage.includes('timeout')) {
      throw createProviderRpcError(4000, 'KeepKey Desktop communication timed out. Please try again.');
    }

    // Generic fallback with original error
    throw createProviderRpcError(4000, `Error signing message: ${errorMessage}`);
  }
};

const signTransaction = async (transaction: any, KEEPKEY_WALLET: any) => {
  const tag = ' | signTransaction | ';
  try {
    console.log(tag, '**** transaction: ', transaction);
    if (!transaction.from) throw createProviderRpcError(4000, 'Invalid transaction: missing from');
    if (!transaction.to) throw createProviderRpcError(4000, 'Invalid transaction: missing to');
    if (!transaction.chainId) throw createProviderRpcError(4000, 'Invalid transaction: missing chainId');

    const provider = await getProvider();

    let nonce;
    if (!transaction.nonce) {
      // Use 'pending' so we count any in-mempool tx from this account.
      // 'latest' would only see confirmed txs — re-attempting a swap while
      // a prior attempt is still pending would reuse the same nonce, hit
      // EIP-1559's replacement-underpriced rule (need +10% on both fees),
      // and silently sit in mempool until evicted. That's exactly the
      // "pending forever, eth_getTransactionByHash returns null" symptom.
      nonce = await provider.getTransactionCount(transaction.from, 'pending');
      transaction.nonce = '0x' + nonce.toString(16);
    }

    // JSON-RPC eth_sendTransaction params use `gas` (per spec); ethers and
    // some legacy callers also send `gasLimit`. Honor either before falling
    // through to estimation — re-estimating when the dApp already sized the
    // call risks underprovisioning complex routes (e.g. Universal Router).
    if (!transaction.gasLimit && transaction.gas) {
      transaction.gasLimit = transaction.gas;
    }

    if (!transaction.gasLimit) {
      console.log(tag, 'No gas limit provided, estimating...');
      try {
        console.log('estimateGasPayload: ', {
          from: transaction.from,
          to: transaction.to,
          data: transaction.data,
        });

        let estimatedGas: any = await provider.estimateGas({
          from: transaction.from,
          to: transaction.to,
          data: transaction.data,
        });

        console.log(tag, 'Estimated gas:', estimatedGas.toString());

        // Always add 20% buffer to prevent out of gas errors
        const gasBuffer = BigInt(estimatedGas) / BigInt(5); // 20% buffer
        estimatedGas = BigInt(estimatedGas) + gasBuffer;
        console.log(tag, `Added 20% buffer: ${estimatedGas.toString()}`);

        // Ensure minimum gas limit of 21,000 (simple transfer)
        const MIN_GAS = BigInt(21000);
        if (estimatedGas < MIN_GAS) {
          console.warn(tag, `Estimated gas too low (${estimatedGas.toString()}). Using minimum of ${MIN_GAS}.`);
          estimatedGas = MIN_GAS;
        }

        // Cap at 10 million gas (most reasonable transactions should be under this)
        const MAX_GAS = BigInt(10000000);
        if (estimatedGas > MAX_GAS) {
          console.warn(tag, `Estimated gas exceeds max limit (${estimatedGas.toString()}). Capping at ${MAX_GAS}.`);
          estimatedGas = MAX_GAS;
        }

        transaction.gasLimit = '0x' + estimatedGas.toString(16); // Convert to hex
        console.log(tag, `Final gas limit: ${estimatedGas.toString()}`);
      } catch (e) {
        console.error(tag, 'Gas estimation failed:', e);
        // Use a reasonable fallback for complex transactions (with 20% buffer already included)
        const fallbackGas = BigInt(400000); // 400k should handle most complex swaps
        console.warn(tag, `Using fallback gas limit: ${fallbackGas.toString()}`);
        transaction.gasLimit = '0x' + fallbackGas.toString(16);
      }
    }

    const input: any = {
      from: transaction.from,
      addressNList: getAddressNListForAddress(transaction.from),
      data: transaction.data || '0x',
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      gas: transaction.gasLimit,
      value: transaction.value || '0x0',
      to: transaction.to,
      chainId: transaction.chainId,
    };

    // Set fee data
    if (transaction.maxFeePerGas && transaction.maxPriorityFeePerGas) {
      input.maxFeePerGas = transaction.maxFeePerGas;
      input.maxPriorityFeePerGas = transaction.maxPriorityFeePerGas;
    } else if (transaction.gasPrice) {
      input.gasPrice = transaction.gasPrice;
    } else {
      // Fetch fee data if not provided
      const feeData = await provider.getFeeData();
      input.gasPrice = feeData.gasPrice ? '0x' + feeData.gasPrice.toString(16) : undefined;
    }

    console.log(`${tag} Final input: `, input);
    const sdk = wallet.getSdk();
    const output = await sdk.eth.ethSignTransaction(input);
    console.log(`${tag} Transaction output: `, output);

    // Decode-friendly handoff log. Paste `serialized` into any EVM tx
    // decoder (e.g. https://flightwallet.github.io/decode-eth-tx/) to
    // diff against the dApp's expectations. Also logs the structured
    // input so the unsigned tx is recoverable without RLP-parsing.
    console.log(
      `[HANDOFF] vault → BEX (eth_signTransaction)\n  input=${JSON.stringify(input)}\n  serialized=${output.serialized}\n  r=${output.r} s=${output.s} v=${output.v}`,
    );

    return output.serialized;
  } catch (e) {
    console.error(`${tag} Error: `, e);

    // Extract meaningful error message
    const errorMessage = e?.message || JSON.stringify(e);

    // Transform device-specific errors to user-friendly messages
    if (errorMessage.includes('unrecognized address')) {
      throw createProviderRpcError(4000, 'Please restart KeepKey Desktop, invalid state');
    } else if (errorMessage.includes('device not found') || errorMessage.includes('disconnected')) {
      throw createProviderRpcError(4000, 'KeepKey device not detected. Please check your USB connection.');
    } else if (errorMessage.includes('user rejected') || errorMessage.includes('cancelled')) {
      throw createProviderRpcError(4001, 'User rejected the transaction.');
    } else if (errorMessage.includes('insufficient funds')) {
      throw createProviderRpcError(4000, 'Insufficient balance to complete this transaction.');
    } else if (errorMessage.includes('timeout')) {
      throw createProviderRpcError(4000, 'KeepKey Desktop communication timed out. Please try again.');
    }

    // Generic fallback with original error
    throw createProviderRpcError(4000, `Error signing transaction: ${errorMessage}`);
  }
};

const signTypedData = async (params: any, KEEPKEY_WALLET: any, ADDRESS: string, eventId?: string) => {
  const tag = ' | signTypedData | ';
  try {
    console.log(tag, '**** params: ', params);
    const typedData = params[1];
    const parsed = typeof typedData === 'string' ? JSON.parse(typedData) : typedData;
    const { domain, types, message, primaryType } = parsed;
    const HDWalletPayload = {
      address: ADDRESS,
      addressNList: getAddressNListForAddress(ADDRESS),
      typedData: { domain, types, message, primaryType },
    };
    console.log(tag, '**** HDWalletPayload: ', HDWalletPayload);
    console.log(tag, '**** HDWalletPayload: ', JSON.stringify(HDWalletPayload));
    const sdk = wallet.getSdk();
    const signedMessage = await sdk.eth.ethSignTypedData(HDWalletPayload);
    console.log('[HANDOFF] vault → BEX (eth_signTypedData_v4 raw):', JSON.stringify(signedMessage));

    // EIP-1193: eth_signTypedData_v4 must return hex signature string, not object.
    // Vault SDK returns { address, signature } — extract just the signature.
    const signatureHex = signedMessage?.signature || signedMessage;
    const sigType = typeof signatureHex;
    const sigLen = sigType === 'string' ? signatureHex.length : 'n/a';
    console.log(
      `[HANDOFF] BEX → dApp (eth_signTypedData_v4 final): type=${sigType} len=${sigLen} value=${signatureHex}`,
    );

    // Notify popup that signature is complete
    chrome.runtime.sendMessage({
      action: 'signature_complete',
      eventId,
      signature: signatureHex,
    });

    return signatureHex;
  } catch (e) {
    console.error(`${tag} Error: `, e);

    // Extract meaningful error message
    const errorMessage = e?.message || JSON.stringify(e);

    // Transform device-specific errors to user-friendly messages
    if (errorMessage.includes('unrecognized address')) {
      throw createProviderRpcError(4000, 'Please restart KeepKey Desktop, invalid state');
    } else if (errorMessage.includes('device not found') || errorMessage.includes('disconnected')) {
      throw createProviderRpcError(4000, 'KeepKey device not detected. Please check your USB connection.');
    } else if (errorMessage.includes('user rejected') || errorMessage.includes('cancelled')) {
      throw createProviderRpcError(4001, 'User rejected the typed data signature.');
    } else if (errorMessage.includes('timeout')) {
      throw createProviderRpcError(4000, 'KeepKey Desktop communication timed out. Please try again.');
    }

    // Generic fallback with original error
    throw createProviderRpcError(4000, `Error signing typed data: ${errorMessage}`);
  }
};

/**
 * Schedule a one-shot check that the broadcast tx is actually visible
 * to our RPC. We've seen low-tip txs accepted by the entry node, never
 * propagated to miners, and silently evicted within ~30s. The dApp polls
 * eth_getTransactionByHash through us and gets null forever. This logs
 * a clear warning and emits a runtime message so the side-panel (or any
 * listener) can surface it. See RETRO_uniswap_swap_dropped_tx.md.
 *
 * Two delivery mechanisms:
 *   - Short delays (< 30s): setTimeout. Best-effort; only fires if the
 *     MV3 service worker is still alive. The 8s check usually hits while
 *     the SW is still warm from the broadcast.
 *   - Long delays (>= 30s): chrome.alarms. Survives SW suspension —
 *     the alarm wakes the SW, registering the listener at module load.
 *     Production minimum delay is 30s; we use 45s for the eviction probe.
 */
const DROP_CHECK_ALARM_PREFIX = 'eth-drop-check-';

const performDropCheck = async (hash: string, scheduledDelayMs: number) => {
  try {
    const provider = await getProvider();
    const tx = await provider.getTransaction(hash);
    if (tx == null) {
      console.warn(
        `[DROP-CHECK] tx ${hash} not visible on RPC ~${scheduledDelayMs}ms after broadcast — likely underpriced and evicted from mempool. dApp polling will hang.`,
      );
      chrome.runtime
        .sendMessage({ action: 'tx_drop_warning', txHash: hash, delayMs: scheduledDelayMs })
        .catch(() => {});
    } else {
      console.log(
        `[DROP-CHECK] tx ${hash} visible on RPC at ~${scheduledDelayMs}ms (block=${tx.blockNumber ?? 'pending'})`,
      );
    }
  } catch (e) {
    console.warn('[DROP-CHECK] failed to query tx', hash, e);
  }
};

const scheduleDropCheck = (hash: string, delayMs: number) => {
  if (delayMs < 30_000) {
    setTimeout(() => performDropCheck(hash, delayMs), delayMs);
    return;
  }
  // Encode delay in alarm name so the listener can recover it without
  // a separate storage round-trip. Alarms are unique by name; suffixing
  // with delayMs lets us schedule multiple checks for the same hash.
  const alarmName = `${DROP_CHECK_ALARM_PREFIX}${hash}-${delayMs}`;
  try {
    chrome.alarms.create(alarmName, { when: Date.now() + delayMs });
  } catch (e) {
    console.warn('[DROP-CHECK] alarm scheduling failed, falling back to setTimeout:', e);
    setTimeout(() => performDropCheck(hash, delayMs), delayMs);
  }
};

// Registered at module load — re-runs on every service-worker startup,
// which is exactly when the alarm fires and wakes the SW.
if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (!alarm.name.startsWith(DROP_CHECK_ALARM_PREFIX)) return;
    const rest = alarm.name.slice(DROP_CHECK_ALARM_PREFIX.length);
    const lastDash = rest.lastIndexOf('-');
    if (lastDash <= 0) return;
    const hash = rest.slice(0, lastDash);
    const delayMs = Number(rest.slice(lastDash + 1));
    void performDropCheck(hash, Number.isFinite(delayMs) ? delayMs : 0);
  });
}

const broadcastTransaction = async (signedTx: string, expectedFrom?: string) => {
  const tag = TAG + ' | broadcastTransaction | ';
  try {
    const provider = await getProvider();

    console.log(tag, 'provider: ', provider);
    console.log(`[HANDOFF] BEX → RPC (broadcast) signedTx=${signedTx}`);

    // Decode-and-recover BEFORE broadcast. ethers' `Transaction.from(...)` parses
    // the serialized RLP and exposes `.from` as the ECDSA-recovered signer. If
    // any of {chainId encoding, type-2 envelope, v/r/s} is malformed by the
    // signing pipeline, the recovered address will be a deterministic-but-wrong
    // address — *not* the user's. Fail closed before broadcast: an RPC that
    // accepts the bytes against the wrong account is the worst outcome (funds
    // move from a wallet the user doesn't control). See
    // RETRO_uniswap_swap_dropped_tx.md and feedback_eip712_diagnosis.md.
    let recoveredFrom: string | null = null;
    let signerMismatch = false;
    try {
      const parsed = Transaction.from(signedTx);
      recoveredFrom = parsed.from ?? null;
      const expectedNorm = expectedFrom ? expectedFrom.toLowerCase() : null;
      const recoveredNorm = recoveredFrom ? recoveredFrom.toLowerCase() : null;
      const match = expectedNorm && recoveredNorm ? expectedNorm === recoveredNorm : null;
      console.log(
        `[DECODE] signed tx parsed:\n` +
          `  type=${parsed.type} chainId=${parsed.chainId} nonce=${parsed.nonce}\n` +
          `  to=${parsed.to} value=${parsed.value?.toString()} gasLimit=${parsed.gasLimit?.toString()}\n` +
          `  maxFeePerGas=${parsed.maxFeePerGas?.toString()} maxPriorityFeePerGas=${parsed.maxPriorityFeePerGas?.toString()} gasPrice=${parsed.gasPrice?.toString()}\n` +
          `  data=${parsed.data?.slice(0, 80)}${(parsed.data?.length ?? 0) > 80 ? '…' : ''}\n` +
          `  recoveredFrom=${recoveredFrom ?? '(no signature)'} expectedFrom=${expectedFrom ?? '(unknown)'} match=${match}\n` +
          `  hash=${parsed.hash} signature=${JSON.stringify(parsed.signature?.toJSON())}`,
      );
      signerMismatch = match === false;
    } catch (decodeErr) {
      console.warn(`[DECODE] failed to parse signed tx — bytes are likely malformed:`, decodeErr);
    }

    if (signerMismatch) {
      const msg = `Refusing to broadcast: recovered signer ${recoveredFrom} ≠ expected ${expectedFrom}. The signed bytes do not represent a tx from your account.`;
      console.error(`[DECODE] ❌ MALFORMED-HEX ${msg}`);
      throw createProviderRpcError(4000, msg);
    }

    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log(
      `[HANDOFF] RPC → BEX (broadcast result) hash=${txResponse?.hash} from=${txResponse?.from} nonce=${txResponse?.nonce} to=${txResponse?.to}`,
    );
    // Two-stage drop check: 8s catches "never landed in mempool" cases;
    // 45s catches "landed briefly then evicted" — the user's real failure
    // mode. Fire-and-forget; do not block the dApp response.
    if (txResponse?.hash) {
      scheduleDropCheck(txResponse.hash, 8_000);
      scheduleDropCheck(txResponse.hash, 45_000);
    }
    return txResponse.hash;
  } catch (e) {
    console.error(tag, e);

    // Already a ProviderRpcError (e.g. our signer-mismatch fail-closed) —
    // pass through so the dApp sees the precise reason instead of a wrapped
    // "Error broadcasting transaction: ...".
    if (e && typeof (e as { code?: unknown }).code === 'number') throw e;

    const errorMessage = e?.message || JSON.stringify(e);

    if (errorMessage.includes('insufficient funds')) {
      throw createProviderRpcError(4000, 'Insufficient balance to complete this transaction.');
    } else if (errorMessage.includes('nonce too low')) {
      throw createProviderRpcError(4000, 'Transaction nonce conflict. Please try again.');
    } else if (errorMessage.includes('replacement transaction underpriced')) {
      throw createProviderRpcError(4000, 'Transaction fee too low. Try with a higher gas price.');
    } else if (errorMessage.includes('gas required exceeds')) {
      throw createProviderRpcError(4000, 'Transaction requires more gas than available.');
    } else if (errorMessage.includes('timeout')) {
      throw createProviderRpcError(4000, 'Network timeout. Please try again.');
    }

    throw createProviderRpcError(4000, `Error broadcasting transaction: ${errorMessage}`);
  }
};

/**
 * Apply the user's fee-warning choice if the side-panel banner attached one
 * to the approval event. 'dapp' = no override; 'suggested' = use the wallet's
 * bumped values; 'custom' = use the user-typed values. Reading from storage
 * (not param plumbing) so the side-panel UI can mutate the choice
 * asynchronously without changing handler signatures.
 */
type EvmTxRequest = {
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  [key: string]: unknown;
};

const applyFeeChoiceFromStorage = async (transaction: EvmTxRequest, id: string, tag: string) => {
  try {
    const storedEvent = await requestStorage.getEventById(id);
    const feeChoice: FeeChoice | undefined = storedEvent?.feeChoice;
    if (feeChoice && feeChoice.source !== 'dapp' && storedEvent?.feeWarning) {
      const w = storedEvent.feeWarning as FeeWarning;
      if (feeChoice.source === 'suggested') {
        transaction.maxFeePerGas = w.suggestedMaxFeePerGas;
        transaction.maxPriorityFeePerGas = w.suggestedMaxPriorityFeePerGas;
      } else if (feeChoice.source === 'custom') {
        if (feeChoice.customMaxFeePerGas) transaction.maxFeePerGas = feeChoice.customMaxFeePerGas;
        if (feeChoice.customMaxPriorityFeePerGas)
          transaction.maxPriorityFeePerGas = feeChoice.customMaxPriorityFeePerGas;
      }
      console.log(
        tag,
        `fee override applied (${feeChoice.source}): maxFee=${transaction.maxFeePerGas} priority=${transaction.maxPriorityFeePerGas}`,
      );
    }
  } catch (e) {
    console.warn(tag, 'failed to read feeChoice from storage:', e);
  }
};

const sendTransaction = async (params: any, KEEPKEY_WALLET: any, ADDRESS: string, id: string) => {
  const tag = ' | sendTransaction | ';
  try {
    console.log(tag, 'User accepted the request');
    console.log(tag, 'transaction:', params);
    const transaction = params[0];
    const currentProvider = await web3ProviderStorage.getWeb3Provider();
    const chainId = currentProvider.chainId;

    transaction.chainId = chainId;
    transaction.from = ADDRESS;

    await applyFeeChoiceFromStorage(transaction, id, tag);

    const signedTx = await signTransaction(transaction, KEEPKEY_WALLET);
    console.log(tag, 'signedTx:', signedTx);

    const txHash = await broadcastTransaction(signedTx, transaction.from);
    console.log(tag, 'txHash:', txHash);

    const response = await requestStorage.getEventById(id);
    console.log(tag, 'response:', response);

    response.txid = txHash;
    await requestStorage.updateEventById(id, response);

    //push event
    chrome.runtime.sendMessage({
      action: 'transaction_complete',
      eventId: id,
      txHash: txHash,
      explorerTxLink: currentProvider.explorerTxLink,
      networkId: currentProvider.networkId,
    });

    return txHash;
  } catch (e) {
    console.error(e);
    throw createProviderRpcError(4000, 'Error sending transaction', e);
  }
};
