import React, { useEffect, useState } from 'react';
import { VStack, HStack, Avatar, Text, Switch, Link, Button, Image, Box, useToast } from '@chakra-ui/react';
import {
  maskingSettingsStorage,
  requestStorage,
  approvalStorage,
  completedStorage,
  assetContextStorage,
  blockchainStorage,
  blockchainDataStorage,
  dappStorage,
  keepKeyApiKeyStorage,
  web3ProviderStorage,
} from '@extension/storage';
const Settings = () => {
  const toast = useToast(); // For showing a success/failure message
  const [maskingSettings, setMaskingSettings] = useState({
    enableMetaMaskMasking: false,
    enableXfiMasking: false,
    enableKeplrMasking: false,
  });

  // Fetch initial masking settings from storage
  useEffect(() => {
    const loadSettings = async () => {
      const metaMaskSetting = await maskingSettingsStorage.getEnableMetaMaskMasking();
      const xfiSetting = await maskingSettingsStorage.getEnableXfiMasking();
      const keplrSetting = await maskingSettingsStorage.getEnableKeplrMasking();

      setMaskingSettings({
        enableMetaMaskMasking: metaMaskSetting,
        enableXfiMasking: xfiSetting,
        enableKeplrMasking: keplrSetting,
      });
    };

    loadSettings();
  }, []);

  // Toggle functions
  const toggleMetaMaskMasking = async () => {
    const newValue = !maskingSettings.enableMetaMaskMasking;
    await maskingSettingsStorage.setEnableMetaMaskMasking(newValue);
    setMaskingSettings(prev => ({ ...prev, enableMetaMaskMasking: newValue }));
  };

  const toggleXfiMasking = async () => {
    const newValue = !maskingSettings.enableXfiMasking;
    await maskingSettingsStorage.setEnableXfiMasking(newValue);
    setMaskingSettings(prev => ({ ...prev, enableXfiMasking: newValue }));
  };

  const toggleKeplrMasking = async () => {
    const newValue = !maskingSettings.enableKeplrMasking;
    await maskingSettingsStorage.setEnableKeplrMasking(newValue);
    setMaskingSettings(prev => ({ ...prev, enableKeplrMasking: newValue }));
  };

  const clearCustomStorages = async () => {
    try {
      console.log(TAG, 'Clearing all custom storages...');

      // Clear specific storages
      // await keepKeyApiKeyStorage.set(() => '');
      // console.log(TAG, 'Cleared API Key Storage');
      //
      // await requestStorage.clearEvents();
      // console.log(TAG, 'Cleared Request Storage');
      //
      // await approvalStorage.clearEvents();
      // console.log(TAG, 'Cleared Approval Storage');
      //
      // await completedStorage.clearEvents();
      // console.log(TAG, 'Cleared Completed Storage');
      //
      // await assetContextStorage.clearContext();
      // console.log(TAG, 'Cleared Asset Context Storage');

      await blockchainStorage.clear();
      console.log(TAG, 'Cleared Blockchain Storage');

      // await blockchainDataStorage.set(() => ({}));
      // console.log(TAG, 'Cleared Blockchain Data Storage');
      //
      // await dappStorage.set(() => []);
      // console.log(TAG, 'Cleared Dapp Storage');
      //
      // await web3ProviderStorage.clearWeb3Provider();
      // console.log(TAG, 'Cleared Web3 Provider Storage');
      //
      // await maskingSettingsStorage.set(() => ({
      //   enableMetaMaskMasking: false,
      //   enableXfiMasking: false,
      //   enableKeplrMasking: false,
      // }));
      console.log(TAG, 'Cleared Masking Settings Storage');

      console.log(TAG, 'All custom storages cleared successfully.');
    } catch (error) {
      console.error(TAG, 'Error clearing custom storages:', error);
    }
  };

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
          icon: chrome.runtime.getURL('kk-logo.png'),
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

  // Helper function to determine if an option is coming soon
  const isComingSoon = name => ['Xfi', 'Keplr'].includes(name);

  return (
    <VStack spacing={4}>
      {/* More Docs Link - Prominent and on top */}
      <Link href="https://docs.keepkey.info" isExternal>
        <Button variant="solid" colorScheme="teal" size="lg" w="100%" mt={4} mb={6}>
          📖 Visit KeepKey Docs
        </Button>
      </Link>

      <Link href="https://www.keepkey.com" isExternal w="100%">
        <Button variant="ghost" w="100%">
          About KeepKey
        </Button>
      </Link>

      <Image src="/kk.webp" alt="KeepKey" />

      <VStack spacing={4} align="stretch">
        <Text fontSize="md" fontWeight="bold">
          Enable Masking
        </Text>

        {/* MetaMask Masking */}
        <HStack w="100%" justifyContent="space-between">
          <HStack>
            <Avatar size="md" name="MetaMask" src="/brand/metamask-fox.svg" />
            <Text>Enable MetaMask Masking</Text>
          </HStack>
          <Switch size="md" isChecked={maskingSettings.enableMetaMaskMasking} onChange={toggleMetaMaskMasking} />
        </HStack>

        {/* Xfi Masking - Coming Soon */}
        <Box position="relative" w="100%">
          <HStack w="100%" justifyContent="space-between" opacity={isComingSoon('Xfi') ? 0.5 : 1}>
            <HStack>
              <Avatar size="md" name="Xfi" />
              <Text>Enable Xfi Masking</Text>
            </HStack>
            <Switch
              size="md"
              isChecked={maskingSettings.enableXfiMasking}
              onChange={toggleXfiMasking}
              isDisabled={isComingSoon('Xfi')}
            />
          </HStack>
          {isComingSoon('Xfi') && (
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
        </Box>

        {/* Keplr Masking - Coming Soon */}
        <Box position="relative" w="100%">
          <HStack w="100%" justifyContent="space-between" opacity={isComingSoon('Keplr') ? 0.5 : 1}>
            <HStack>
              <Avatar size="md" name="Keplr" src="/brand/keplr.png" />
              <Text>Enable Keplr Masking</Text>
            </HStack>
            <Switch
              size="md"
              isChecked={maskingSettings.enableKeplrMasking}
              onChange={toggleKeplrMasking}
              isDisabled={isComingSoon('Keplr')}
            />
          </HStack>
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
        </Box>

        <Text fontSize="sm" color="gray.500">
          This setting may conflict with these apps if also enabled.
        </Text>

        {/* Force Reset Button */}
        <Button colorScheme="red" variant="solid" w="100%" onClick={clearCustomStorages}>
          Clear Storage
        </Button>

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
