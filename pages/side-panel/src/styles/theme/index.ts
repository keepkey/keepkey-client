import { extendTheme } from '@chakra-ui/react';
import { config } from './config';
import { tokens, keycap, fonts, motion } from '../tokens';

const colors = {
  keepKeyGold: {
    50: '#fffaf0',
    100: '#f4e5b2',
    200: '#e8cc84',
    300: '#ddb356',
    400: '#d29929',
    500: '#b57f1e',
    600: '#916419',
    700: '#6d4a13',
    800: '#49300e',
    900: '#251807',
  },
  keepKeyBlack: {
    50: '#e5e5e5',
    100: '#b8b8b8',
    200: '#8a8a8a',
    300: '#5c5c5c',
    400: '#3d3d3d',
    500: '#1f1f1f',
    600: '#1a1a1a',
    700: '#141414',
    800: '#0f0f0f',
    900: '#0a0a0a',
  },
  // Surface / text / status derive from the shared design tokens (styles/tokens.ts)
  // — single source of truth so this theme and the swap inline theme can't drift.
  kkSurface: {
    bg: tokens.bg,
    bg2: tokens.bg2,
    surface: tokens.surface,
    surfaceHi: tokens.surfaceHi,
    surface3: tokens.surface3,
    line: tokens.line,
    lineHi: tokens.lineHi,
    line3: tokens.line3,
  },
  kkText: {
    base: tokens.text,
    dim: tokens.dim,
    faint: tokens.faint,
  },
  kkStatus: {
    good: tokens.good,
    warn: tokens.warn,
    bad: tokens.bad,
  },
};

/** Shared keycap geometry. Primary and secondary must read the same height, so
 *  both families use one base and differ only in face + extrusion colour. */
const keycapBase = {
  fontWeight: 700,
  fontSize: '13px',
  letterSpacing: '0.09em',
  textTransform: 'uppercase' as const,
  borderRadius: '10px',
  border: 0,
  transform: 'translateY(0)',
  transition: `transform 90ms ease, box-shadow 90ms ease, filter ${motion.micro} ease`,
};

