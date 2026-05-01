import { extendTheme } from '@chakra-ui/react';
import { config } from './config';

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
  // Surface tokens lifted from the design handoff (darker, layered).
  kkSurface: {
    bg: '#0b0d10',
    bg2: '#111418',
    surface: '#161a1f',
    surfaceHi: '#1c2127',
    line: 'rgba(255,255,255,0.06)',
    lineHi: 'rgba(255,255,255,0.10)',
  },
  kkText: {
    base: '#e6e9ef',
    dim: 'rgba(230,233,239,0.62)',
    faint: 'rgba(230,233,239,0.38)',
  },
  // OKLCH status palette from the handoff (fallback hex for older browsers).
  kkStatus: {
    good: '#57ce51',
    warn: '#e6b955',
    bad: '#e56a4d',
  },
};

const GOLD_GRADIENT = 'linear-gradient(180deg, #d29929 0%, #916419 100%)';

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
      'kk.line': colors.kkSurface.line,
      'kk.lineHi': colors.kkSurface.lineHi,
      'kk.text': colors.kkText.base,
      'kk.dim': colors.kkText.dim,
      'kk.faint': colors.kkText.faint,
      'kk.good': colors.kkStatus.good,
      'kk.warn': colors.kkStatus.warn,
      'kk.bad': colors.kkStatus.bad,
      'kk.accent': colors.keepKeyGold[400],
      'kk.accentDim': 'rgba(210,153,41,0.16)',
      'kk.accentEdge': 'rgba(210,153,41,0.36)',
    },
  },
  fonts: {
    heading: "'Inter', system-ui, sans-serif",
    body: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  styles: {
    global: {
      'html, body, #app-container': {
        background: colors.kkSurface.bg,
        color: colors.kkText.base,
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      // Uppercase letter-spaced micro-label used throughout the design.
      '.kk-eyebrow': {
        fontSize: '10px',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: colors.kkText.faint,
        fontWeight: 600,
      },
      '.mono': {
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: 600,
        letterSpacing: '-0.1px',
        borderRadius: '10px',
      },
      variants: {
        // Gradient gold with inset highlight + soft gold glow, black label — the design's primary action.
        solid: () => ({
          bgImage: GOLD_GRADIENT,
          bg: 'keepKeyGold.500', // fallback for browsers w/o gradient support
          color: '#0b0d10',
          boxShadow: '0 6px 20px -10px rgba(210,153,41,0.9), inset 0 1px 0 rgba(255,255,255,0.25)',
          _hover: {
            bgImage: GOLD_GRADIENT,
            filter: 'brightness(1.06)',
            _disabled: { filter: 'none' },
          },
          _active: { filter: 'brightness(0.95)' },
        }),
        ghost: () => ({
          bg: 'transparent',
          color: 'kk.text',
          border: '1px solid',
          borderColor: 'kk.lineHi',
          _hover: { bg: 'kk.surface' },
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
