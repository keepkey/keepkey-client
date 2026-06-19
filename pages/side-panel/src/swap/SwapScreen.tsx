// SwapScreen — the input view. Faithful port of the design's SwapScreen, but
// presentational: Swap.tsx owns from/to/amount/quote and fetches real quotes.
import React, { useState } from 'react';
import type { SwapTheme } from './theme';
import type { UiAsset, SwapQuote } from './types';
import { Icon, I } from './icons';
import { TokenButton, PrimaryBtn, IconBtn, fmtCrypto } from './ui';

export function SwapScreen({
  T,
  from,
  to,
  amount,
  fromBalance,
  quote,
  quoteLoading,
  quoteError,
  onAmount,
  onPickFrom,
  onPickTo,
  onFlip,
  onBack,
  onReview,
}: {
  T: SwapTheme;
  from: UiAsset;
  to: UiAsset;
  amount: string;
  fromBalance?: number;
  quote: SwapQuote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  onAmount: (v: string) => void;
  onPickFrom: () => void;
  onPickTo: () => void;
  onFlip: () => void;
  onBack: () => void;
  onReview: () => void;
}) {
  const [showRoute, setShowRoute] = useState(false);
  const provider = quote?.swapper || quote?.integration;
  const out = quote ? parseFloat(quote.expectedOutput) : 0;
  const rate = quote && parseFloat(amount) > 0 ? out / parseFloat(amount) : 0;
  const canReview = !!quote && !quoteLoading && !quoteError && parseFloat(amount) > 0;

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 14px 16px',
        animation: 'kk-rise .3s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <IconBtn T={T} onClick={onBack}>
          <Icon d={I.left} />
        </IconBtn>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Swap</div>
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

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* You pay */}
        <div style={{ padding: '14px 16px', borderRadius: 14, background: T.surface, border: `1px solid ${T.line}` }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: T.faint,
              marginBottom: 10,
            }}>
            <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>You pay</span>
            {fromBalance !== undefined && (
              <span>
                Balance: <span className="mono">{fmtCrypto(fromBalance)}</span> {from.symbol}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={amount}
              onChange={e => onAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.0"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: T.text,
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: -0.5,
                fontFamily: "'JetBrains Mono', monospace",
                minWidth: 0,
              }}
            />
            <TokenButton T={T} asset={from} onClick={onPickFrom} />
          </div>
          {fromBalance !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['50%', 'Max'].map(p => (
                  <span
                    key={p}
                    onClick={() => onAmount((fromBalance * (p === 'Max' ? 1 : 0.5)).toFixed(6))}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: T.chip,
                      color: T.dim,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Flip */}
        <button
          onClick={onFlip}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%,-50%)',
            width: 34,
            height: 34,
            borderRadius: 10,
            zIndex: 2,
            background: T.surfaceHi,
            border: `1px solid ${T.lineHi}`,
            color: T.accent,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 0 0 4px ${T.bg}`,
          }}>
          <Icon d={I.swap} size={16} />
        </button>

        {/* You receive */}
        <div style={{ padding: '14px 16px', borderRadius: 14, background: T.surface, border: `1px solid ${T.line}` }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: T.faint,
              marginBottom: 10,
            }}>
            <span style={{ letterSpacing: '.14em', textTransform: 'uppercase' }}>You receive</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              className="mono"
              style={{ flex: 1, fontSize: 28, fontWeight: 700, letterSpacing: -0.5, color: out ? T.text : T.faint }}>
              {quoteLoading ? '…' : out ? (out < 1 ? out.toFixed(6) : out.toFixed(4)) : '0.0'}
            </div>
            <TokenButton T={T} asset={to} onClick={onPickTo} />
          </div>
        </div>
      </div>

      {/* Route / errors */}
      {quoteError ? (
        <div
          style={{
            marginTop: 10,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(224,80,80,0.08)',
            border: `1px solid ${T.bad}`,
            color: T.bad,
            fontSize: 12,
          }}>
          {quoteError}
        </div>
      ) : quote ? (
        <div
          onClick={() => setShowRoute(!showRoute)}
          style={{
            marginTop: 10,
            padding: '12px 14px',
            borderRadius: 12,
            background: T.surface,
            border: `1px solid ${T.line}`,
            cursor: 'pointer',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: T.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon d={I.refresh} size={13} style={{ color: T.accent }} />
              <span className="mono">
                1 {from.symbol} ≈ {rate ? (rate < 1 ? rate.toFixed(6) : rate.toFixed(5)) : '—'} {to.symbol}
              </span>
            </span>
            <Icon d={I.chev} size={14} style={{ color: T.faint, transform: `rotate(${showRoute ? -90 : 90}deg)` }} />
          </div>
          {showRoute && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px solid ${T.line}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
              {[
                ['Route', provider || '—'],
                ['Est. time', `~${Math.max(1, Math.round((quote.estimatedTime || 0) / 60))} min`],
                ['Min. received', `${quote.minimumOutput} ${to.symbol}`],
                ['Slippage', `${((quote.slippageBps || 0) / 100).toFixed(2)}%`],
                ['Fee', `${((quote.fees?.totalBps || 0) / 100).toFixed(2)}%`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: T.faint }}>{k}</span>
                  <span className="mono" style={{ color: T.text }}>
                    {v}
                  </span>
                </div>
              ))}
              {quote.warning && <div style={{ fontSize: 11, color: T.warn }}>{quote.warning}</div>}
            </div>
          )}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 14 }} />

      <div
        style={{
          padding: '10px 12px',
          borderRadius: 10,
          marginBottom: 10,
          background: `linear-gradient(90deg, ${T.accentDim}, transparent)`,
          border: `1px solid ${T.accentEdge}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
        }}>
        <Icon d={I.shield} size={14} style={{ color: T.accent }} />
        <span>Cross-chain swap is signed on your KeepKey device.</span>
      </div>

      <PrimaryBtn T={T} onClick={onReview} icon={<Icon d={I.swap} size={14} />} disabled={!canReview}>
        {quoteLoading ? 'Getting quote…' : 'Review Swap'}
      </PrimaryBtn>
    </div>
  );
}
