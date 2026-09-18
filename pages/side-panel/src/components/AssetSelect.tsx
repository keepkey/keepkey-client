import React, { useState, useEffect } from 'react';
import { Box, Button, Flex, Switch, Text, useToast } from '@chakra-ui/react';
import { AddIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { AssetIcon } from './AssetIcon';
import {
  availableChainsByWallet,
  ChainToNetworkId,
  getChainEnumValue,
  NetworkIdToChain,
  COIN_MAP_LONG,
  networkIdToIcon,
  FIRMWARE_GATED_CHAINS,
} from '@extension/shared';

type FwVersion = { major: number; minor: number; patch: number };
const versionMeets = (v: FwVersion | null, min: { major: number; minor: number; patch: number }): boolean => {
  if (!v) return false;
  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
};
import { blockchainStorage, blockchainDataStorage } from '@extension/storage';

// Function to fetch asset data from the backend via Chrome runtime
async function getAssetData(networkId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSETS_INFO', networkId }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching assets:', chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
        return;
      }
      if (response) {
        console.log('Assets response:', response);
        resolve(response);
      } else {
        console.error('Error: No assets found in the response');
        reject(new Error('No assets found'));
      }
    });
  });
}

interface Chain {
  name: string;
  image: string;
  networkId: string;
  isEnabled: boolean;
}

/** COIN_MAP_LONG yields lowercase, run-together names ("bitcoincash"). Title
 *  case them for display; the few compound names get an explicit entry rather
 *  than a guess at word boundaries. */
const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  bitcoincash: 'Bitcoin Cash',
  binance: 'BNB Chain',
  thorchain: 'THORChain',
  mayachain: 'Maya',
  bitcoin: 'Bitcoin',
  litecoin: 'Litecoin',
  dogecoin: 'Dogecoin',
  dash: 'Dash',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  avalanche: 'Avalanche',
  optimism: 'Optimism',
  polygon: 'Polygon',
  base: 'Base',
};

const displayChainName = (name: string): string =>
  CHAIN_DISPLAY_NAMES[name?.toLowerCase()] ?? (name ? name[0].toUpperCase() + name.slice(1) : 'Unknown');

/** `eip155:1` is readable and worth showing in full; a bip122 genesis hash is
 *  not, so it gets middle-truncated. */
const shortChainId = (networkId: string): string => {
  const [ns, ref = ''] = networkId.split(':');
  if (!ref) return networkId;
  const short = ref.length > 12 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref;
  return `${ns}:${short}`;
};

/** Collapsible group (the "collapse the category" ask). The header carries the
 *  enabled/total count so a collapsed section still says what is on inside it —
 *  otherwise collapsing hides the only thing the screen is about. */
