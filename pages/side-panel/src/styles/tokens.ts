// Single source of truth for the KeepKey side-panel design palette.
//
// Both theme systems derive from this so they can never drift:
//   - the Chakra theme            (styles/theme/index.ts)
//   - the swap inline-style theme (swap/theme.ts)
//
// Ported from the BEX design (_design-bex/KeepKey Extension.html). The canonical
// accent is KeepKey gold; the swap screens originally shipped a standalone lime
// accent during the design port and now share these values.

export const tokens = {
  // Layered dark surfaces
  bg: '#0b0d10',
  bg2: '#111418',
  surface: '#161a1f',
  surfaceHi: '#1c2127',
  line: 'rgba(255,255,255,0.06)',
  lineHi: 'rgba(255,255,255,0.10)',
  chip: 'rgba(255,255,255,0.05)',

  // Text
  text: '#e6e9ef',
  dim: 'rgba(230,233,239,0.62)',
  faint: 'rgba(230,233,239,0.38)',

  // Accent — KeepKey gold (canonical brand accent). rgb(210,153,41) === #d29929.
  accent: '#d29929', // keepKeyGold.400
  accentDeep: '#916419', // keepKeyGold.600 — primary-button gradient bottom stop
  accentDim: 'rgba(210,153,41,0.16)',
  accentEdge: 'rgba(210,153,41,0.36)',

  // Status — one definition (previously oklch in swap, hex in Chakra).
  good: '#57ce51',
  warn: '#e6b955',
  bad: '#e56a4d',
} as const;
