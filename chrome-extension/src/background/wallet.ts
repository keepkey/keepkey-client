/**
 * Direct keepkey-vault-sdk wallet wrapper.
 * Replaces Pioneer SDK for signing, address derivation, and pubkey management.
 */
import { KeepKeySdk } from 'keepkey-vault-sdk';
import { getDefaultPaths, type PathConfig } from './chainConfig';
import { keepKeyApiKeyStorage, pubkeyStorage } from '@extension/storage';

const TAG = ' | wallet | ';

export interface WalletState {
  sdk: any; // KeepKeySdk instance
  pubkeys: any[];
  paths: PathConfig[];
  deviceInfo: { label: string; model: string; deviceId: string; features?: any } | null;
  initialized: boolean;
}

const state: WalletState = {
  sdk: null,
  pubkeys: [],
  paths: [],
  deviceInfo: null,
  initialized: false,
};

/**
 * Initialize the vault SDK, pair with the device, and fetch pubkeys.
 */
export async function init(): Promise<WalletState> {
  const tag = TAG + ' | init | ';
  try {
    console.log(tag, 'Initializing wallet...');

    // Load cached API key
    const savedApiKey = (await keepKeyApiKeyStorage.getApiKey()) || undefined;
    console.log(tag, 'Saved API key:', savedApiKey ? 'found' : 'none');

    // Create SDK instance
    const sdk = await KeepKeySdk.create({
      apiKey: savedApiKey,
      baseUrl: 'http://localhost:1646',
      serviceName: 'KeepKey Browser Extension',
      serviceImageUrl: 'https://api.keepkey.info/coins/keepkey.png',
    });

    state.sdk = sdk;

    // Save new API key if it changed
    const newApiKey = sdk.getClient?.()?.getApiKey?.() || savedApiKey;
    if (newApiKey && newApiKey !== savedApiKey) {
      console.log(tag, 'Saving new API key');
      await keepKeyApiKeyStorage.saveApiKey(newApiKey);
    }

    // Get device features
    try {
      const features = await sdk.system.info.getFeatures();
      state.deviceInfo = {
        label: features.label || 'KeepKey',
        model: features.model || 'KeepKey',
        deviceId: features.device_id || 'unknown',
        features,
      };
      console.log(tag, 'Device:', state.deviceInfo.label, 'Model:', state.deviceInfo.model);
    } catch (e) {
      console.warn(tag, 'Could not get device features:', e);
      state.deviceInfo = { label: 'KeepKey', model: 'KeepKey', deviceId: 'unknown' };
    }

    // Set up paths
    state.paths = getDefaultPaths();

    // Fetch pubkeys from device
    await fetchPubkeys();

    state.initialized = true;
    console.log(tag, 'Wallet initialized with', state.pubkeys.length, 'pubkeys');

    return state;
  } catch (e) {
    console.error(tag, 'Init failed:', e);
    throw e;
  }
}

/**
 * Fetch pubkeys from the vault device using batch endpoint.
 */
async function fetchPubkeys(): Promise<void> {
  const tag = TAG + ' | fetchPubkeys | ';
  try {
    // Load cached pubkeys first
    let cachedPubkeys: any[] = [];
    try {
      const cacheEnabled = await pubkeyStorage.isCacheEnabled();
      if (cacheEnabled) {
        const cached = await pubkeyStorage.loadPubkeys();
        if (cached && cached.pubkeys.length > 0) {
          cachedPubkeys = cached.pubkeys;
          console.log(tag, 'Loaded', cachedPubkeys.length, 'cached pubkeys');
        }
      }
    } catch (e) {
      console.warn(tag, 'Could not load cached pubkeys:', e);
    }

    // Try batch pubkey endpoint
    const batchPaths = state.paths.map(p => ({
      address_n: p.addressNList,
      script_type: p.script_type,
      coin: p.symbol || undefined,
      type: p.type as 'xpub' | 'address',
      networks: p.networks,
      note: p.note,
    }));

    console.log(tag, 'Requesting', batchPaths.length, 'pubkeys from device...');
    const result = await state.sdk.xpub.getPublicKeys(batchPaths);
    console.log(tag, 'Got', result.pubkeys?.length, 'pubkeys from device');

    if (result.pubkeys && result.pubkeys.length > 0) {
      // Enrich pubkeys with accountIndex from path configs (SDK may strip unknown fields)
      for (const pk of result.pubkeys) {
        if (pk.accountIndex !== undefined) continue; // already set
        const matchingPath = state.paths.find(p => p.note === pk.note);
        if (matchingPath?.accountIndex !== undefined) {
          pk.accountIndex = matchingPath.accountIndex;
        }
      }
      state.pubkeys = result.pubkeys;
    } else if (cachedPubkeys.length > 0) {
      console.log(tag, 'Using cached pubkeys as fallback');
      state.pubkeys = cachedPubkeys;
    }

    // Save to cache
    if (state.pubkeys.length > 0 && state.deviceInfo) {
      try {
        await pubkeyStorage.savePubkeys(state.pubkeys, state.deviceInfo);
        console.log(tag, 'Cached', state.pubkeys.length, 'pubkeys');
      } catch (e) {
        console.warn(tag, 'Failed to cache pubkeys:', e);
      }
    }
  } catch (e) {
    console.error(tag, 'Error fetching pubkeys:', e);
    throw e;
  }
}

/**
 * Get the SDK instance, re-initializing if needed.
 */
export function getSdk(): any {
  if (!state.sdk) {
    throw new Error('Wallet not initialized. Call wallet.init() first.');
  }
  return state.sdk;
}

/**
 * Get pubkeys, optionally filtered by network.
 */
export function getPubkeys(networkId?: string): any[] {
  if (!networkId) return state.pubkeys;
  return state.pubkeys.filter((pk: any) => pk.networks && pk.networks.includes(networkId));
}

/**
 * Get the first address for a given network.
 */
export function getAddressForNetwork(networkId: string): string | undefined {
  const pks = getPubkeys(networkId);
  return pks.length > 0 ? pks[0].address : undefined;
}

/**
 * Get paths, optionally add new ones.
 */
export function getPaths(): PathConfig[] {
  return state.paths;
}

export function addPath(path: PathConfig): void {
  state.paths.push(path);
}

/**
 * Re-fetch pubkeys (e.g., after adding a new path).
 */
export async function refreshPubkeys(): Promise<any[]> {
  await fetchPubkeys();
  return state.pubkeys;
}

/**
 * Check if the wallet is initialized and has a working SDK connection.
 */
export function isInitialized(): boolean {
  return state.initialized && !!state.sdk;
}

/**
 * Get device info.
 */
export function getDeviceInfo() {
  return state.deviceInfo;
}

/**
 * Get the full wallet state (for backward compat with APP references).
 */
export function getState(): WalletState {
  return state;
}
