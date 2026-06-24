// Shared swap UI primitives — ported from the BEX design, taking the `T` theme
// as a prop exactly like the design. TokenGlyph additionally renders a real icon
// URL when the asset has one (the design mock had only colored glyphs).
import React, { useState, useEffect } from 'react';
import type { SwapTheme } from './theme';
import { Icon, I } from './icons';
import type { UiAsset } from './types';
import { getNetworkName } from '../components/header/headerConstants';

const capitalize = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** Short network label for a swap asset — "Base", "Ethereum", "Bitcoin". The
 *  swap UI shows only a symbol, so ETH-on-Base and ETH-on-Ethereum look
 *  identical; this is what tells them apart. Derives from the caip, falling
 *  back to the asset's internal chainId. */
export function networkLabelFor(asset: { caip?: string; chainId?: string }): string {
  return getNetworkName(asset.caip) || capitalize(asset.chainId);
}

/** "{name} · {network}" for list rows, collapsing to one when they'd repeat
 *  (e.g. native ETH whose name and network are both "Ethereum"). */
export function assetSubLabel(asset: { name?: string; caip?: string; chainId?: string }): string {
  const net = networkLabelFor(asset);
  if (asset.name && net && asset.name !== net) return `${asset.name} · ${net}`;
  return net || asset.name || '';
}

export const fmtUsd = (n: number, show = true) =>
  show ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '••••••';

export const fmtCrypto = (n: number) => {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
};

export function TokenGlyph({ asset, size = 36 }: { asset: Pick<UiAsset, 'symbol' | 'icon' | 'color'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  // Reset on icon change so a reused glyph doesn't stay stuck on the monogram.
  useEffect(() => setFailed(false), [asset.icon]);

  if (asset.icon && !failed) {
    return (
      <img
        src={asset.icon}
        alt={asset.symbol}
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          objectFit: 'cover',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
        }}
      />
    );
  }
  const bg = asset.color;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(120% 120% at 30% 20%, ${bg}ee, ${bg}88 55%, ${bg}44 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.25)',
        color: 'white',
        fontWeight: 700,
        fontSize: size * 0.36,
        letterSpacing: -0.5,
        fontFamily: "'Inter',sans-serif",
        flexShrink: 0,
      }}>
      {(asset.symbol || '?')[0]}
    </div>
  );
}

export function IconBtn({
  children,
  onClick,
  T,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  T: SwapTheme;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: '1px solid ' + T.line,
        background: active ? T.accentDim : 'transparent',
        color: active ? T.accent : T.dim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

export function PrimaryBtn({
  children,
  onClick,
  T,
  icon,
  disabled,
  ghost,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  T: SwapTheme;
  icon?: React.ReactNode;
  disabled?: boolean;
  ghost?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        height: 40,
        borderRadius: 10,
        border: ghost ? `1px solid ${T.lineHi}` : 'none',
        background: ghost ? 'transparent' : `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
        color: ghost ? T.text : '#0b0d10',
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: -0.1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        boxShadow: ghost ? 'none' : `0 6px 20px -10px ${T.accent}, inset 0 1px 0 rgba(255,255,255,0.25)`,
      }}>
      {icon}
      {children}
    </button>
  );
}

export function TokenButton({ T, asset, onClick }: { T: SwapTheme; asset: UiAsset; onClick?: () => void }) {
  const network = networkLabelFor(asset);
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px 5px 6px',
        borderRadius: 999,
        border: `1px solid ${T.line}`,
        background: T.surfaceHi,
        color: T.text,
        cursor: 'pointer',
      }}>
      <TokenGlyph asset={asset} size={26} />
      {/* Symbol over the network name so ETH-on-Base ≠ ETH-on-Ethereum at a glance */}
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.05 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{asset.symbol}</span>
        {network && <span style={{ fontSize: 10, fontWeight: 500, color: T.faint }}>{network}</span>}
      </span>
      <Icon d={I.chev} size={14} style={{ color: T.faint, transform: 'rotate(90deg)' }} />
    </button>
  );
}

export function SwapEmblem({ T, from, to }: { T: SwapTheme; from: UiAsset; to: UiAsset }) {
  return (
    <div style={{ position: 'relative', width: 128, height: 128, margin: '4px auto 0' }}>
      <div
        style={
          {
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `2px solid ${T.accentEdge}`,
            boxShadow: `0 0 30px -4px ${T.accent}, inset 0 0 24px -6px ${T.accent}`,
            animation: 'kk-glow 2.6s ease-in-out infinite',
            '--glow': T.accent,
          } as React.CSSProperties
        }
      />
      <div
        style={{
          position: 'absolute',
          inset: 14,
          borderRadius: '50%',
          background: `radial-gradient(120% 120% at 30% 20%, ${T.surfaceHi}, ${T.bg2})`,
          border: `1px solid ${T.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke={T.accent}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 8-4-.5-7-3.5-7-8V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>
      <div style={{ position: 'absolute', bottom: 2, left: 6 }}>
        <TokenGlyph asset={from} size={34} />
      </div>
      <div style={{ position: 'absolute', bottom: 2, right: 6 }}>
        <TokenGlyph asset={to} size={34} />
      </div>
    </div>
  );
}

export function SwapTimeline({ T, prog }: { T: SwapTheme; prog: number }) {
  const seg1 = Math.min(1, prog / 0.5);
  const protocolActive = prog >= 0.48;
  const outputActive = prog >= 0.98;
  const nodes = [
    { d: I.up, label: ['Input', 'Transaction'], done: true, active: false },
    { d: I.bolt, label: ['Protocol', 'Processing'], done: outputActive, active: protocolActive && !outputActive },
    { d: I.recv, label: ['Output', 'Transaction'], done: false, active: outputActive },
  ];
  const Node = ({ n }: { n: (typeof nodes)[number] }) => {
    const filled = n.done;
    const active = n.active;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 2, width: 64 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: filled ? T.good : active ? T.accent : T.surfaceHi,
            color: filled || active ? '#0b0d10' : T.faint,
            border: `1px solid ${filled ? T.good : active ? T.accentEdge : T.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: active ? `0 0 16px -2px ${T.accent}` : filled ? `0 0 12px -3px ${T.good}` : 'none',
            animation: active ? 'kk-pulse 1.4s ease-in-out infinite' : 'none',
          }}>
          <Icon d={n.d} size={15} />
        </div>
        <div
          className="mono"
          style={{ textAlign: 'center', fontSize: 10, lineHeight: 1.25, color: filled || active ? T.text : T.faint }}>
          {n.label[0]}
          <br />
          {n.label[1]}
        </div>
      </div>
    );
  };
  return (
    <div style={{ position: 'relative', padding: '4px 6px' }}>
      <div
        style={{ position: 'absolute', left: 38, right: 38, top: 21, height: 4, borderRadius: 2, background: T.line }}
      />
      <div
        style={{
          position: 'absolute',
          left: 38,
          top: 21,
          height: 4,
          borderRadius: 2,
          background: T.good,
          width: `calc((100% - 76px) * ${(0.5 * seg1).toFixed(3)})`,
          transition: 'width .2s linear',
          boxShadow: `0 0 10px ${T.good}`,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {nodes.map((n, i) => (
          <Node key={i} n={n} />
        ))}
      </div>
    </div>
  );
}
