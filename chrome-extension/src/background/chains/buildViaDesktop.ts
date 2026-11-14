/**
 * Native-asset sends for the UTXO, cosmos-family and XRP handlers are built by
 * KeepKey Desktop (POST /api/v2/tx/build), never by a server. Desktop picks the
 * sender keys, UTXOs, change and fee itself and answers with the exact body for
 * one of its existing sign routes, so the handler signs what was built unchanged.
 */
import { readFromVault, VAULT_LOCKED_MESSAGE } from '../vaultDeviceAccess';
import { createProviderRpcError, createTimeoutError, VAULT_REQUIRED_MESSAGE } from '../utils';
import type { ProviderRpcError } from '../utils';

export const TX_BUILD_PATH = '/api/v2/tx/build';

export interface TxBuildRequest {
  caip: string;
  to: string;
  amount?: string;
  isMax?: boolean;
  memo?: string;
  accountIndex?: number;
}

export type TxBuildSignRoute =
  | '/utxo/sign-transaction'
  | '/cosmos/sign-amino'
  | '/osmosis/sign-amino'
  | '/thorchain/sign-amino-transfer'
  | '/mayachain/sign-amino-transfer'
  | '/xrp/sign-transaction';

export interface TxBuildSummary {
  to: string;
  amount: string;
  fee: string;
  symbol: string;
  memo?: string;
  destinationTag?: string;
}

export interface TxBuildResponse {
  signRoute: TxBuildSignRoute;
  signBody: any;
  summary: TxBuildSummary;
}

/** The Transfer form's params[0] → the six contract fields. Nothing else
 * (pubkeys, fee level, xpubs) is ever sent: Desktop derives the sender. */
export function toBuildRequest(caip: string, params: any): TxBuildRequest {
  const isMax = params?.isMax === true;
  const request: TxBuildRequest = { caip, to: params?.recipient, isMax };
  if (!isMax) request.amount = String(params?.amount?.amount ?? '');
  if (typeof params?.memo === 'string' && params.memo.trim()) request.memo = params.memo;
  if (typeof params?.accountIndex === 'number') request.accountIndex = params.accountIndex;
  return request;
}

/** User-facing text for a failed build. `status` is undefined when Desktop
 * could not be reached at all. */
export function buildErrorMessage(status: number | undefined, bodyText: string, chainName: string): string {
  if (!status) return VAULT_REQUIRED_MESSAGE;
  if (status === 404) return `Update KeepKey Desktop to send ${chainName} from the extension`;
  if (status === 423) return VAULT_LOCKED_MESSAGE;
  if (status === 401 || status === 403) {
    return 'KeepKey Desktop rejected the extension pairing. Re-pair the extension with KeepKey Desktop, then try again.';
  }
  try {
    const error = JSON.parse(bodyText)?.error;
    if (typeof error === 'string' && error) return error;
  } catch {
    // not JSON: fall through to the raw text
  }
  return bodyText.trim() || `KeepKey Desktop could not build the ${chainName} transaction (${status})`;
}

/** Map whatever readFromVault threw to the provider error the dApp sees. */
export function toBuildError(error: any, chainName: string): ProviderRpcError {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return createTimeoutError(`KeepKey Desktop did not finish building the ${chainName} transaction in time`);
  }
  if (typeof error?.status === 'number') {
    return createProviderRpcError(4000, buildErrorMessage(error.status, error.message ?? '', chainName));
  }
  // fetch() itself rejects with a TypeError when nothing listens on :1646.
  if (error instanceof TypeError) return createProviderRpcError(4000, buildErrorMessage(undefined, '', chainName));
  return createProviderRpcError(4000, error?.message || String(error));
}

export async function buildViaDesktop(
  sdk: any,
  caip: string,
  params: any,
  chainName: string,
): Promise<TxBuildResponse> {
  let build: TxBuildResponse;
  try {
    // Foreground: Desktop may derive the sender on the device (no button press).
    build = await readFromVault<TxBuildResponse>(sdk, TX_BUILD_PATH, toBuildRequest(caip, params), true);
  } catch (error) {
    throw toBuildError(error, chainName);
  }
  if (!build?.signRoute || !build.signBody || !build.summary) {
    throw createProviderRpcError(4000, `KeepKey Desktop returned an incomplete ${chainName} transaction`);
  }
  return build;
}
