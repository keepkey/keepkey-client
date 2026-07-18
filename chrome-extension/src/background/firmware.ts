/**
 * Shared firmware-version gate for the message-signing endpoints
 * (Tron TIP-191/TIP-712, TON Ed25519, Solana off-chain).
 *
 * The hdwallet methods + REST endpoints landed in the vault commit
 * `7e6dfc9 feat(rpc,sdk,rest): expose 5 new message-signing methods`
 * and depend on firmware that ships those types. Anything older than
 * 7.14.1 returns Failure_UnknownMessage and the user has no useful
 * recovery path other than upgrading — surface that as a clean error
 * before we round-trip the device.
 *
 * 7.14.0 was an internal stop-gap that was never released; treat the
 * minimum as 7.14.1 to avoid handing users a "supported" device that
 * actually ignores half these methods.
 */
import * as wallet from './wallet';
import { createProviderRpcError } from './utils';

const REQUIRED = { major: 7, minor: 14, patch: 1 } as const;
// Hive (SLIP-0048 keys + Graphene transfer signing) shipped in 7.15.0;
// anything older returns Failure_UnknownMessage for the Hive message types.
const REQUIRED_HIVE = { major: 7, minor: 15, patch: 0 } as const;

export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Cheap, non-probing read of the connected device's firmware version for UI
 * gating (the add-blockchain picker locks firmware-gated chains). Returns null
 * if the version isn't known yet — callers should treat null as "not met".
 */
export function getCachedFirmwareVersion(): FirmwareVersion | null {
  return parseVersion(wallet.getDeviceInfo()?.features);
}

/** Vault REST returns snake_case (see formatFeatures); raw hdwallet uses camelCase. */
function parseVersion(features: any): FirmwareVersion | null {
  if (!features) return null;
  const major = Number(features.major_version ?? features.majorVersion);
  const minor = Number(features.minor_version ?? features.minorVersion);
  const patch = Number(features.patch_version ?? features.patchVersion);
  if (![major, minor, patch].every(Number.isFinite)) return null;
  return { major, minor, patch };
}

function meetsMin(v: FirmwareVersion, min: FirmwareVersion = REQUIRED): boolean {
  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
}

async function readVersion(): Promise<FirmwareVersion | null> {
  const cached = parseVersion(wallet.getDeviceInfo()?.features);
  if (cached) return cached;
  // Cache miss (cold start, just-reconnected device) — force a probe.
  await wallet.probeDevice();
  return parseVersion(wallet.getDeviceInfo()?.features);
}

/**
 * Throw a user-facing error if the connected KeepKey is on firmware
 * older than 7.14.1. Use `label` to identify the call site in the
 * error message (e.g. "Tron message signing").
 */
export async function requireMessageSigningFirmware(label: string): Promise<void> {
  const v = await readVersion();
  if (!v) {
    throw createProviderRpcError(
      -32603,
      `${label} requires firmware 7.14.1 — could not read device firmware version. Plug in your KeepKey and try again.`,
    );
  }
  if (!meetsMin(v)) {
    throw createProviderRpcError(
      4200,
      `${label} requires firmware 7.14.1 or later. Your KeepKey is on ${v.major}.${v.minor}.${v.patch}. Update via the KeepKey Vault desktop app and retry.`,
    );
  }
}

/**
 * Throw a user-facing error if the connected KeepKey is on firmware
 * older than 7.15.0 (the release that ships Hive support).
 */
export async function requireHiveFirmware(label: string): Promise<void> {
  const v = await readVersion();
  if (!v) {
    throw createProviderRpcError(
      -32603,
      `${label} requires firmware 7.15.0 — could not read device firmware version. Plug in your KeepKey and try again.`,
    );
  }
  if (!meetsMin(v, REQUIRED_HIVE)) {
    throw createProviderRpcError(
      4200,
      `${label} requires firmware 7.15.0 or later. Your KeepKey is on ${v.major}.${v.minor}.${v.patch}. Update via the KeepKey Vault desktop app and retry.`,
    );
  }
}
