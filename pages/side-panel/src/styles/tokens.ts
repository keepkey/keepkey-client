// Single source of truth for the KeepKey side-panel design palette.
//
// Both theme systems derive from this so they can never drift:
//   - the Chakra theme            (styles/theme/index.ts)
//   - the swap inline-style theme (swap/theme.ts)
//
// v2 direction (KEEPKEY_STYLE.md §0, "KeepKey Side Panel v2.dc.html"): the
// blue-black palette is retired in favour of a neutral *warm* black with warm
// white text. Gold and the motion recipes are unchanged. The legacy key names
// (bg/bg2/surface/…) are kept so every existing consumer picks the new values
// up without edits; the v2-only additions are grouped below them.

export const tokens = {
  // Layered warm-black surfaces
  bg: '#0A0A0B', // panel background
  bg2: '#0E0E10', // header / bars
  surface: '#131316', // sheets, raised surfaces
  surfaceHi: '#19191D', // hover, nested surfaces
  surface3: '#212127', // pressed, toast
  line: '#1E1E23', // hairline dividers
  lineHi: '#2A2A31', // control borders
  line3: '#37373F', // hover borders, drag handle
  chip: '#19191D',

  // Warm white text. `faint` is the 4.6:1 contrast floor — do not go darker.
  text: '#EDEAE3',
  dim: '#A8A49B',
  faint: '#7F7B73',
  placeholder: '#4F4C46',

  // Accent — KeepKey gold (canonical brand accent). rgb(210,153,41) === #d29929.
  accent: '#d29929', // keepKeyGold.400
  accentHi: '#EDC157', // keycap top stop / hover
  accentDeep: '#C99225', // keycap bottom stop
  accentInk: '#1A1204', // label colour on gold
  accentDim: 'rgba(210,153,41,0.12)',
  accentEdge: 'rgba(210,153,41,0.36)',

  // Status
  good: '#3DBE6B',
  warn: '#e6b955',
  bad: '#E5484D',
} as const;

/** Keycap button faces and extrusions (KEEPKEY_STYLE.md §0).
 *  The device's own confirm button is the metaphor: a physical key that travels
 *  down when pressed. Primary and secondary must read the same height, so the
 *  secondary extrusion carries a 1px outline to stay visible on black. */
export const keycap = {
  goldBg: `linear-gradient(180deg,${tokens.accentHi} 0%,${tokens.accent} 55%,${tokens.accentDeep} 100%)`,
  goldShadow: '0 6px 0 #7E5A12, 0 6px 0 1px #5C4110, 0 10px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.4)',
  goldShadowSm: '0 5px 0 #7E5A12, 0 5px 0 1px #5C4110, 0 8px 14px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.4)',
  goldPressed:
    '0 1px 0 #7E5A12, 0 2px 6px rgba(0,0,0,.4), 0 0 0 2px rgba(237,193,87,.7), 0 0 24px rgba(210,153,41,.55), inset 0 1px 0 rgba(255,255,255,.4)',

  greyBg: 'linear-gradient(180deg,#34343C 0%,#252530 100%)',
  greyShadow: '0 6px 0 #14141A, 0 6px 0 1px #3A3A43, 0 10px 18px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12)',
  greyShadowSm: '0 5px 0 #14141A, 0 5px 0 1px #3A3A43, 0 8px 14px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12)',
  greyPressed:
    '0 1px 0 #14141A, 0 1px 0 1px #3A3A43, 0 2px 6px rgba(0,0,0,.4), 0 0 0 2px rgba(210,153,41,.45), 0 0 16px rgba(210,153,41,.3), inset 0 1px 0 rgba(255,255,255,.12)',

  // Disabled keeps the extrusion but drops the ring — the key is still a key,
  // it just doesn't light up.
  offBg: '#1E1E25',
  offShadow: '0 6px 0 #14141A, 0 6px 0 1px #2E2E36, inset 0 1px 0 rgba(255,255,255,.06)',
  offShadowSm: '0 5px 0 #14141A, 0 5px 0 1px #2E2E36, inset 0 1px 0 rgba(255,255,255,.06)',
} as const;

/** Type stacks. Both families are bundled as latin-subset variable woff2 under
 *  assets/fonts — a hardware wallet must not phone home to a font CDN. */
export const fonts = {
  ui: "'Instrument Sans', system-ui, -apple-system, sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** Motion (KEEPKEY_STYLE.md §6). Exits are faster than enters and use a
 *  different curve, so a screen leaving never feels like a screen arriving. */
export const motion = {
  micro: '120ms',
  fast: '200ms',
  base: '300ms',
  slow: '500ms',
  draw: '900ms',
  ease: 'cubic-bezier(.2,.8,.2,1)',
  easeExit: 'cubic-bezier(.4,0,1,1)',
  easeSpring: 'cubic-bezier(.34,1.56,.64,1)',
} as const;
