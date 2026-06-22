// Inline-style theme for the swap screens (the design uses raw inline styles, not
// Chakra). Every value derives from the shared design tokens (styles/tokens.ts) so
// the swap UI stays byte-identical to the side panel's Chakra theme — including the
// canonical KeepKey gold accent. (Originally a standalone lime-accent port.)
import { tokens } from '../styles/tokens';

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

export const makeTheme = (): SwapTheme => ({
  bg: tokens.bg,
  bg2: tokens.bg2,
  surface: tokens.surface,
  surfaceHi: tokens.surfaceHi,
  line: tokens.line,
  lineHi: tokens.lineHi,
  text: tokens.text,
  dim: tokens.dim,
  faint: tokens.faint,
  accent: tokens.accent,
  accentDim: tokens.accentDim,
  accentEdge: tokens.accentEdge,
  accentDeep: tokens.accentDeep,
  good: tokens.good,
  warn: tokens.warn,
  bad: tokens.bad,
  chip: tokens.chip,
});

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
