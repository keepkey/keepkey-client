import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Image, Button, Card, Stack, Text, Box, Spinner } from '@chakra-ui/react';

interface ConnectProps {
  setIsConnecting: (isConnecting: boolean) => void;
}

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

  const openKeepKeyLink = () => {
    window.open('https://keepkey.com', '_blank');
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
      console.log('window: ', window);
      console.log('window.location: ', window.location);
      if (window) {
        setTimeout(() => {
          window.location.assign('keepkey://launch');
          window.open('https://keepkey.com/launch', '_blank');
        }, 100); // Adding a slight delay before launching the URL
      }
    } catch (error) {
      console.error('Failed to launch KeepKey:', error);
    }
  };

  return (
    <Box display="flex" justifyContent="center" alignItems="center" height="100vh" position="relative">
      <Card
        borderRadius="md"
        p={6}
        mb={6}
        display="flex"
        flexDirection="column"
        alignItems="center"
        textAlign="center"
        boxShadow="lg">
        <Image src={'https://i.ibb.co/jR8WcJM/kk.gif'} alt="KeepKey" />
        <Text fontSize="lg" mb={4}>
          Plug in your KeepKey to get started...
        </Text>
        <Stack direction="column" spacing={4} mb={4}>
          <Button colorScheme="blue" onClick={launchKeepKey}>
            Launch KeepKey Desktop
          </Button>

          <br />
          <h3>Already running?</h3>
          <Button colorScheme="teal" onClick={connectKeepkey}>
            Connect to your KeepKey
          </Button>
        </Stack>
        <Text fontSize="sm" mt={4}>
          Dont have a KeepKey?{' '}
          <Button variant="link" color="teal.500" onClick={openKeepKeyLink}>
            Buy a KeepKey
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
          bg="rgba(255, 255, 255, 0.8)"
          zIndex={1}>
          <Spinner size="xl" thickness="4px" color="teal.500" />
        </Box>
      )}
    </Box>
  );
};

export default Connect;
