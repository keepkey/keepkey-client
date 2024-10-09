import React from 'react';
import { VStack, HStack, Avatar, Text, Switch, Link, Button, Image, Box, useToast } from '@chakra-ui/react';

const Settings = () => {
  const isComingSoon = (name: string) => ['XDEFI', 'Keplr'].includes(name);
  const toast = useToast(); // For showing a success/failure message

  const handleForceReset = () => {
    chrome.runtime.sendMessage({ type: 'RESET_APP' }, response => {
      if (response?.success) {
        toast({
          title: 'App Reset',
          description: 'The app has been reset successfully. Please reconnect your wallet.',
          status: 'success',
          duration: 5000,
          isClosable: true,
        });
      } else {
        toast({
          title: 'Reset Failed',
          description: 'Failed to reset the app. Please try again.',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    });
  };

  const handleAnnounceProvider = () => {
    // Send a postMessage for "ANNOUNCE_REQUEST"
    window.postMessage(
      {
        type: 'ANNOUNCE_REQUEST',
        provider: {
          name: 'KeepKey',
          uuid: '350670db-19fa-4704-a166-e52e178b59d4',
          icon: 'https://pioneers.dev/coins/keepkey.png',
          rdns: 'com.keepkey',
        },
      },
      '*',
    );
    toast({
      title: 'Provider Announced',
      description: 'KeepKey provider has been announced.',
      status: 'info',
      duration: 3000,
      isClosable: true,
    });
  };

  return (
    <VStack spacing={4}>
      {/* More Docs Link - Prominent and on top */}
      <Link href="https://keepkey-docs-repo.vercel.app" isExternal>
        <Button variant="solid" colorScheme="teal" size="lg" w="100%" mt={4} mb={6}>
          📖 Visit KeepKey Docs
        </Button>
      </Link>

      <Link href="https://www.keepkey.com" isExternal w="100%">
        <Button variant="ghost" w="100%">
          About KeepKey
        </Button>
      </Link>

      <Image src={'https://i.ibb.co/jR8WcJM/kk.gif'} alt="KeepKey" />
      <VStack spacing={4} align="stretch">
        <Text fontSize="md" fontWeight="bold">
          Enable Masking
        </Text>

        {/* Firefox Option - Enabled */}
        <HStack w="100%" justifyContent="space-between">
          <HStack>
            <Avatar
              size="md"
              name="Firefox"
              src="https://forum.zeroqode.com/uploads/default/original/2X/4/401498d7adfbb383fea695394f4f653ea4e7c9a7.png"
            />
            <Text>Enable Firefox</Text>
          </HStack>
          <Switch size="md" />
        </HStack>

        {/* XDEFI Option - Coming Soon */}
        <HStack w="100%" justifyContent="space-between" position="relative" opacity={isComingSoon('XDEFI') ? 0.5 : 1}>
          <HStack>
            <Avatar
              size="md"
              name="XDEFI"
              src="https://images.crunchbase.com/image/upload/c_pad,f_auto,q_auto:eco,dpr_1/cs5s7reskl2onltpd7gw"
            />
            <Text>Enable XDEFI</Text>
          </HStack>
          <Switch size="md" isDisabled={isComingSoon('XDEFI')} />
          {isComingSoon('XDEFI') && (
            <Box
              position="absolute"
              top="0"
              left="0"
              w="100%"
              h="100%"
              bg="rgba(0, 0, 0, 0.6)"
              color="white"
              display="flex"
              alignItems="center"
              justifyContent="center"
              fontWeight="bold">
              Coming Soon
            </Box>
          )}
        </HStack>

        {/* Keplr Option - Coming Soon */}
        <HStack w="100%" justifyContent="space-between" position="relative" opacity={isComingSoon('Keplr') ? 0.5 : 1}>
          <HStack>
            <Avatar
              size="md"
              name="Keplr"
              src="https://cdn.dealspotr.com/io-images/logo/keplr.jpg?fit=contain&trim=true&flatten=true&extend=10&width=500&height=500"
            />
            <Text>Enable Keplr</Text>
          </HStack>
          <Switch size="md" isDisabled={isComingSoon('Keplr')} />
          {isComingSoon('Keplr') && (
            <Box
              position="absolute"
              top="0"
              left="0"
              w="100%"
              h="100%"
              bg="rgba(0, 0, 0, 0.6)"
              color="white"
              display="flex"
              alignItems="center"
              justifyContent="center"
              fontWeight="bold">
              Coming Soon
            </Box>
          )}
        </HStack>

        <Text fontSize="sm" color="gray.500">
          This setting may conflict with these apps if also enabled.
        </Text>

        {/* Force Reset Button */}
        <Button colorScheme="red" variant="solid" w="100%" onClick={handleForceReset}>
          Force Reset App
        </Button>

        {/* Announce Provider Button */}
        <Button colorScheme="blue" variant="solid" w="100%" onClick={handleAnnounceProvider}>
          Announce Provider
        </Button>
      </VStack>
    </VStack>
  );
};

export default Settings;
