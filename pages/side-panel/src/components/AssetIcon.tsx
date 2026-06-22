// One asset/token/network icon, used everywhere. Tries the provided icon URL
// and degrades to a deterministic colored monogram on empty/invalid/404 — so a
// missing icon reads as an intentional branded glyph, never a gray circle.
// Generalizes the swap UI's TokenGlyph for the Chakra side of the app.
import React, { useState } from 'react';
import { colorForSymbol } from '../styles/assetColor';

/** Normalize an icon source: drop empties and non-http values; some providers
 *  pack several comma-separated URLs, so take the first http(s) one. */
const normalizeIconUrl = (src?: string | null): string | null => {
  if (!src || !src.trim()) return null;
  if (src.includes(',')) {
    const first = src
      .split(',')
      .map(u => u.trim())
      .find(u => /^https?:\/\//.test(u));
    return first || null;
  }
  return /^https?:\/\//.test(src) ? src : null;
};

export function AssetIcon({
  src,
  symbol,
  size = 32,
  style,
}: {
  src?: string | null;
  symbol?: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const url = normalizeIconUrl(src);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={symbol || ''}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
          ...style,
        }}
      />
    );
  }

  const bg = colorForSymbol(symbol || '?');
  return (
    <div
      aria-label={symbol}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: `radial-gradient(120% 120% at 30% 20%, ${bg}ee, ${bg}88 55%, ${bg}44 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.25)',
        color: 'white',
        fontWeight: 700,
        fontSize: size * 0.36,
        letterSpacing: -0.5,
        ...style,
      }}>
      {(symbol || '?')[0].toUpperCase()}
    </div>
  );
}

export default AssetIcon;
