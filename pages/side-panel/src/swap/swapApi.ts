// Side-panel → background bridge for the native swap flow.
// The side panel can't fetch localhost:1646 directly, so every call goes through
// the background service worker (SWAP_REQUEST), which holds the paired vault
// bearer key. See chrome-extension/src/background/swapHandler.ts.
import type { SwapAsset, SwapQuote, SwapQuoteParams, ExecuteSwapParams, SwapResult, SwapHistoryRecord } from './types';

interface SwapResponse {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

function send(action: string, payload: Record<string, unknown> = {}): Promise<SwapResponse> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'SWAP_REQUEST', action, ...payload }, (resp: SwapResponse) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, status: 0, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, status: 0, error: 'No response from background' });
        }
      });
    } catch (e: any) {
      resolve({ ok: false, status: 0, error: e?.message || String(e) });
    }
  });
}

export async function fetchSwapAssets(): Promise<SwapAsset[]> {
  const r = await send('assets');
  if (!r.ok) throw new Error(r.error || 'Failed to load swap assets');
  return (r.data as SwapAsset[]) || [];
}

export async function fetchSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
  const r = await send('quote', { params });
  if (!r.ok) throw new Error(r.error || 'Failed to get quote');
  return r.data as SwapQuote;
}

export async function executeSwap(params: ExecuteSwapParams): Promise<SwapResult> {
  const r = await send('execute', { params });
  if (!r.ok) throw new Error(r.error || 'Swap failed');
  return r.data as SwapResult;
}

export async function fetchSwapStatus(txid: string): Promise<SwapHistoryRecord | null> {
  const r = await send('status', { txid });
  if (!r.ok) return null; // 404 until the record is written / passphrase session
  return r.data as SwapHistoryRecord;
}

export interface SwapHistoryQuery {
  status?: string;
  limit?: number;
  offset?: number;
}

/** Swap history from the vault tracker DB. Empty list when unavailable
 *  (endpoint missing / passphrase wallet / no swaps yet) — never throws. */
export async function fetchSwapHistory(params: SwapHistoryQuery = {}): Promise<SwapHistoryRecord[]> {
  const r = await send('history', { params });
  if (!r.ok) return [];
  const data = r.data as any;
  return (data?.entries as SwapHistoryRecord[]) || [];
}
