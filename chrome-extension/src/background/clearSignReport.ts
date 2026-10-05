import { keepKeyApiKeyStorage } from '@extension/storage';
import * as wallet from './wallet';

const VAULT_URL = 'http://localhost:1646';
const REPORT_TIMEOUT_MS = 20_000;

export type ClearSignProtectionLevel = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
export type EffectSeverity = 'info' | 'warning' | 'danger';

export interface EffectFinding {
  code: string;
  message: string;
  severity: EffectSeverity;
}

export interface ClearSignReport {
  version: number;
  generatedAt: number;
  chain: 'Ethereum' | 'Solana';
  transactionFingerprint: string;
  protectionLevel: ClearSignProtectionLevel;
  headline: string;
  descriptor: {
    source: 'none' | 'native' | 'erc7730' | 'runtime' | 'certified';
    authenticated: boolean;
    format?: string;
    label?: string;
    artifactHash?: string;
    codeIdentityBound?: boolean;
    expiresAt?: number;
    resolution?: string;
  };
  simulation: {
    status: 'success' | 'revert' | 'incomplete' | 'unavailable';
    stateReference: { blockOrSlot?: string; endpoint: string };
    assetChanges: Array<{
      asset: { kind: 'native' | 'token' | 'nft'; id: string; symbol?: string; decimals?: number };
      account: string;
      delta: string;
      confidence: 'observed' | 'inferred' | 'unknown';
    }>;
    authorityChanges: Array<{
      kind: string;
      assetOrAccount: string;
      authority: string;
      value?: string;
      unlimited?: boolean;
      revoked?: boolean;
      confidence: 'observed' | 'inferred' | 'unknown';
    }>;
    invokedCode: Array<{ address: string; codeHash?: string; invocation: string }>;
    warnings: EffectFinding[];
    unknowns: EffectFinding[];
    fee?: { asset: string; amount: string };
    completeness: Record<string, string>;
  };
  findings: EffectFinding[];
  limitations: EffectFinding[];
  claims: Array<{
    source: 'transaction-bytes' | 'authenticated-definition' | 'simulation';
    statement: string;
  }>;
  deviceVerification?: {
    status: 'not-attempted' | 'verified' | 'rejected' | 'unsupported' | 'error';
    firmwareVersion?: string;
    signerFingerprint?: string;
    metadataFormat?: string;
  };
  [key: string]: unknown;
}

export type ClearSignReportRequest =
  | {
      chain: 'evm';
      chainId: number;
      from: string;
      to?: string;
      data?: string;
      value?: string;
      nonce?: string;
      gas?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    }
  | { chain: 'solana'; raw_tx: string; owner: string };

async function getApiKey(): Promise<string> {
  const sdkKey = wallet.getSdk?.()?.getClient?.()?.getApiKey?.();
  const key = sdkKey || (await keepKeyApiKeyStorage.getApiKey());
  if (!key) throw new Error('Vault pairing token is unavailable');
  return key;
}

function isReport(value: any): value is ClearSignReport {
  return (
    value &&
    (value.version === 1 || value.version === 2) &&
    typeof value.transactionFingerprint === 'string' &&
    /^P[0-5]$/.test(value.protectionLevel) &&
    typeof value.headline === 'string' &&
    value.simulation &&
    Array.isArray(value.findings) &&
    Array.isArray(value.limitations) &&
    Array.isArray(value.claims)
  );
}

/** Fetch Vault's canonical, read-only report. No protocol decoding belongs here. */
export async function getClearSignReport(request: ClearSignReportRequest): Promise<ClearSignReport> {
  const response = await fetch(`${VAULT_URL}/clearsign/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getApiKey()}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Vault report failed: HTTP ${response.status}`);
  if (!isReport(body)) throw new Error('Vault returned an unsupported ClearSign report');
  return body;
}

export type ClearSignVerification = 'verified' | 'unverified';

/**
 * Compare the report the user approved with the one the vault returns from
 * signing. A mismatch throws (the signed tx is not what was shown — never
 * broadcast it). A missing report on either side is NOT a pass: the vault
 * omits it when it could not build one, so the result is 'unverified'.
 */
export function assertMatchingClearSignReport(
  preflight: ClearSignReport | undefined,
  final: any,
): ClearSignVerification {
  if (!preflight || !final?.transactionFingerprint) return 'unverified';
  if (final.transactionFingerprint !== preflight.transactionFingerprint) {
    throw new Error('ClearSign fingerprint changed between approval and signing');
  }
  return 'verified';
}
