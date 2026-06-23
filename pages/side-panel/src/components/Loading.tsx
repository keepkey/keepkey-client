import React, { useEffect, useState } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { SpinningDevice } from './SpinningDevice';

interface LoadingProps {
  setIsConnecting: (isConnecting: boolean) => void;
  keepkeyState: any;
}

// Cycling "…" rendered in its own component so the ticking state never
// re-renders the (DOM-heavy) SpinningDevice. Fixed width keeps the label from
// shifting as dots appear/disappear.
const LoadingDots: React.FC = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(d => (d + 1) % 4), 420);
    return () => clearInterval(id);
  }, []);
  return (
    <Box as="span" display="inline-block" w="1.4em" textAlign="left">
      {'.'.repeat(n)}
    </Box>
  );
};

// Branded loading screen: the KeepKey spins (fast, "working" cadence) with an
// animated LOADING… readout + indeterminate progress bar on its OLED, over a
// pulsing accent glow. Everything eases in on mount (fade + rise) so the panel
// doesn't pop. Replaces the old raw Chakra spinner + "Status: N" debug text.
const Loading: React.FC<LoadingProps> = ({ setIsConnecting, keepkeyState }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsConnecting(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [setIsConnecting]);

  // State 3 is "busy" (device mid-operation); the rest are pre-pair connection
  // phases. Tailor the subtext so the screen reads as informative, not generic.
  const subtext = keepkeyState === 3 ? 'Waking your KeepKey…' : 'Connecting to KeepKey Vault…';

  return (
    <Flex direction="column" align="center" justify="center" h="100vh" px={6} position="relative" overflow="hidden">
      <style>{`
        @keyframes kkLoadEnter { from { opacity:0; transform: translateY(10px) scale(.94); } to { opacity:1; transform:none; } }
        @keyframes kkLoadRise  { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
        @keyframes kkLoadGlow  { 0%,100% { opacity:.30; transform: translate(-50%,-50%) scale(1); } 50% { opacity:.6; transform: translate(-50%,-50%) scale(1.14); } }
        @keyframes kkLoadBar   { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
      `}</style>

      {/* Pulsing accent glow behind the device */}
      <Box
        position="absolute"
        top="42%"
        left="50%"
        w="240px"
        h="240px"
        borderRadius="full"
        pointerEvents="none"
        style={{
          background: 'radial-gradient(circle, rgba(210,153,41,0.34) 0%, rgba(210,153,41,0) 68%)',
          transform: 'translate(-50%,-50%)',
          animation: 'kkLoadGlow 3.2s ease-in-out infinite',
        }}
      />

      <Box style={{ animation: 'kkLoadEnter .6s cubic-bezier(.2,.7,.2,1) both' }}>
        <SpinningDevice
          scale={0.5}
          durationSeconds={3.2}
          screen={
            <Flex direction="column" align="center" justify="center" w="100%" gap="4px">
              <Text
                as="span"
                fontFamily="ui-monospace, Menlo, monospace"
                fontSize="12px"
                fontWeight={700}
                letterSpacing="0.16em"
                color="#e8e6dc"
                whiteSpace="nowrap">
                LOADING
                <LoadingDots />
              </Text>
              {/* Indeterminate progress shuttle — implies activity without faking a percentage */}
              <Box w="62px" h="3px" borderRadius="full" bg="rgba(232,230,220,0.14)" overflow="hidden">
                <Box
                  h="100%"
                  w="45%"
                  borderRadius="full"
                  bg="#d29929"
                  style={{ animation: 'kkLoadBar 1.5s ease-in-out infinite' }}
                />
              </Box>
            </Flex>
          }
        />
      </Box>

      <Text
        mt={5}
        fontSize="md"
        fontWeight="semibold"
        color="kk.text"
        style={{ animation: 'kkLoadRise .6s ease .15s both' }}>
        Waking your KeepKey
      </Text>
      <Text mt={1} fontSize="xs" color="kk.dim" style={{ animation: 'kkLoadRise .6s ease .28s both' }}>
        {subtext}
      </Text>
    </Flex>
  );
};

export default Loading;
