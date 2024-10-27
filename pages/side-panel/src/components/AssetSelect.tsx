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

interface AssetSelectProps {
  setShowAssetSelect: (show: boolean) => void;
}

export function AssetSelect({ setShowAssetSelect }: AssetSelectProps) {
  const [blockchains, setBlockchains] = useState<Chain[]>([]);
  const [walletOptions, setWalletOptions] = useState<string[]>(Object.keys(availableChainsByWallet));
  const toast = useToast();

  // Effect to load enabled chains on component mount
  useEffect(() => {
    onStart();
  }, []);

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
        let blockchain: Chain = {
          networkId,
          name: COIN_MAP_LONG[(NetworkIdToChain as any)[networkId]] || 'unknown',
          image: `https://pioneers.dev/coins/${COIN_MAP_LONG[(NetworkIdToChain as any)[networkId]] || 'unknown'}.png`,
          isEnabled: true,
        };

        // Fetch additional asset data if name is 'unknown'
        if (blockchain.name === 'unknown') {
          const assetData = await blockchainDataStorage.getBlockchainData(networkId);
          if (assetData && assetData.name) {
            blockchain.name = assetData.name;
            blockchain.image = assetData.image || `https://pioneers.dev/coins/${assetData.name.toLowerCase()}.png`;
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

    const isCurrentlyEnabled = chain.isEnabled;

    if (isCurrentlyEnabled) {
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
      try {
        await blockchainStorage.addBlockchain(networkId);
        const assetData = await getAssetData(networkId);
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

    setBlockchains(prevBlockchains =>
      prevBlockchains.map(c => (c.networkId === networkId ? { ...c, isEnabled: !c.isEnabled } : c)),
    );
  };

  return (
    <Box>
      <Flex justifyContent="space-between" mb={4}>
        <Button size="sm" variant="outline" colorScheme="green" onClick={selectAllChains}>
          Select All
        </Button>
        <Button size="sm" variant="outline" colorScheme="red" onClick={unselectAllChains}>
          Unselect All
        </Button>
        <Button size="sm" variant="outline" colorScheme="blue" onClick={handleRefresh}>
          Refresh
        </Button>
      </Flex>

      {blockchains.map(renderChain)}

      <Button colorScheme="blue" onClick={handleContinue} mt={4} width="100%">
        Continue/Update
      </Button>
    </Box>
  );
}

export default AssetSelect;
