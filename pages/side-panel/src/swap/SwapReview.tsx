// SwapReview — explicit confirmation stage between the input screen and the
// device signing. The headless vault /execute drives the device straight to a
// signing prompt, so the BEX shows the full quote here first and only calls
// execute on Confirm. Visual is ported from the design's signature-request card.
import React from 'react';
import type { SwapTheme } from './theme';
import type { UiAsset, SwapQuote } from './types';
import { Icon, I } from './icons';
import { IconBtn, PrimaryBtn, TokenGlyph, fmtCrypto } from './ui';

export function SwapReview({
  T,
  from,
  to,
  amount,
  quote,
  onBack,
  onConfirm,
}: {
  T: SwapTheme;
  from: UiAsset;
  to: UiAsset;
  amount: string;
  quote: SwapQuote;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const provider = quote.swapper || quote.integration;
  const out = parseFloat(quote.expectedOutput) || 0;
  const inAmt = parseFloat(amount) || 0;
  const rate = inAmt > 0 ? out / inAmt : 0;

  const details: Array<[string, string]> = [
    ['Route', provider || '—'],
    ['Rate', `1 ${from.symbol} ≈ ${rate ? (rate < 1 ? rate.toFixed(6) : rate.toFixed(5)) : '—'} ${to.symbol}`],
    ['Min. received', `${quote.minimumOutput} ${to.symbol}`],
    ['Slippage', `${((quote.slippageBps || 0) / 100).toFixed(2)}%`],
    ['Fee', `${((quote.fees?.totalBps || 0) / 100).toFixed(2)}%`],
    ['Est. time', `~${Math.max(1, Math.round((quote.estimatedTime || 0) / 60))} min`],
  ];

  return (
    <div
      style={{
        minHeight: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 14px 16px',
        gap: 12,
        animation: 'kk-rise .3s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconBtn T={T} onClick={onBack}>
          <Icon d={I.left} />
        </IconBtn>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Review Swap</div>
        {provider && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: T.accentDim,
              border: `1px solid ${T.accentEdge}`,
              color: T.accent,
              fontSize: 11,
              fontWeight: 600,
            }}>
            <Icon d={I.bolt} size={12} /> {provider}
          </div>
        )}
      </div>

      {/* Pay / receive summary */}
      <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${T.line}`, background: T.surface }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderRadius: 10,
            background: T.bg,
            border: `1px solid ${T.line}`,
          }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: T.faint, letterSpacing: '.1em' }}>YOU PAY</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <TokenGlyph asset={from} size={22} />
              <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
                {amount} {from.symbol}
              </span>
            </div>
          </div>
          <Icon d={I.chev} size={16} style={{ color: T.faint, flexShrink: 0 }} />
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{ fontSize: 10, color: T.faint, letterSpacing: '.1em' }}>YOU RECEIVE</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: T.good }}>
                ≈ {out ? (out < 1 ? out.toFixed(6) : out.toFixed(4)) : '0.0'} {to.symbol}
              </span>
              <TokenGlyph asset={to} size={22} />
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div style={{ padding: '4px 14px', borderRadius: 14, border: `1px solid ${T.line}`, background: T.surface }}>
        {details.map(([k, v], i) => (
          <div
            key={k}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '9px 0',
              borderBottom: i < details.length - 1 ? `1px solid ${T.line}` : 'none',
              fontSize: 12,
            }}>
            <span style={{ color: T.faint, flexShrink: 0 }}>{k}</span>
            <span
              className="mono"
              style={{ color: T.text, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v}
            </span>
          </div>
        ))}
      </div>

      {quote.warning && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(224,180,80,0.08)',
            border: `1px solid ${T.warn}`,
            color: T.warn,
            fontSize: 12,
          }}>
          {quote.warning}
        </div>
      )}

      {/* Device verify hint */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 14,
          border: `1px solid ${T.accentEdge}`,
          background: T.accentDim,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: T.accent,
            color: '#0b0d10',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
          <Icon d={I.shield} size={14} />
        </div>
        <div style={{ fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: T.text }}>Next: verify on your KeepKey</div>
          <div style={{ color: T.dim, fontSize: 11 }}>You'll confirm every detail on-device before it signs.</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 6 }} />

      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryBtn T={T} ghost onClick={onBack} icon={<Icon d={I.left} size={13} />}>
          Back
        </PrimaryBtn>
        <PrimaryBtn T={T} onClick={onConfirm} icon={<Icon d={I.swap} size={14} />}>
          Confirm Swap
        </PrimaryBtn>
      </div>
    </div>
  );
}
