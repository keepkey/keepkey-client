import { extendTheme } from '@chakra-ui/react';
import { config } from './config';

// Define the extended KeepKey-themed color palette
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
};

export const theme = extendTheme({
  initialColorMode: 'dark',
  useSystemColorMode: false,
  colors: {
    keepKeyGold: colors.keepKeyGold,
    gray: colors.keepKeyBlack,
  },
  fonts: {
    heading: 'Plus Jakarta Sans, sans-serif',
    body: 'Plus Jakarta Sans, sans-serif',
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: 'bold',
      },
      variants: {
        solid: (props: any) => ({
          bg: props.colorMode === 'dark' ? 'keepKeyGold.500' : 'keepKeyGold.400',
          color: 'white',
          _hover: {
            bg: 'keepKeyGold.600',
          },
        }),
      },
      defaultProps: {
        size: 'md',
        variant: 'solid',
      },
    },
    // You can extend other components here in a similar fashion
  },
  config,
});
