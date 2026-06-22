// Asset chooser opened by the from/to TokenButtons. Replaces the design mock's
// cycle() with a real searchable list from vault's /api/v2/swap/assets.
import React, { useMemo, useState, useRef, useEffect } from 'react';
import type { SwapTheme } from './theme';
import type { UiAsset } from './types';
import { Icon, I } from './icons';
import { TokenGlyph, fmtUsd, fmtCrypto } from './ui';

export interface HeldBalance {
  amount: number;
  usd: number;
}

export function AssetPicker({
  T,
  assets,
  excludeCaip,
  title,
  side,
  balanceByCaip,
  balancesLoading,
  onSelect,
  onClose,
}: {
  T: SwapTheme;
  assets: UiAsset[];
  excludeCaip?: string;
  title: string;
  // 'from' shows only held assets (you can't swap what you don't own); 'to'
  // shows the full swappable universe. Mirrors vault's FromPicker/ToPicker.
  side: 'from' | 'to';
  balanceByCaip?: Map<string, HeldBalance>;
  balancesLoading?: boolean;
  onSelect: (a: UiAsset) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  // Focus the search on open via a ref rather than autoFocus (jsx-a11y).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // FROM side: restrict to held assets, ranked by USD value descending. TO side:
  // the full list passed in. (vault's swap-discovery FromPicker rule.)
  const source = useMemo(() => {
    if (side !== 'from' || !balanceByCaip) return assets;
    return assets
      .filter(a => a.caip && (balanceByCaip.get(a.caip)?.amount ?? 0) > 0)
      .sort((a, b) => (balanceByCaip.get(b.caip!)?.usd ?? 0) - (balanceByCaip.get(a.caip!)?.usd ?? 0));
  }, [assets, side, balanceByCaip]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return source.filter(a => {
      if (excludeCaip && a.caip === excludeCaip) return false;
      if (!needle) return true;
      return (
        a.symbol.toLowerCase().includes(needle) ||
        a.name.toLowerCase().includes(needle) ||
        a.chainId.toLowerCase().includes(needle)
      );
    });
  }, [source, q, excludeCaip]);

  const loadingHeld = side === 'from' && balancesLoading && source.length === 0 && !q.trim();

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: T.bg,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 10px' }}>
        <button
          onClick={onClose}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: `1px solid ${T.line}`,
            background: 'transparent',
            color: T.dim,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}>
          <Icon d={I.left} />
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 600, color: T.text }}>{title}</div>
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 12,
            background: T.surface,
            border: `1px solid ${T.line}`,
          }}>
          <Icon d={I.search} size={15} style={{ color: T.faint }} />
          <input
            ref={searchRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search asset or chain"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: T.text,
              fontSize: 14,
              minWidth: 0,
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
        {loadingHeld ? (
          <div style={{ textAlign: 'center', color: T.faint, fontSize: 13, padding: '24px 0' }}>
            Checking your KeepKey balances…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: T.faint, fontSize: 13, padding: '24px 0' }}>
            {side === 'from'
              ? q.trim()
                ? 'No held assets match'
                : 'No assets to swap — your KeepKey is empty'
              : 'No assets found'}
          </div>
        ) : null}
        {filtered.map(a => {
          const bal = side === 'from' && a.caip ? balanceByCaip?.get(a.caip) : undefined;
          return (
            <button
              key={a.caip || a.asset}
              onClick={() => onSelect(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '10px 10px',
                borderRadius: 12,
                border: 'none',
                background: 'transparent',
                color: T.text,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <TokenGlyph asset={a} size={34} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.symbol}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: T.faint,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                  {a.name}
                </div>
              </div>
              {bal ? (
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                    {fmtCrypto(bal.amount)}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: T.faint }}>
                    {fmtUsd(bal.usd)}
                  </div>
                </div>
              ) : (
                <div
                  className="mono"
                  style={{ fontSize: 10, color: T.faint, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {a.chainId}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
