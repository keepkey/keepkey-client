// Ported verbatim from the BEX design (_design-bex/KeepKey Extension.html).
// Self-contained inline-style theme so the swap screens match the design
// exactly, independent of the side panel's Chakra (gold) theme.

export interface SwapTheme {
  bg: string;
  bg2: string;
  surface: string;
  surfaceHi: string;
  line: string;
  lineHi: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  accentDim: string;
  accentEdge: string;
  accentDeep: string;
  good: string;
  warn: string;
  bad: string;
  chip: string;
}

const TWEAKS = { accentHue: 84, accentChroma: 0.11, accentLight: 0.62 };

export const makeTheme = (t = TWEAKS): SwapTheme => {
  const h = t.accentHue;
  return {
    bg: '#0b0d10',
    bg2: '#111418',
    surface: '#161a1f',
    surfaceHi: '#1c2127',
    line: 'rgba(255,255,255,0.06)',
    lineHi: 'rgba(255,255,255,0.10)',
    text: '#e6e9ef',
    dim: 'rgba(230,233,239,0.62)',
    faint: 'rgba(230,233,239,0.38)',
    accent: `oklch(${t.accentLight} ${t.accentChroma} ${h})`,
    accentDim: `oklch(${t.accentLight} ${t.accentChroma} ${h} / 0.16)`,
    accentEdge: `oklch(${t.accentLight} ${t.accentChroma} ${h} / 0.36)`,
    accentDeep: `oklch(0.32 ${Math.max(0.06, t.accentChroma * 0.7)} ${h})`,
    good: 'oklch(0.76 0.14 148)',
    warn: 'oklch(0.80 0.13 78)',
    bad: 'oklch(0.70 0.16 25)',
    chip: 'rgba(255,255,255,0.05)',
  };
};

export const T: SwapTheme = makeTheme();

/** Keyframes the design's animations rely on — injected once by <SwapKeyframes/>. */
export const SWAP_KEYFRAMES = `
  @keyframes kk-pulse { 0%,100% { opacity:.5 } 50% { opacity:1 } }
  @keyframes kk-spin { to { transform: rotate(360deg); } }
  @keyframes kk-glow {
    0%,100% { box-shadow: 0 0 0 0 var(--glow), 0 0 22px -2px var(--glow); }
    50% { box-shadow: 0 0 0 6px transparent, 0 0 34px 2px var(--glow); }
  }
  @keyframes kk-rise { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
`;

/** Deterministic glyph color for assets that don't carry one (design uses colored glyphs). */
const PALETTE = ['#f7931a', '#8a92b2', '#9945ff', '#23dcc8', '#2775ca', '#6f7390', '#c2a633', '#e84142', '#16c784'];
export const colorForSymbol = (sym: string): string => {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
