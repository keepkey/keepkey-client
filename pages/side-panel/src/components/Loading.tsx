import React, { useEffect } from 'react';
import { Image, Button, Card, Stack, Text, Box, Spinner } from '@chakra-ui/react';

interface ConnectProps {
  setIsConnecting: (isConnecting: boolean) => void;
  keepkeyState: any;
}

const Loading: React.FC<ConnectProps> = ({ setIsConnecting, keepkeyState }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsConnecting(false);
    }, 3000);

    // Cleanup the timer on component unmount
    return () => clearTimeout(timer);
  }, [setIsConnecting]);

  return (
    <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
      <Card
        borderRadius="md"
        p={6}
        mb={6}
        display="flex"
        flexDirection="column"
        alignItems="center"
        textAlign="center"
        boxShadow="lg">
        <Box textAlign="center">
          <h2>Status: {keepkeyState}</h2>
          <Spinner size="6xl" />
          <Text mt={4}>Connecting to KeepKey...</Text>
        </Box>
      </Card>
    </Box>
  );
};

export default Loading;
