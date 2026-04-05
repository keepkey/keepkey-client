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
  deviceConnected: boolean;
}

const state: WalletState = {
  sdk: null,
  pubkeys: [],
  paths: [],
  deviceInfo: null,
  initialized: false,
  deviceConnected: false,
};

/**
 * Probe the device via getFeatures(). Updates state.deviceConnected and state.deviceInfo.
 * Returns true if the device is reachable, false otherwise.
 */
export async function probeDevice(): Promise<boolean> {
  const tag = TAG + ' | probeDevice | ';
  if (!state.sdk) return false;
  try {
    const features = await state.sdk.system.info.getFeatures();
    state.deviceInfo = {
      label: features.label || 'KeepKey',
      model: features.model || 'KeepKey',
      deviceId: features.device_id || 'unknown',
      features,
    };
    state.deviceConnected = true;
    console.log(tag, 'Device present:', state.deviceInfo.label);
    return true;
  } catch (e) {
    state.deviceConnected = false;
    console.warn(tag, 'Device not reachable:', (e as Error)?.message || e);
    return false;
  }
}

/**
 * Initialize the vault SDK, probe for device, and load pubkeys (from device or cache).
 *
 * View-only mode: if the device is not connected but cached pubkeys exist, init still
 * succeeds. Signing will fail later until the device is reconnected.
 */
export async function init(): Promise<WalletState> {
  const tag = TAG + ' | init | ';
  try {
    console.log(tag, 'Initializing wallet...');

    // Load cached API key
    const savedApiKey = (await keepKeyApiKeyStorage.getApiKey()) || undefined;
    console.log(tag, 'Saved API key:', savedApiKey ? 'found' : 'none');

    // Create SDK instance (pairs with vault on localhost:1646; no device needed)
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

    // Probe device presence. If absent, fall back to cached device info.
    const deviceReachable = await probeDevice();
    if (!deviceReachable) {
      try {
        const cached = await pubkeyStorage.loadPubkeys();
        if (cached?.deviceInfo) {
          state.deviceInfo = cached.deviceInfo;
          console.log(tag, 'Using cached device info:', state.deviceInfo.label);
        }
      } catch {
        // ignore
      }
      if (!state.deviceInfo) {
        state.deviceInfo = { label: 'KeepKey', model: 'KeepKey', deviceId: 'unknown' };
      }
    }

    // Set up paths
    state.paths = getDefaultPaths();

    // Fetch pubkeys (device if reachable, otherwise cache)
    await fetchPubkeys();

    // Initialized if we have pubkeys — regardless of whether they came from device or cache
    state.initialized = state.pubkeys.length > 0;
    if (state.initialized) {
      const mode = state.deviceConnected ? '' : ' (view-only)';
      console.log(tag, `Wallet initialized${mode} with ${state.pubkeys.length} pubkeys`);
    } else {
      console.warn(tag, 'Wallet init completed but no pubkeys available (no device and no cache)');
    }

    return state;
  } catch (e) {
    console.error(tag, 'Init failed:', e);
    throw e;
  }
}

/**
 * Load pubkeys from storage (if cache enabled and entries exist).
 */
async function loadCachedPubkeys(): Promise<any[]> {
  const tag = TAG + ' | loadCachedPubkeys | ';
  try {
    const cacheEnabled = await pubkeyStorage.isCacheEnabled();
    if (!cacheEnabled) return [];
    const cached = await pubkeyStorage.loadPubkeys();
    if (cached?.pubkeys?.length) {
      console.log(tag, 'Loaded', cached.pubkeys.length, 'cached pubkeys');
      return cached.pubkeys;
    }
  } catch (e) {
    console.warn(tag, 'Could not load cached pubkeys:', e);
  }
  return [];
}

/**
 * Fetch pubkeys. Uses device if connected, falls back to cache otherwise.
 * Never throws on missing device — only throws if we have neither device nor cache.
 */
