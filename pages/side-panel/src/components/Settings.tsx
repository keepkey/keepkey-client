import React, { useEffect, useState } from 'react';
import { VStack, HStack, Avatar, Text, Switch, Link, Button, Image, Box, Code, useToast } from '@chakra-ui/react';
import { CopyIcon } from '@chakra-ui/icons';
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
  testnetSettingsStorage,
  agentModeStorage,
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
  const [showTestnets, setShowTestnets] = useState(false);
  const [agentMode, setAgentMode] = useState(false);

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

      const testnetSetting = await testnetSettingsStorage.getShowTestnets();
      setShowTestnets(testnetSetting);

      setAgentMode(await agentModeStorage.get());
    };

    loadSettings();
  }, []);

  const toggleAgentMode = async () => {
    const newValue = !agentMode;
    setAgentMode(newValue); // optimistic
    await agentModeStorage.set(newValue);
    toast({
      title: newValue ? 'MCP enabled' : 'MCP disabled',
      description: newValue
        ? 'Agents can now read wallet state over the local MCP bridge.'
        : 'The MCP bridge is disconnected; agents can no longer read wallet state.',
      status: newValue ? 'success' : 'info',
      duration: 4000,
      isClosable: true,
    });
  };

  const copyMcpConfig = async () => {
    const apiKey = await keepKeyApiKeyStorage.getApiKey();
    if (!apiKey) {
      toast({
        title: 'Not paired yet',
        description: 'Pair the extension with the KeepKey vault first, then copy the agent config.',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    const cmd = `claude mcp add --transport http keepkey http://localhost:1646/mcp --header "Authorization: Bearer ${apiKey}"`;
    // The getApiKey() await above can outlive transient user activation, and the
    // side panel loses document focus easily — either makes writeText reject.
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Clipboard access was blocked. Click the side panel to focus it, then try again.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    toast({
      title: 'Agent config copied',
      description: 'Contains your local pairing key — treat it like a secret. Paste it into your agent terminal.',
      status: 'success',
      duration: 5000,
      isClosable: true,
    });
  };

  const toggleTestnets = async () => {
    const newValue = !showTestnets;
    setShowTestnets(newValue); // optimistic
    chrome.runtime.sendMessage({ type: 'SET_TESTNETS_ENABLED', enabled: newValue }, response => {
      if (response?.success) {
        toast({
          title: newValue ? 'Testnets added' : 'Testnets removed',
          status: 'success',
          duration: 2000,
        });
      } else {
        setShowTestnets(!newValue); // revert
        toast({ title: 'Failed to toggle testnets', description: response?.error, status: 'error', duration: 3000 });
      }
    });
  };

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
  const isComingSoon = (name: string) => ['Xfi', 'Keplr'].includes(name);

  return (
    <VStack spacing={4}>
      {/* More Docs Link - Prominent and on top */}
      <Link href="https://docs.keepkey.com" isExternal>
        <Button variant="solid" size="lg" w="100%" mt={4} mb={6}>
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
          Networks
        </Text>

        {/* Show Testnets */}
        <HStack w="100%" justifyContent="space-between">
          <Text>Show Testnets</Text>
          <Switch size="md" isChecked={showTestnets} onChange={toggleTestnets} />
        </HStack>
        <Text fontSize="xs" color="whiteAlpha.700" mt={-2} mb={2}>
          Adds Ethereum Sepolia, Base Sepolia, and Solana Devnet with default public RPCs. Turning off removes them.
        </Text>

        <Text fontSize="md" fontWeight="bold">
          Agent Mode (MCP)
        </Text>

        {/* Enable MCP bridge */}
        <HStack w="100%" justifyContent="space-between">
          <Text>Enable MCP</Text>
          <Switch size="md" isChecked={agentMode} onChange={toggleAgentMode} />
        </HStack>
        <Text fontSize="xs" color="kk.dim" mt={-2} mb={2}>
          Lets an AI agent (Claude Code, Claude Desktop, …) read wallet state over a local Model Context Protocol bridge
          — device status, accounts, pending requests, connected sites, and logs. Today's tools only read. The lasting
          guarantee is not that list, which will grow, but the device: no agent can sign, because every signature still
          requires the physical button. Off by default.{' '}
          <Link href="https://docs.keepkey.com/docs/bex/mcp" isExternal textDecoration="underline">
            Learn more
          </Link>
        </Text>

        {/* Copy agent connection config */}
        <Button leftIcon={<CopyIcon />} variant="outline" size="sm" w="100%" onClick={copyMcpConfig}>
          Copy agent config
        </Button>
        <Text fontSize="xs" color="kk.dim" mt={1} mb={2}>
          Copies a <Code fontSize="xs">claude mcp add</Code> command with your local pairing key. It contains a secret —
          paste it only into your own agent, never share it. The agent connects once you enable MCP above.
        </Text>

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
        <Text fontSize="xs" color="kk.dim" mt={-2} mb={2}>
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
        <Text fontSize="xs" color="kk.dim" mt={-2} mb={2}>
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
              color="kk.text"
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
              color="kk.text"
              display="flex"
              alignItems="center"
              justifyContent="center"
              fontWeight="bold">
              Coming Soon
            </Box>
          )}
        </Box>

        <Text fontSize="sm" color="kk.dim">
          This setting may conflict with these apps if also enabled.
        </Text>

        {/* Force Reset Button */}
        <Button variant="solid" bg="kk.bad" color="kk.text" w="100%" onClick={clearCustomStorages}>
          Clear Storage
        </Button>

        {/* Force Reset Button */}
        <Button variant="solid" bg="kk.bad" color="kk.text" w="100%" onClick={handleForceReset}>
          Force Reset App
        </Button>

        {/* Announce Provider Button */}
        <Button variant="solid" w="100%" onClick={handleAnnounceProvider}>
          Announce Provider
        </Button>
      </VStack>
    </VStack>
  );
};

export default Settings;