const ChainSection = ({
  title,
  chains,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  chains: Chain[];
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => {
  const enabled = chains.filter(c => c.isEnabled).length;
  return (
    <Box mt={4}>
      <Flex
        as="button"
        onClick={onToggle}
        width="100%"
        alignItems="center"
        gap={2}
        height="40px"
        px={1}
        borderBottom="1px solid"
        borderColor="kk.line"
        background="transparent"
        cursor="pointer"
        aria-expanded={isOpen}
        _hover={{ '& .kk-section-title': { color: 'kk.text' } }}>
        <ChevronRightIcon
          boxSize={4}
          color="kk.faint"
          transform={isOpen ? 'rotate(90deg)' : 'none'}
          transition="transform 200ms cubic-bezier(.2,.8,.2,1)"
        />
        <Text className="kk-eyebrow kk-section-title" flex="1" textAlign="left">
          {title}
        </Text>
        <Text className="mono" fontSize="11px" color={enabled > 0 ? 'kk.accent' : 'kk.faint'}>
          {enabled}/{chains.length}
        </Text>
      </Flex>
      {isOpen && <Box animation="kk-rise 300ms cubic-bezier(.2,.8,.2,1) both">{children}</Box>}
    </Box>
  );
};

interface AssetSelectProps {
  setShowAssetSelect: (show: boolean) => void;
}

export function AssetSelect({ setShowAssetSelect }: AssetSelectProps) {
  const [blockchains, setBlockchains] = useState<Chain[]>([]);
  const [walletOptions, setWalletOptions] = useState<string[]>(Object.keys(availableChainsByWallet));
  const [firmwareVersion, setFirmwareVersion] = useState<FwVersion | null>(null);
  const toast = useToast();

  // Effect to load enabled chains on component mount
  useEffect(() => {
    onStart();
    // Firmware version gates chains like Hive (7.15.0+); null until read.
    chrome.runtime.sendMessage({ type: 'GET_FIRMWARE_VERSION' }, res => {
      if (!chrome.runtime.lastError) setFirmwareVersion(res?.version ?? null);
    });
  }, []);

  // Firmware-gate: locked (can't enable) until the device meets the min version.
  const chainLock = (networkId: string): { label: string } | null => {
    const gate = FIRMWARE_GATED_CHAINS[networkId];
    if (!gate || versionMeets(firmwareVersion, gate)) return null;
    return { label: gate.label };
  };

  /**
   * Initializes the blockchain data based on the selected wallet.
   * Fetches missing data from the backend and updates the storage and state.
   */
  const onStart = async () => {
    const tag = ' | onStart | ';
    try {
      const blockchainsForContext = availableChainsByWallet['KEEPKEY'];
      const allByCaip = blockchainsForContext
        .map((chainStr: any) => {
          const chainEnum = getChainEnumValue(chainStr);
          const networkId = chainEnum ? ChainToNetworkId[chainEnum] : undefined;
          return networkId;
        })
        .filter((networkId: string | undefined): networkId is string => networkId !== undefined);

      let blockchainsEnabled = allByCaip;

      // Get saved chains from storage
      const savedChains = await blockchainStorage.getAllBlockchains();
      if (savedChains && savedChains.length > 0) {
        blockchainsEnabled = [...new Set([...blockchainsEnabled, ...savedChains])];
      }

      const newBlockchains = [];

      for (const networkId of blockchainsEnabled) {
        const blockchain: Chain = {
          networkId,
          name: COIN_MAP_LONG[(NetworkIdToChain as any)[networkId]] || 'unknown',
          image: networkIdToIcon(networkId),
          isEnabled: true,
        };

        // Fetch additional asset data if name is 'unknown'
        if (blockchain.name === 'unknown') {
          const assetData = await blockchainDataStorage.getBlockchainData(networkId);
          if (assetData && assetData.name) {
            blockchain.name = assetData.name;
            blockchain.image = assetData.image || networkIdToIcon(networkId);
          }
        }

        newBlockchains.push(blockchain);
      }

      setBlockchains(newBlockchains);
    } catch (error) {
      console.error('Error initializing blockchains:', error);
      toast({
        title: 'Initialization Error',
        description: 'Failed to load blockchains.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const toggleChain = async (networkId: string) => {
    const chain = blockchains.find(c => c.networkId === networkId);
    if (!chain) return;

    const lock = chainLock(networkId);
    if (lock) {
      toast({
        title: `${chain.name} requires firmware ${lock.label}`,
        description: 'Update your KeepKey in the KeepKey Vault desktop app to enable it.',
        status: 'info',
        duration: 4000,
        isClosable: true,
      });
      return;
    }

    const isCurrentlyEnabled = chain.isEnabled;

    if (isCurrentlyEnabled) {
      // Disable the chain
      try {
        await blockchainStorage.removeBlockchain(networkId);
        await blockchainDataStorage.removeBlockchainData(networkId);
        toast({
          title: 'Chain Disabled',
          description: `${chain.name} has been disabled.`,
          status: 'info',
          duration: 3000,
          isClosable: true,
        });
      } catch (error) {
        console.error(`Failed to disable chain ${networkId}`, error);
        toast({
          title: 'Error',
          description: `Failed to disable ${chain.name}.`,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        return;
      }
    } else {
      // Enable the chain
      try {
        await blockchainStorage.addBlockchain(networkId);
        const assetData = await getAssetData(networkId);
        console.log('assetData:', assetData);
        await blockchainDataStorage.addBlockchainData(networkId, assetData);
        toast({
          title: 'Chain Enabled',
          description: `${chain.name} has been enabled.`,
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
      } catch (error) {
        console.error(`Failed to enable chain ${networkId}`, error);
        toast({
          title: 'Error',
          description: `Failed to enable ${chain.name}.`,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        return;
      }
    }

    // Update the state
    setBlockchains(prevBlockchains =>
      prevBlockchains.map(c => (c.networkId === networkId ? { ...c, isEnabled: !c.isEnabled } : c)),
    );
  };

  /**
   * Selects all chains by enabling them and updating storage.
   */
  const selectAllChains = async () => {
    const tag = ' | selectAllChains | ';
    try {
      // Enable all chains in storage (skip firmware-locked ones like Hive).
      const allnetworkIds = blockchains.map(chain => chain.networkId).filter(id => !chainLock(id));
      await blockchainStorage.addBlockchains(allnetworkIds);
      console.log(tag, 'All chains added to storage:', allnetworkIds);

      // Fetch and store data for all chains
      for (const networkId of allnetworkIds) {
        try {
          const assetData = await getAssetData(networkId);
          await blockchainDataStorage.addBlockchainData(networkId, assetData);
          console.log(tag, `Blockchain data added for ${networkId}`);
        } catch (error) {
          console.error(`Failed to fetch data for networkId ${networkId}`, error);
          toast({
            title: 'Error',
            description: `Failed to fetch data for chain ${networkId}`,
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
        }
      }

      // Update the state to enable all chains
      setBlockchains(prevBlockchains =>
        prevBlockchains.map(chain => ({
          ...chain,
          isEnabled: true,
        })),
      );

      toast({
        title: 'All Chains Selected',
        description: 'All available chains have been enabled.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error('Failed to select all chains', error);
      toast({
        title: 'Error',
        description: 'Failed to select all chains.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  /**
   * Unselects all chains by disabling them and updating storage.
   */
  const unselectAllChains = async () => {
    const tag = ' | unselectAllChains | ';
    try {
      // Disable all chains in storage

      const allnetworkIds = blockchains.map(chain => chain.networkId);
      await blockchainStorage.removeBlockchains(allnetworkIds);
      console.log(tag, 'All chains removed from storage:', allnetworkIds);

      // Remove blockchain data for all chains
      for (const networkId of allnetworkIds) {
        try {
          await blockchainDataStorage.removeBlockchainData(networkId);
          console.log(tag, `Blockchain data removed for ${networkId}`);
        } catch (error) {
          console.error(`Failed to remove data for networkId ${networkId}`, error);
          toast({
            title: 'Error',
            description: `Failed to remove data for chain ${networkId}`,
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
        }
      }

      // Update the state to disable all chains
      setBlockchains(prevBlockchains =>
        prevBlockchains.map(chain => ({
          ...chain,
          isEnabled: false,
        })),
      );

      toast({
        title: 'All Chains Unselected',
        description: 'All available chains have been disabled.',
        status: 'info',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error('Failed to unselect all chains', error);
      toast({
        title: 'Error',
        description: 'Failed to unselect all chains.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  /**
   * Handles the continuation action, such as closing the modal.
   */
  const handleContinue = async () => {
    await onStart(); // Reload enabled chains from storage
    setShowAssetSelect(false); // Close the modal or asset selection view
    toast({
      title: 'Selection Updated',
      description: 'Your asset selections have been updated.',
      status: 'success',
      duration: 3000,
      isClosable: true,
    });
  };

  /**
   * Renders one chain as a v2 hairline row (KEEPKEY_STYLE.md §0): 28px logo,
   * display name, and the chain id as a mono sub-line. The id used to sit in a
   * badge competing with the name; as a sub-line it stays available for the
   * people who need it (EVM ids like `eip155:1` are genuinely useful) without
   * fighting the name for attention. The full CAIP is on the row's title.
   */
  const renderChain = (chain: Chain) => {
    const lock = chainLock(chain.networkId);
    return (
      <Flex
        key={chain.networkId}
        alignItems="center"
        gap={3}
        height="60px"
        px={1}
        borderBottom="1px solid"
        borderColor="kk.line"
        opacity={lock ? 0.55 : 1}
        title={chain.networkId}>
        <AssetIcon src={chain.image} symbol={chain.name} size={28} />
        <Box flex="1" minWidth={0}>
          <Text fontSize="14px" fontWeight={500} color="kk.text" noOfLines={1}>
            {displayChainName(chain.name)}
          </Text>
          <Text fontSize="11px" color="kk.faint" className="mono" mt="3px" noOfLines={1}>
            {lock ? `REQUIRES FIRMWARE ${lock.label}+` : shortChainId(chain.networkId)}
          </Text>
        </Box>
        <Switch
          isChecked={chain.isEnabled && !lock}
          isDisabled={!!lock}
          onChange={() => toggleChain(chain.networkId)}
          aria-label={`Enable ${displayChainName(chain.name)}`}
        />
      </Flex>
    );
  };

  // Group and sort chains by type
  const { UTXO, EVM, others } = blockchains.reduce(
    (acc: any, chain: Chain) => {
      if (chain.networkId.startsWith('bip122:')) acc.UTXO.push(chain);
      else if (chain.networkId.startsWith('eip155:')) acc.EVM.push(chain);
      else acc.others.push(chain);
      return acc;
    },
    { UTXO: [] as Chain[], EVM: [] as Chain[], others: [] as Chain[] },
  );

  /**
   * Opens a new tab to add an EVM chain.
   */
  const handleAddEvmChain = () => {
    console.log('Add EVM Chain button clicked');
    window.open('https://chainlist.org/', '_blank');
  };

  /**
   * Handles the refresh action to reload blockchains.
   */
  const handleRefresh = async () => {
    const tag = ' | handleRefresh | ';
    try {
      toast({
        title: 'Refreshing',
        description: 'Refreshing the blockchain list...',
        status: 'info',
        duration: 2000,
        isClosable: true,
      });
      await onStart();
      toast({
        title: 'Refreshed',
        description: 'Blockchain list has been refreshed.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error(tag, 'Error during refresh:', error);
      toast({
        title: 'Refresh Error',
        description: 'Failed to refresh blockchain list.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Sections start collapsed unless they already hold an enabled chain, so the
  // screen opens on what the user actually has rather than on 20 rows of
  // everything. Initialised once, after the first load resolves.
  const [openSections, setOpenSections] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (openSections || blockchains.length === 0) return;
    const anyOn = (list: Chain[]) => list.some(c => c.isEnabled);
    setOpenSections({ UTXO: anyOn(UTXO), EVM: anyOn(EVM), Other: anyOn(others) });
  }, [blockchains, openSections, UTXO, EVM, others]);

  const sections = openSections ?? { UTXO: false, EVM: false, Other: false };
  const toggleSection = (key: string) => setOpenSections({ ...sections, [key]: !sections[key] });

  return (
    <Flex direction="column" flex="1" minHeight={0}>
      <Box flex="1" minHeight={0} overflowY="auto">
        {/* Bulk utilities are flat text actions, not buttons. They are not the
            point of the screen and three outlined buttons read as three
            competing primaries (§0: chips and text buttons stay flat). */}
        <Flex alignItems="center" gap={4} height="40px" px={1}>
          <Button variant="link" size="xs" className="mono" color="kk.dim" onClick={selectAllChains}>
            SELECT ALL
          </Button>
          <Button variant="link" size="xs" className="mono" color="kk.dim" onClick={unselectAllChains}>
            CLEAR
          </Button>
          <Box flex="1" />
          <Button variant="link" size="xs" className="mono" color="kk.dim" onClick={handleRefresh}>
            REFRESH
          </Button>
        </Flex>

        {UTXO.length > 0 && (
          <ChainSection title="UTXO chains" chains={UTXO} isOpen={sections.UTXO} onToggle={() => toggleSection('UTXO')}>
            {UTXO.map(renderChain)}
          </ChainSection>
        )}

        {EVM.length > 0 && (
          <ChainSection title="EVM chains" chains={EVM} isOpen={sections.EVM} onToggle={() => toggleSection('EVM')}>
            {EVM.map(renderChain)}
            {/* Was a gold keycap stranded mid-scroll. A screen gets one gold
                primary and it lives in the footer (§4, §9), so this becomes a
                flat mono action matching "ADD A CHAIN" on the dashboard. */}
            <Box
              as="button"
              onClick={handleAddEvmChain}
              height="48px"
              border={0}
              background="transparent"
              color="kk.faint"
              fontSize="11px"
              className="mono"
              letterSpacing="0.1em"
              cursor="pointer"
              display="flex"
              alignItems="center"
              gap="8px"
              px={1}
              _hover={{ color: 'kk.accent' }}>
              <AddIcon boxSize="10px" />
              <span>ADD AN EVM CHAIN</span>
            </Box>
          </ChainSection>
        )}

        {others.length > 0 && (
          <ChainSection
            title="Other chains"
            chains={others}
            isOpen={sections.Other}
            onToggle={() => toggleSection('Other')}>
            {others.map(renderChain)}
          </ChainSection>
        )}
      </Box>

      {/* The screen's single gold primary, in a fixed footer (§4). */}
      <Box flex="none" pt={3} pb="22px" borderTop="1px solid" borderColor="kk.line">
        <Button width="100%" height="48px" onClick={handleContinue}>
          Save chains
        </Button>
      </Box>
    </Flex>
  );
}

export default AssetSelect;