async function fetchPubkeys(): Promise<void> {
  const tag = TAG + ' | fetchPubkeys | ';
  const cachedPubkeys = await loadCachedPubkeys();

  // No device: use cache directly, no device call
  if (!state.deviceConnected) {
    if (cachedPubkeys.length > 0) {
      console.log(tag, 'No device — running view-only with', cachedPubkeys.length, 'cached pubkeys');
      state.pubkeys = cachedPubkeys;
      return;
    }
    console.warn(tag, 'No device and no cached pubkeys — wallet has nothing to serve');
    state.pubkeys = [];
    return;
  }

  // Device connected: query it
  const batchPaths = state.paths.map(p => ({
    address_n: p.addressNList,
    script_type: p.script_type,
    coin: p.symbol || undefined,
    type: p.type as 'xpub' | 'address',
    networks: p.networks,
    note: p.note,
  }));

  try {
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
      // Preserve dynamically-added pubkeys (e.g. Solana) that aren't part of the batch
      const batchNotes = new Set(state.paths.map(p => p.note));
      const dynamicPubkeys = state.pubkeys.filter(pk => !batchNotes.has(pk.note));
      state.pubkeys = [...result.pubkeys, ...dynamicPubkeys];

      // Save to cache
      if (state.deviceInfo) {
        try {
          await pubkeyStorage.savePubkeys(state.pubkeys, state.deviceInfo);
          console.log(tag, 'Cached', state.pubkeys.length, 'pubkeys');
        } catch (e) {
          console.warn(tag, 'Failed to cache pubkeys:', e);
        }
      }
    } else if (cachedPubkeys.length > 0) {
      console.log(tag, 'Device returned empty — using cached pubkeys');
      state.pubkeys = cachedPubkeys;
    }
  } catch (e) {
    console.error(tag, 'Error fetching pubkeys from device:', e);
    // Device call failed — downgrade to view-only and use cache if available
    state.deviceConnected = false;
    if (cachedPubkeys.length > 0) {
      console.warn(tag, 'Falling back to', cachedPubkeys.length, 'cached pubkeys (view-only)');
      state.pubkeys = cachedPubkeys;
      return;
    }
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
 * Append a pubkey entry to state and persist to cache. Used for addresses
 * derived outside of the batch xpub flow (e.g. Solana via solanaGetAddress).
 * Replaces any existing entry with the same `note`.
 */
export async function addPubkey(pubkey: any): Promise<void> {
  const tag = TAG + ' | addPubkey | ';
  // Dedupe by note
  const existingIdx = state.pubkeys.findIndex(pk => pk.note === pubkey.note);
  if (existingIdx >= 0) {
    state.pubkeys[existingIdx] = pubkey;
  } else {
    state.pubkeys.push(pubkey);
  }

  if (state.deviceInfo) {
    try {
      await pubkeyStorage.savePubkeys(state.pubkeys, state.deviceInfo);
      console.log(tag, 'Persisted pubkey:', pubkey.note);
    } catch (e) {
      console.warn(tag, 'Failed to persist pubkey:', e);
    }
  }
}

/**
 * Re-fetch pubkeys (e.g., after adding a new path). Re-probes the device
 * first if we were in view-only mode, so hot-plugging transparently upgrades.
 */
export async function refreshPubkeys(): Promise<any[]> {
  if (!state.deviceConnected) {
    await probeDevice();
  }
  await fetchPubkeys();
  state.initialized = state.pubkeys.length > 0;
  return state.pubkeys;
}

/**
 * Check if the wallet is initialized and has a working SDK connection.
 * Returns true in view-only mode (cached pubkeys, no device) as well.
 */
export function isInitialized(): boolean {
  return state.initialized && !!state.sdk;
}

/**
 * Whether a KeepKey device is currently reachable.
 * Tracks the most recent device probe — call probeDevice() to refresh.
 */
export function isDeviceConnected(): boolean {
  return state.deviceConnected;
}

/**
 * Guard for signing handlers. Re-probes the device, and throws with a
 * user-facing message if it's not available.
 */
export async function requireDevice(): Promise<void> {
  if (state.deviceConnected) return;
  const ok = await probeDevice();
  if (!ok) {
    throw new Error('KeepKey device not connected. Plug in your device and try again.');
  }
}

/**
 * Called when the vault reports a device has become reachable. Re-probes the
 * device and, if successful, re-fetches pubkeys so subsequent signing works.
 * Returns true if the wallet transitioned from view-only → live.
 */
export async function refreshFromDevice(): Promise<boolean> {
  if (state.deviceConnected) return false; // already live
  const ok = await probeDevice();
  if (!ok) return false;
  await fetchPubkeys();
  state.initialized = state.pubkeys.length > 0;
  return true;
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
