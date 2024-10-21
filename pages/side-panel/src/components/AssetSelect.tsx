import React, { useState, useEffect } from 'react';
import { Box, Button, Flex, Switch, Text, Avatar, useToast, Badge } from '@chakra-ui/react';
import { availableChainsByWallet, ChainToNetworkId, getChainEnumValue, NetworkIdToChain } from '@coinmasters/types';
// @ts-ignore
import { COIN_MAP_LONG } from '@pioneer-platform/pioneer-coins';
import { blockchainStorage, blockchainDataStorage } from '@extension/storage';

// Styles for truncating text with ellipsis
const middleEllipsisStyle = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100px', // Adjust the width as needed
};

// Function to fetch asset data from the backend via Chrome runtime
async function getAssetData(chainId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSETS_INFO', chainId }, response => {
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
  chainId: string;
  isEnabled: boolean;
}

interface AssetSelectProps {
  setShowAssetSelect: (show: boolean) => void;
}

export function AssetSelect({ setShowAssetSelect }: AssetSelectProps) {
  const [blockchains, setBlockchains] = useState<Chain[]>([]);
  const [wallet, setWallet] = useState<string>('KEEPKEY');
  const [walletOptions, setWalletOptions] = useState<string[]>(Object.keys(availableChainsByWallet));
  const toast = useToast();

  // Effect to initialize component on wallet change
  useEffect(() => {
    onStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  // Effect to load enabled chains on component mount
  useEffect(() => {
    loadEnabledChains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Initializes the blockchain data based on the selected wallet.
   * Fetches missing data from the backend and updates the storage and state.
   */
  const onStart = async () => {
    if (wallet) {
      const walletType = wallet.split(':')[0].toUpperCase();
      const blockchainsForContext = availableChainsByWallet[walletType] || [];

      // Map chain strings to chain IDs
      const allByCaip = blockchainsForContext
        .map((chainStr: any) => {
          const chainEnum = getChainEnumValue(chainStr);
          const chainId = chainEnum ? ChainToNetworkId[chainEnum] : undefined;
          return chainId;
        })
        .filter((chainId: string | undefined): chainId is string => chainId !== undefined);

      // Create initial blockchains data
      const blockchainsData: Chain[] = allByCaip.map((chainId: string) => ({
        name: (COIN_MAP_LONG as any)[(NetworkIdToChain as any)[chainId]] || 'Unknown',
        image: `https://pioneers.dev/coins/${(COIN_MAP_LONG as any)[(NetworkIdToChain as any)[chainId]]}.png`,
        chainId,
        isEnabled: false, // Initially false, will be updated based on storage
      }));

      try {
        // Get saved chains from storage
        const savedChains = await blockchainStorage.getAllBlockchains();

        // Update isEnabled status based on savedChains
        const updatedBlockchainsData = blockchainsData.map(chain => ({
          ...chain,
          isEnabled: savedChains.includes(chain.chainId),
        }));

        // Identify missing chains that are not in storage
        const missingChainIds = allByCaip.filter(chainId => !savedChains.includes(chainId));

        // Fetch and store missing blockchain data
        for (const chainId of missingChainIds) {
          try {
            const assetData = await getAssetData(chainId);
            await blockchainDataStorage.addBlockchainData(chainId, assetData);
          } catch (error) {
            console.error(`Failed to fetch data for chainId ${chainId}`, error);
            toast({
              title: 'Error',
              description: `Failed to fetch data for chain ${chainId}`,
              status: 'error',
              duration: 5000,
              isClosable: true,
            });
          }
        }

        // Update the state with the updated blockchains data
        setBlockchains(updatedBlockchainsData);
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
    }
  };

  /**
   * Loads enabled chains from storage and updates the state.
   */
  const loadEnabledChains = async () => {
    try {
      const savedChains = await blockchainStorage.getAllBlockchains();
      setBlockchains(prevBlockchains =>
        prevBlockchains.map(chain => ({
          ...chain,
          isEnabled: savedChains.includes(chain.chainId),
        })),
      );
    } catch (error) {
      console.error('Failed to load enabled chains from storage', error);
      toast({
        title: 'Load Error',
        description: 'Failed to load enabled chains.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  /**
   * Toggles the enabled status of a blockchain.
   * @param chainId - The ID of the chain to toggle.
   */
  const toggleChain = async (chainId: string) => {
    const chain = blockchains.find(c => c.chainId === chainId);
    if (!chain) return;

    const isCurrentlyEnabled = chain.isEnabled;

    if (isCurrentlyEnabled) {
      // Disable the chain
      try {
        await blockchainStorage.removeBlockchain(chainId);
        await blockchainDataStorage.removeBlockchainData(chainId);
        toast({
          title: 'Chain Disabled',
          description: `${chain.name} has been disabled.`,
          status: 'info',
          duration: 3000,
          isClosable: true,
        });
      } catch (error) {
        console.error(`Failed to disable chain ${chainId}`, error);
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
        await blockchainStorage.addBlockchain(chainId);
        const assetData = await getAssetData(chainId);
        await blockchainDataStorage.addBlockchainData(chainId, assetData);
        toast({
          title: 'Chain Enabled',
          description: `${chain.name} has been enabled.`,
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
      } catch (error) {
        console.error(`Failed to enable chain ${chainId}`, error);
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
      prevBlockchains.map(c => (c.chainId === chainId ? { ...c, isEnabled: !c.isEnabled } : c)),
    );
  };

  /**
   * Selects all chains by enabling them and updating storage.
   */
  const selectAllChains = async () => {
    try {
      // Enable all chains in storage
      const allChainIds = blockchains.map(chain => chain.chainId);
      await blockchainStorage.addBlockchains(allChainIds);

      // Fetch and store data for all chains
      for (const chainId of allChainIds) {
        try {
          const assetData = await getAssetData(chainId);
          await blockchainDataStorage.addBlockchainData(chainId, assetData);
        } catch (error) {
          console.error(`Failed to fetch data for chainId ${chainId}`, error);
          toast({
            title: 'Error',
            description: `Failed to fetch data for chain ${chainId}`,
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
    try {
      // Disable all chains in storage
      const allChainIds = blockchains.map(chain => chain.chainId);
      await blockchainStorage.removeBlockchains(allChainIds);

      // Remove blockchain data for all chains
      for (const chainId of allChainIds) {
        try {
          await blockchainDataStorage.removeBlockchainData(chainId);
        } catch (error) {
          console.error(`Failed to remove data for chainId ${chainId}`, error);
          toast({
            title: 'Error',
            description: `Failed to remove data for chain ${chainId}`,
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
    await loadEnabledChains(); // Reload enabled chains from storage
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
   * Renders a single blockchain item with its details and toggle switch.
   * @param chain - The blockchain data to render.
   */
  const renderChain = (chain: Chain) => (
    <Flex
      key={chain.chainId}
      alignItems="center"
      justifyContent="space-between"
      p={2}
      borderBottomWidth="1px"
      borderColor="gray.200">
      <Flex alignItems="center">
        <Avatar size="sm" src={chain.image} mr={4} />
        <Text fontWeight="bold">{chain.name}</Text>
      </Flex>
      <Flex alignItems="center">
        <Badge mr={4}>
          <Text fontSize="xs" style={middleEllipsisStyle}>
            {chain.chainId}
          </Text>
        </Badge>
        <Switch isChecked={chain.isEnabled} onChange={() => toggleChain(chain.chainId)} />
      </Flex>
    </Flex>
  );

  // Group and sort chains by type
  const { UTXO, EVM, others } = blockchains.reduce(
    (acc: any, chain: Chain) => {
      if (chain.chainId.startsWith('bip122:')) acc.UTXO.push(chain);
      else if (chain.chainId.startsWith('eip155:')) acc.EVM.push(chain);
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
  };

  return (
    <Box>
      {/* Select All, Unselect All, and Refresh Buttons */}
      <Flex justifyContent="space-between" mb={4}>
        <Button size="sm" variant="outline" colorScheme="green" onClick={selectAllChains}>
          Select All
        </Button>
        <Button size="sm" variant="outline" colorScheme="red" onClick={unselectAllChains}>
          Unselect All
        </Button>
        {/* Refresh Button */}
        <Button size="sm" variant="outline" colorScheme="blue" onClick={handleRefresh}>
          Refresh
        </Button>
      </Flex>

      {/* UTXO Chains Section */}
      {UTXO.length > 0 && (
        <>
          <Text fontSize="xl" mb={4}>
            UTXO Chains
          </Text>
          {UTXO.map(renderChain)}
        </>
      )}

      {/* EVM Chains Section */}
      {EVM.length > 0 && (
        <>
          <Text fontSize="xl" my={4}>
            EVM Chains
          </Text>
          {EVM.map(renderChain)}
          <Button mt={2} colorScheme="blue" onClick={handleAddEvmChain}>
            Add an EVM Chain
          </Button>
        </>
      )}

      {/* Other Chains Section */}
      {others.length > 0 && (
        <>
          <Text fontSize="xl" my={4}>
            Other Chains
          </Text>
          {others.map(renderChain)}
        </>
      )}

      {/* Continue/Update Button */}
      <Button colorScheme="blue" onClick={handleContinue} mt={4} width="100%">
        Continue/Update
      </Button>
    </Box>
  );
}

export default AssetSelect;
