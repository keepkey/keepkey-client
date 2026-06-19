// SwapProgress — the "Swap Submitted!" view. Faithful port of the design, but
// the timeline/status are driven by the real txid + polled SwapHistoryRecord
// instead of the mock interval.
import React, { useEffect, useState } from 'react';
import type { SwapTheme } from './theme';
import type { UiAsset, SwapHistoryRecord, SwapTrackingStatus } from './types';
import { Icon, I } from './icons';
import { PrimaryBtn, TokenGlyph, SwapEmblem, SwapTimeline } from './ui';

const PROG: Record<SwapTrackingStatus, number> = {
  signing: 0.04,
  pending: 0.12,
  confirming: 0.3,
  output_detected: 0.5,
  output_confirming: 0.72,
  output_confirmed: 1,
  completed: 1,
  failed: 0.5,
  refunded: 0.5,
};

export function SwapProgress({
  T,
  from,
  to,
  fromAmount,
  expectedOutput,
  provider,
  txid,
  status,
  estimatedTime,
  onNewSwap,
  onClose,
}: {
  T: SwapTheme;
  from: UiAsset;
  to: UiAsset;
  fromAmount: string;
  expectedOutput: string;
  provider?: string;
  txid: string;
  status: SwapHistoryRecord | null;
  estimatedTime?: number;
  onNewSwap: () => void;
  onClose: () => void;
}) {
  const st = status?.status;
  const prog = st ? PROG[st] : 0.04;
  const done = st === 'completed' || st === 'output_confirmed';
  const failed = st === 'failed' || st === 'refunded';
  const [copied, setCopied] = useState(false);
  const [secs, setSecs] = useState(estimatedTime && estimatedTime > 0 ? estimatedTime : 540);

  useEffect(() => {
    if (done || failed) return;
    const t = setInterval(() => setSecs(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [done, failed]);

  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const outNum = parseFloat(expectedOutput) || 0;

  const headline = failed
    ? st === 'refunded'
      ? 'Swap Refunded'
      : 'Swap Failed'
    : done
      ? 'Swap Complete!'
      : 'Swap Submitted!';
  const sub = failed
    ? status?.refundReason || 'The swap did not complete.'
    : done
      ? 'Funds have arrived.'
      : 'Waiting for confirmations — not complete yet';
  const subColor = failed ? T.bad : done ? T.good : T.warn;

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        animation: 'kk-rise .3s',
      }}>
      <div style={{ textAlign: 'center', position: 'relative' }}>
        {provider && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              color: T.accent,
              fontWeight: 600,
            }}>
            <Icon d={I.bolt} size={11} /> {provider}
          </div>
        )}
        <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
          {headline}
        </div>
        <div className="mono" style={{ fontSize: 12, color: subColor, marginTop: 6 }}>
          {sub}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: '18px 14px 16px',
          borderRadius: 16,
          background: `radial-gradient(120% 100% at 50% 0%, ${T.accentDim}, transparent 60%), ${T.surface}`,
          border: `1px solid ${T.line}`,
        }}>
        <SwapEmblem T={T} from={from} to={to} />
        <div style={{ marginTop: 16 }}>
          <SwapTimeline T={T} prog={prog} />
        </div>
      </div>

      {!done && !failed && (
        <div
          style={{
            marginTop: 10,
            padding: '12px 16px',
            borderRadius: 12,
            background: T.surface,
            border: `1px solid ${T.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}>
          <Icon d={I.refresh} size={14} style={{ color: T.good }} />
          <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: T.good }}>
            {mm}:{ss}
          </span>
          <span className="mono" style={{ fontSize: 11, color: T.faint }}>
            Est. time
          </span>
        </div>
      )}

      {/* Pair card */}
      <div
        style={{
          marginTop: 10,
          padding: 16,
          borderRadius: 14,
          background: T.surface,
          border: `1px solid ${T.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <TokenGlyph asset={from} size={36} />
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {fromAmount} {from.symbol}
            </div>
          </div>
        </div>
        <Icon d={I.chev} size={16} style={{ color: T.accent, flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, justifyContent: 'flex-end' }}>
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: T.good }}>
              {status?.receivedOutput
                ? `${parseFloat(status.receivedOutput) < 1 ? parseFloat(status.receivedOutput).toFixed(8) : parseFloat(status.receivedOutput).toFixed(4)}`
                : `~${outNum < 1 ? outNum.toFixed(8) : outNum.toFixed(4)}`}{' '}
              {to.symbol}
            </div>
          </div>
          <TokenGlyph asset={to} size={36} />
        </div>
      </div>

      {/* Tx hash */}
      <div
        style={{
          marginTop: 10,
          padding: '12px 14px',
          borderRadius: 12,
          background: T.surface,
          border: `1px solid ${T.line}`,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: T.faint }}>
            Tx
          </span>
          <span
            className="mono"
            style={{
              flex: 1,
              fontSize: 11,
              color: T.dim,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {txid}
          </span>
          <button
            onClick={() => {
              if (navigator.clipboard) navigator.clipboard.writeText(txid);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mono"
            style={{
              background: 'transparent',
              border: 'none',
              color: T.accent,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {status?.outboundTxid && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: T.faint }}>
              Out
            </span>
            <span
              className="mono"
              style={{
                flex: 1,
                fontSize: 11,
                color: T.dim,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {status.outboundTxid}
            </span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 10 }} />

      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryBtn T={T} ghost onClick={onNewSwap}>
          New Swap
        </PrimaryBtn>
        <PrimaryBtn T={T} onClick={onClose}>
          Close
        </PrimaryBtn>
      </div>
    </div>
  );
}
