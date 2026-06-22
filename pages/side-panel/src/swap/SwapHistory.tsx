// SwapHistory — past swaps from the vault tracker DB (GET /api/v1/swaps).
// Read-only list; tapping a row could re-open tracking later. Degrades to an
// empty state when the endpoint is unavailable or the wallet has no swaps.
import React, { useEffect, useState } from 'react';
import { Spinner } from '@chakra-ui/react';
import type { SwapTheme } from './theme';
import type { SwapHistoryRecord } from './types';
import { fetchSwapHistory } from './swapApi';
import { Icon, I } from './icons';
import { IconBtn } from './ui';

const STATUS_COLOR = (T: SwapTheme, s: string) =>
  s === 'completed' || s === 'output_confirmed' ? T.good : s === 'failed' || s === 'refunded' ? T.bad : T.warn;

const STATUS_TEXT: Record<string, string> = {
  signing: 'Signing',
  pending: 'Pending',
  confirming: 'Confirming',
  output_detected: 'Output detected',
  output_confirming: 'Confirming output',
  output_confirmed: 'Confirmed',
  completed: 'Completed',
  failed: 'Failed',
  refunded: 'Refunded',
};

export function SwapHistory({ T, onBack }: { T: SwapTheme; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SwapHistoryRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchSwapHistory({ limit: 50 });
      if (!cancelled) {
        setRows(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 14px 16px',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <IconBtn T={T} onClick={onBack}>
          <Icon d={I.left} />
        </IconBtn>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Swap History</div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 60 }}>
          <Spinner color="kk.accent" />
          <div style={{ fontSize: 12, color: T.faint }}>Loading history…</div>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: T.faint, fontSize: 13, paddingTop: 60 }}>
          No swaps yet. Completed swaps will show up here.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
            return (
              <div
                key={r.txid}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: T.surface,
                  border: `1px solid ${T.line}`,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                    {(r.fromSymbol || '?') + ' → ' + (r.toSymbol || '?')}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 999,
                      color: STATUS_COLOR(T, r.status),
                      background: T.chip,
                    }}>
                    {STATUS_TEXT[r.status] || r.status}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 6,
                    fontSize: 11,
                    color: T.faint,
                  }}>
                  <span className="mono">
                    {r.fromAmount ? `${r.fromAmount} ${r.fromSymbol || ''}` : ''}
                    {r.receivedOutput
                      ? ` → ${r.receivedOutput} ${r.toSymbol || ''}`
                      : r.quotedOutput
                        ? ` → ~${r.quotedOutput} ${r.toSymbol || ''}`
                        : ''}
                  </span>
                  <span>{r.swapper || r.integration || ''}</span>
                </div>
                {when && <div style={{ marginTop: 4, fontSize: 10, color: T.faint }}>{when}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
