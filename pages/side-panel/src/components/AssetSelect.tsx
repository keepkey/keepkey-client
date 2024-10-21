import React, { useState, useEffect } from 'react';
import { Box, Button, Flex, Switch, Text, Avatar, useToast, Badge } from '@chakra-ui/react';
import { availableChainsByWallet, ChainToNetworkId, getChainEnumValue, NetworkIdToChain } from '@coinmasters/types';
//@ts-ignore
import { COIN_MAP_LONG } from '@pioneer-platform/pioneer-coins';
import { blockchainStorage } from '@extension/storage';

const middleEllipsisStyle = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100px', // Adjust the width as needed
};

export function AssetSelect({ setShowAssetSelect }: any) {
  const [allChains, setAllChains] = useState<string[]>([]);
  const [wallet, setWallet] = useState<string>('KEEPKEY');
  const [walletOptions, setWalletOptions] = useState<string[]>(Object.keys(availableChainsByWallet));
  const [enabledChains, setEnabledChains] = useState<string[]>([]);
  const toast = useToast();

  useEffect(() => {
    onStart();
  }, [wallet]);

  useEffect(() => {
    // Load saved blockchains from storage
    loadEnabledChains();
  }, []);

  const onStart = async function () {
    if (wallet) {
      const walletType = wallet.split(':')[0];
      const blockchainsForContext = availableChainsByWallet[walletType.toUpperCase()] || [];
      const allByCaip = blockchainsForContext.map((chainStr: any) => {
        const chainEnum = getChainEnumValue(chainStr);
        return chainEnum ? ChainToNetworkId[chainEnum] : undefined;
      });
      setAllChains(allByCaip);
    }
  };

  const loadEnabledChains = async () => {
    try {
      const savedChains = await blockchainStorage.getAllBlockchains();
      setEnabledChains(savedChains || []);
    } catch (error) {
      console.error('Failed to load enabled chains from storage', error);
    }
  };

  const toggleChain = async (chain: string) => {
    if (enabledChains.includes(chain)) {
      await blockchainStorage.removeBlockchain(chain);
      setEnabledChains(prev => prev.filter(c => c !== chain));
    } else {
      await blockchainStorage.addBlockchain(chain);
      setEnabledChains(prev => [...prev, chain]);
    }
  };

  const selectAllChains = async () => {
    setEnabledChains(allChains);
    for (const chain of allChains) {
      await blockchainStorage.addBlockchain(chain);
    }
  };

  const unselectAllChains = async () => {
    setEnabledChains([]);
    for (const chain of allChains) {
      await blockchainStorage.removeBlockchain(chain);
    }
  };

  const handleContinue = async () => {
    // Perform any save operation here if needed
    await loadEnabledChains(); // Reload the enabled chains, in case of updates
    setShowAssetSelect(false); // Close the modal or asset selection view
  };

  const renderChain = (chain: string) => (
    <Flex alignItems="center" justifyContent="space-between" p={2} borderBottomWidth="1px" borderColor="gray.200">
      <Flex alignItems="center">
        <Avatar
          size="sm"
          src={`https://pioneers.dev/coins/${(COIN_MAP_LONG as any)[(NetworkIdToChain as any)[chain]]}.png`}
          mr={4}
        />
        <Text fontWeight="bold">{(COIN_MAP_LONG as any)[(NetworkIdToChain as any)[chain]]}</Text>
      </Flex>
      <Flex alignItems="center">
        <Badge mr={4}>
          <Text fontSize="xs" style={middleEllipsisStyle}>
            {chain}
          </Text>
        </Badge>
        <Switch isChecked={enabledChains.includes(chain)} onChange={() => toggleChain(chain)} />
      </Flex>
    </Flex>
  );

  // Group and sort chains by type
  const { UTXO, EVM, others } = allChains.reduce(
    (acc: any, chain: any) => {
      if (chain.startsWith('bip122:')) acc.UTXO.push(chain);
      else if (chain.startsWith('eip155:')) acc.EVM.push(chain);
      else acc.others.push(chain);
      return acc;
    },
    { UTXO: [], EVM: [], others: [] },
  );

  const handleAddEvmChain = () => {
    console.log('Add EVM Chain button clicked');
    window.open('https://chainlist.org/', '_blank');
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
      </Flex>

      {UTXO.length > 0 && (
        <>
          <Text fontSize="xl" mb={4}>
            UTXO Chains
          </Text>
          {UTXO.map(renderChain)}
        </>
      )}
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
      {others.length > 0 && (
        <>
          <Text fontSize="xl" my={4}>
            Other Chains
          </Text>
          {others.map(renderChain)}
        </>
      )}
      <Button colorScheme="blue" onClick={handleContinue} mt={4}>
        Continue/Update
      </Button>
    </Box>
  );
}

export default AssetSelect;
