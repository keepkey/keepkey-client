// Asset chooser opened by the from/to TokenButtons. Replaces the design mock's
// cycle() with a real searchable list from vault's /api/v2/swap/assets.
import React, { useMemo, useState } from 'react';
import type { SwapTheme } from './theme';
import type { UiAsset } from './types';
import { Icon, I } from './icons';
import { TokenGlyph } from './ui';

export function AssetPicker({
  T,
  assets,
  excludeCaip,
  title,
  onSelect,
  onClose,
}: {
  T: SwapTheme;
  assets: UiAsset[];
  excludeCaip?: string;
  title: string;
  onSelect: (a: UiAsset) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter(a => {
      if (excludeCaip && a.caip === excludeCaip) return false;
      if (!needle) return true;
      return (
        a.symbol.toLowerCase().includes(needle) ||
        a.name.toLowerCase().includes(needle) ||
        a.chainId.toLowerCase().includes(needle)
      );
    });
  }, [assets, q, excludeCaip]);

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
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search asset or chain"
            autoFocus
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
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: T.faint, fontSize: 13, padding: '24px 0' }}>No assets found</div>
        )}
        {filtered.map(a => (
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
            <div
              className="mono"
              style={{ fontSize: 10, color: T.faint, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {a.chainId}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