export const theme = extendTheme({
  initialColorMode: 'dark',
  useSystemColorMode: false,
  colors: {
    keepKeyGold: colors.keepKeyGold,
    gray: colors.keepKeyBlack,
    kkSurface: colors.kkSurface,
    kkText: colors.kkText,
    kkStatus: colors.kkStatus,
  },
  semanticTokens: {
    colors: {
      'kk.bg': colors.kkSurface.bg,
      'kk.bg2': colors.kkSurface.bg2,
      'kk.surface': colors.kkSurface.surface,
      'kk.surfaceHi': colors.kkSurface.surfaceHi,
      'kk.surface3': colors.kkSurface.surface3,
      'kk.line': colors.kkSurface.line,
      'kk.lineHi': colors.kkSurface.lineHi,
      'kk.line3': colors.kkSurface.line3,
      'kk.text': colors.kkText.base,
      'kk.dim': colors.kkText.dim,
      'kk.faint': colors.kkText.faint,
      'kk.good': colors.kkStatus.good,
      'kk.warn': colors.kkStatus.warn,
      'kk.bad': colors.kkStatus.bad,
      'kk.accent': tokens.accent,
      'kk.accentDim': tokens.accentDim,
      'kk.accentEdge': tokens.accentEdge,
    },
  },
  fonts: {
    heading: fonts.ui,
    body: fonts.ui,
    mono: fonts.mono,
  },
  styles: {
    global: {
      'html, body, #app-container': {
        height: '100%',
        margin: 0,
        background: colors.kkSurface.bg,
        color: colors.kkText.base,
        fontFamily: fonts.ui,
        WebkitFontSmoothing: 'antialiased',
        // Inner panels own their scrolling (the body Flex / drawer bodies);
        // pin the document so the wheel drives those, not the whole window.
        overscrollBehavior: 'none',
      },
      'input::placeholder, textarea::placeholder': {
        color: tokens.placeholder,
      },
      // Uppercase letter-spaced micro-label used throughout the design (§3).
      '.kk-eyebrow': {
        fontFamily: fonts.mono,
        fontSize: '10.5px',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: colors.kkText.faint,
        fontWeight: 500,
      },
      '.mono': {
        fontFamily: fonts.mono,
      },
      // Big numerals are mono 400 with tabular figures so digits never reflow
      // as a balance ticks (§0).
      '.kk-numeral': {
        fontFamily: fonts.mono,
        fontWeight: 400,
        letterSpacing: '-0.03em',
        fontVariantNumeric: 'tabular-nums',
      },
    },
  },
  components: {
    // Toggles were still Chakra's default blue — the one saturated non-brand
    // hue in the panel. Gold is the accent that marks state (§2), so the
    // checked track takes it; fixed here rather than per-screen so every
    // Switch in the panel inherits it.
    Switch: {
      baseStyle: {
        track: {
          bg: tokens.lineHi,
          _checked: { bg: tokens.accent },
          _focusVisible: { boxShadow: `0 0 0 2px ${tokens.accentEdge}` },
        },
        thumb: {
          bg: tokens.text,
        },
      },
    },
    Button: {
      baseStyle: {
        fontWeight: 600,
        letterSpacing: '-0.1px',
        borderRadius: '10px',
      },
      variants: {
        // Primary keycap — the one gold action on a screen (§0, §9).
        solid: () => ({
          ...keycapBase,
          bgImage: keycap.goldBg,
          bg: 'keepKeyGold.500', // fallback for browsers w/o gradient support
          color: tokens.accentInk,
          boxShadow: keycap.goldShadow,
          _hover: {
            bgImage: keycap.goldBg,
            filter: 'brightness(1.06)',
            _disabled: { filter: 'none' },
          },
          _active: {
            transform: 'translateY(5px)',
            boxShadow: keycap.goldPressed,
          },
          // Disabled keeps the extrusion but drops the ring — still a key, just
          // unlit. Never a faded gold.
          _disabled: {
            bgImage: 'none',
            bg: keycap.offBg,
            color: tokens.faint,
            boxShadow: keycap.offShadow,
            opacity: 1,
            cursor: 'not-allowed',
          },
        }),
        // Secondary keycap — same geometry, grey face. The 1px outline on the
        // extrusion keeps the side face visible against the black panel.
        keycapSecondary: () => ({
          ...keycapBase,
          bgImage: keycap.greyBg,
          bg: tokens.surface3,
          color: tokens.text,
          boxShadow: keycap.greyShadow,
          _hover: {
            bgImage: keycap.greyBg,
            filter: 'brightness(1.12)',
            _disabled: { filter: 'none' },
          },
          _active: {
            transform: 'translateY(5px)',
            boxShadow: keycap.greyPressed,
          },
          _disabled: {
            bgImage: 'none',
            bg: keycap.offBg,
            color: tokens.faint,
            boxShadow: keycap.offShadow,
            opacity: 1,
            cursor: 'not-allowed',
          },
        }),
        // Destructive keycap. Callers used to write `variant="solid" bg="kk.bad"`,
        // which does nothing: `solid` paints its face with bgImage, and bgImage
        // wins over bg — so "Clear Storage" and "Force Reset App" were
        // rendering gold. Same geometry, red face.
        destructive: () => ({
          ...keycapBase,
          bgImage: `linear-gradient(180deg,#F0666B 0%,${tokens.bad} 55%,#C13135 100%)`,
          bg: tokens.bad,
          color: '#1A0405',
          boxShadow:
            '0 6px 0 #7A2023, 0 6px 0 1px #5C181A, 0 10px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.3)',
          _hover: {
            bgImage: `linear-gradient(180deg,#F0666B 0%,${tokens.bad} 55%,#C13135 100%)`,
            filter: 'brightness(1.06)',
          },
          _active: {
            transform: 'translateY(5px)',
            boxShadow:
              '0 1px 0 #7A2023, 0 2px 6px rgba(0,0,0,.4), 0 0 0 2px rgba(240,102,107,.7), 0 0 24px rgba(229,72,77,.5), inset 0 1px 0 rgba(255,255,255,.3)',
          },
          _disabled: {
            bgImage: 'none',
            bg: keycap.offBg,
            color: tokens.faint,
            boxShadow: keycap.offShadow,
            opacity: 1,
            cursor: 'not-allowed',
          },
        }),
        // Icon buttons, text buttons, chips and tabs stay flat (§0) — a keycap
        // at 34px would read as a mistake next to the real ones.
        ghost: () => ({
          bg: 'transparent',
          color: 'kk.dim',
          border: 0,
          _hover: { bg: 'kk.surfaceHi', color: 'kk.text' },
          _active: { bg: 'kk.surface3' },
        }),
        outline: () => ({
          bg: 'transparent',
          color: 'kk.text',
          border: '1px solid',
          borderColor: 'kk.lineHi',
          _hover: { bg: 'kk.surface', borderColor: 'kk.line3' },
          _active: { bg: 'kk.surfaceHi' },
        }),
      },
      defaultProps: {
        size: 'md',
        variant: 'solid',
      },
    },
  },
  config,
});
