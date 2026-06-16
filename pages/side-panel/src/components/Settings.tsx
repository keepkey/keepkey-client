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
  customEvmNetworksStorage,
  ethAccountsStorage,
} from '@extension/storage';

const TAG = ' | Settings | ';

const Settings = () => {
  const toast = useToast(); // For showing a success/failure message
  const [maskingSettings, setMaskingSettings] = useState({
    enableMetaMaskMasking: false,
    enableXfiMasking: false,
    enableKeplrMasking: false,
    enablePhantomMasking: false,
  });

  // Fetch initial masking settings from storage
  useEffect(() => {
    const loadSettings = async () => {
      const metaMaskSetting = await maskingSettingsStorage.getEnableMetaMaskMasking();
      const xfiSetting = await maskingSettingsStorage.getEnableXfiMasking();
      const keplrSetting = await maskingSettingsStorage.getEnableKeplrMasking();
      const phantomSetting = await maskingSettingsStorage.getEnablePhantomMasking();

      setMaskingSettings({
        enableMetaMaskMasking: metaMaskSetting,
        enableXfiMasking: xfiSetting,
        enableKeplrMasking: keplrSetting,
        enablePhantomMasking: phantomSetting,
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

  const togglePhantomMasking = async () => {
    const newValue = !maskingSettings.enablePhantomMasking;
    await maskingSettingsStorage.setEnablePhantomMasking(newValue);
    setMaskingSettings(prev => ({ ...prev, enablePhantomMasking: newValue }));
  };

  const clearCustomStorages = async () => {
    try {
      console.log(TAG, 'Clearing all custom storages...');

      // Each storage exposes its own "clear" affordance (clearEvents,
      // clearContext, clearWeb3Provider) or the raw `.set` from the base
      // storage helper. Run in parallel via allSettled so one failure
      // doesn't strand the others. Masking settings are deliberately left
      // alone — they're user preferences, not accumulated data, and
      // "clear everything I added" shouldn't reset privacy toggles.
      const results = await Promise.allSettled([
        keepKeyApiKeyStorage.saveApiKey(''),
        requestStorage.clearEvents(),
        approvalStorage.clearEvents(),
        completedStorage.clearEvents(),
        assetContextStorage.clearContext(),
        blockchainStorage.set(() => []),
        blockchainDataStorage.set(() => ({})),
        dappStorage.set(() => []),
        web3ProviderStorage.clearWeb3Provider(),
        // User-added EVM networks. The header dropdown reads this directly,
        // so omitting it from the clear meant "reset everything" left the
        // list intact and stale networks kept showing up after clear.
        customEvmNetworksStorage.set(() => []),
        // Extra ETH accounts persist separately from paths/pubkeys — on
        // startup the background rehydrates saved indices and re-adds the
        // derivation paths. Without clearing this, "All persisted data has
        // been removed" was a lie that reappeared at the next reload.
        // Reset to [0] (account 0 is the implicit baseline).
        ethAccountsStorage.set(() => [0]),
      ]);

      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(TAG, `Clear-all completed with ${failures.length} failure(s):`, failures);
      }
      console.log(TAG, 'All custom storages cleared successfully.');
      toast({
        title: failures.length === 0 ? 'Storage cleared' : 'Storage partially cleared',
        description:
          failures.length === 0
            ? 'All persisted data has been removed.'
            : `${results.length - failures.length}/${results.length} storages cleared. Check the console for details.`,
        status: failures.length === 0 ? 'success' : 'warning',
        duration: 4000,
        isClosable: true,
      });
    } catch (error) {
      console.error(TAG, 'Error clearing custom storages:', error);
      toast({
        title: 'Clear failed',
        description: (error as Error)?.message || 'Unexpected error while clearing storages.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
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
      <Link href="https://docs.keepkey.com" isExternal>
        <Button variant="solid" colorScheme="teal" size="lg" w="100%" mt={4} mb={6}>
          📖 Visit KeepKey Docs
        </Button>
      </Link>

      <Link href="https://www.keepkey.com" isExternal w="100%">
        <Button variant="ghost" w="100%">
          About KeepKey
        </Button>
      </Link>

      <Image src="/kk.gif" alt="KeepKey" />

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
        <Text fontSize="xs" color="whiteAlpha.700" mt={-2} mb={2}>
          When on, KeepKey claims to be MetaMask on legacy dApps (Stripe, older sites) by mounting
          <code> window.ethereum </code>
          with <code>isMetaMask: true</code>. Modern dApps still see KeepKey via EIP-6963. Refresh any open dApp after
          toggling.
        </Text>

        {/* Phantom (Solana) Masking */}
        <HStack w="100%" justifyContent="space-between">
          <HStack>
            <Avatar size="md" name="Phantom" src="/brand/phantom.svg" />
            <Text>Enable Phantom Masking</Text>
          </HStack>
          <Switch size="md" isChecked={maskingSettings.enablePhantomMasking} onChange={togglePhantomMasking} />
        </HStack>
        <Text fontSize="xs" color="whiteAlpha.700" mt={-2} mb={2}>
          When on, KeepKey claims to be Phantom on legacy Solana dApps by mounting
          <code> window.solana </code>
          with <code>isPhantom: true</code>. Modern dApps still see KeepKey via the Solana Wallet Standard. Only mounts
          if no other Solana wallet is installed. Refresh any open dApp after toggling.
        </Text>

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

        <Text fontSize="sm" color="whiteAlpha.700">
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
