import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Button, Card, Stack, Text, Box, Spinner } from '@chakra-ui/react';
import { SpinningDevice } from './SpinningDevice';

interface ConnectProps {
  setIsConnecting: (isConnecting: boolean) => void;
}

const KEEPKEY_LAUNCH_URL = 'https://keepkey.com/launch';

const Connect: React.FC<ConnectProps> = ({ setIsConnecting }) => {
  const [isConnecting, setLocalIsConnecting] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await axios.get('http://localhost:1646/docs');
        if (response.status === 200) {
          clearInterval(interval);
          connectKeepkey();
        }
      } catch (error) {
        console.log('KeepKey endpoint not found, retrying...');
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const openBrowserTab = (url: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openKeepKeyLink = () => {
    openBrowserTab(KEEPKEY_LAUNCH_URL);
  };

  const connectKeepkey = () => {
    console.log('connectKeepkey called');
    setIsConnecting(true);
    setLocalIsConnecting(true);
    try {
      chrome.runtime.sendMessage({ type: 'ON_START' }, response => {
        if (chrome.runtime.lastError) {
          console.error('chrome.runtime.lastError:', chrome.runtime.lastError.message);
        } else {
          console.log('Response:', response);
        }
        setIsConnecting(false);
        setLocalIsConnecting(false);
      });
    } catch (error) {
      console.error('Error in connectKeepkey:', error);
      setIsConnecting(false);
      setLocalIsConnecting(false);
    }
  };

  const launchKeepKey = () => {
    try {
      openBrowserTab(KEEPKEY_LAUNCH_URL);
    } catch (error) {
      console.error('Failed to launch KeepKey:', error);
    }
  };

  return (
    <Box display="flex" justifyContent="center" alignItems="center" height="100vh" position="relative">
      <Card
        bg="kk.surface"
        borderRadius="md"
        p={6}
        mb={6}
        display="flex"
        flexDirection="column"
        alignItems="center"
        textAlign="center"
        boxShadow="lg"
        borderWidth="1px"
        borderColor="kk.line">
        {/* Spins slowly with a dim OLED — reads as a powered-but-unreachable
            device while we poll localhost:1646 for the vault to come up. */}
        <Box mb={2}>
          <SpinningDevice scale={0.4} durationSeconds={16} label="OFFLINE" />
        </Box>
        <Text fontSize="lg" fontWeight="bold" mb={2} color="kk.text">
          KeepKey Vault Required
        </Text>
        <Text fontSize="sm" mb={4} color="kk.dim">
          The KeepKey Vault desktop app must be running to use this extension.
        </Text>
        <Stack direction="column" spacing={4} mb={4}>
          <Button onClick={launchKeepKey}>Launch KeepKey Vault</Button>

          <Text fontSize="xs" color="kk.faint">
            Already running?
          </Text>
          <Button variant="ghost" onClick={connectKeepkey}>
            Retry Connection
          </Button>
        </Stack>
        <Text fontSize="sm" mt={4} color="kk.dim">
          Don't have KeepKey Vault?{' '}
          <Button variant="link" color="kk.accent" onClick={openKeepKeyLink}>
            Download at keepkey.com
          </Button>
        </Text>
      </Card>

      {isConnecting && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display="flex"
          justifyContent="center"
          alignItems="center"
          bg="rgba(11, 13, 16, 0.85)"
          zIndex={1}>
          <Spinner size="xl" thickness="4px" color="kk.accent" />
        </Box>
      )}
    </Box>
  );
};

export default Connect;
