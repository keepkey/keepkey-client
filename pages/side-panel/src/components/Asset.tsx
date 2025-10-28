import React, { useState, useEffect } from 'react';
import {
  VStack,
  Avatar,
  Box,
  Stack,
  Flex,
  Text,
  Button,
  Spinner,
  Badge,
  Card,
  CardBody,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Input,
  HStack,
  Image,
  Skeleton,
  SkeletonCircle,
} from '@chakra-ui/react';
import { FaCoins } from 'react-icons/fa';
import { Transfer } from './Transfer';
import { Receive } from './Receive';
import AppStore from './AppStore';
import TransactionHistoryModal from './TransactionHistoryModal';
import Tokens from './Tokens';
import { COIN_MAP_LONG } from '@pioneer-platform/pioneer-coins';

interface Pubkey {
  note: string;
  url: string;
  type: string;
  pubkey: string;
  address?: string;
  networks: string[];
}

// Icon component with fallback for broken/empty images (reused from Tokens.tsx)
const IconWithFallback = ({ src, alt, boxSize }: { src: string | null; alt: string; boxSize: string }) => {
  const [error, setError] = useState(false);

  const cleanUrl = React.useMemo(() => {
    if (!src || src.trim() === '') {
      return null;
    }

    if (src.includes(',')) {
      const urls = src
        .split(',')
        .map(u => u.trim())
        .filter(u => u.startsWith('http://') || u.startsWith('https://'));
      return urls[0] || null;
    }

    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      return null;
    }

    return src;
  }, [src]);

  if (!cleanUrl || error) {
    return (
      <Box
        boxSize={boxSize}
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontSize="2xl"
        color="whiteAlpha.500"
        bg="rgba(255, 255, 255, 0.08)"
        borderRadius="md"
        border="1px solid"
        borderColor="whiteAlpha.200">
        <FaCoins />
      </Box>
    );
  }

  return (
    <Box
      boxSize={boxSize}
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="rgba(255, 255, 255, 0.08)"
      borderRadius="md"
      p="3px"
      position="relative"
      border="1px solid"
      borderColor="whiteAlpha.200">
      <Image
        src={cleanUrl}
        alt={alt}
        boxSize="100%"
        objectFit="contain"
        onError={() => {
          setError(true);
        }}
      />
    </Box>
  );
};

export function Asset() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | null>(null);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<any[]>([]);
  const [pubkeys, setPubkeys] = useState<Pubkey[]>([]);
  const [asset, setAsset] = useState<any>(null);
  const [isEvm, setIsEvm] = useState<boolean>(false);
  const [assetType, setAssetType] = useState<string>(''); // EVM TENDERMINT UTXO OTHER
  const [showHistoryButton, setShowHistoryButton] = useState<boolean>(false);
  const [showAllPubkeys, setShowAllPubkeys] = useState(false);
  const [isToken, setIsToken] = useState<boolean>(false);
  const [tokenMetadata, setTokenMetadata] = useState<any>(null);

  // Modal state
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isReplaceTxModalOpen, setIsReplaceTxModalOpen] = useState(false);
  const [nonce, setNonce] = useState('');
  const [fee, setFee] = useState('');

  const fetchTxHistory = (networkId: any) => {
    console.log('GET_TX_HISTORY');
    chrome.runtime.sendMessage({ type: 'GET_TX_HISTORY', networkId }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching transaction history:', chrome.runtime.lastError.message);
        return;
      }
      console.log('Transaction history response:', response);
    });
  };

  useEffect(() => {
    fetchAssetContext();
  }, []);

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'ASSET_CONTEXT_UPDATED' && message.assetContext) {
        console.log('ASSET_CONTEXT_UPDATED:', message.assetContext);
        setAsset(message.assetContext);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
  }, []);

  useEffect(() => {
    if (asset) {
      // Detect if this is a token CAIP
      const isTokenAsset =
        asset.caip?.includes('/erc20:') ||
        asset.caip?.includes('/cw20:') ||
        asset.caip?.includes('/bep20:') ||
        asset.token === true;
      setIsToken(isTokenAsset);

      if (isTokenAsset) {
        // Extract token metadata from asset context
        const contractAddress = asset.contractAddress || asset.caip?.split(':')[2] || null;
        setTokenMetadata({
          contractAddress,
          decimals: asset.decimals,
          isCustom: asset.isCustomToken || false,
          tokenStandard: asset.caip?.includes('/erc20:')
            ? 'ERC-20'
            : asset.caip?.includes('/cw20:')
              ? 'CW-20'
              : asset.caip?.includes('/bep20:')
                ? 'BEP-20'
                : 'Token',
        });
      } else {
        setTokenMetadata(null);
      }

      fetchBalancesAndPubkeys(asset);
    }
  }, [asset]);

  const fetchAssetContext = () => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching asset context:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.assets) {
        setAsset(response.assets);
        console.log('assetContext: ', response.assets);

        if (response.assets.pubkeys) {
          setPubkeys(response.assets.pubkeys);
        }

        // Fetch transaction history in parallel (non-blocking)
        if (response.assets.networkId.indexOf('eip155') !== -1) {
          fetchTxHistory(response.assets.networkId);
        }

        // Set isEvm state based on networkId containing 'evm'
        if (response.assets?.networkId && response.assets?.networkId?.includes('eip155')) {
          setIsEvm(true);
        } else {
          setIsEvm(false);
        }
      } else {
        setLoading(false);
      }
    });
  };

  const fetchBalancesAndPubkeys = (assetLoaded: any) => {
    if (assetLoaded?.caip?.includes('eip155')) {
      fetchEthereumBalance(assetLoaded);
    } else {
      fetchAppBalances(assetLoaded);
    }
  };

  const fetchEthereumBalance = (assetLoaded: any) => {
    setLoading(true);
    const addressEth = assetLoaded.pubkeys[0]?.address;
    if (!addressEth) {
      console.error('No Ethereum address found');
      setLoading(false);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'WALLET_REQUEST',
        requestInfo: {
          chain: 'ethereum',
          method: 'eth_getBalance',
          params: [addressEth, 'latest'],
        },
      },
      response => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching balance:', chrome.runtime.lastError.message);
          setLoading(false);
          return;
        }
        if (response && response.result) {
          const balanceWei = BigInt(response.result);
          const balanceEth = Number(balanceWei) / 1e18;
          const formattedBalance = formatBalance(balanceEth);

          setBalances([{ balance: formattedBalance, symbol: assetLoaded.symbol }]);
        } else {
          console.error('Invalid response for balance:', response);
        }
        setLoading(false);
      },
    );
  };

  const fetchAppBalances = (assetLoaded: any) => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching balances:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (response && response.balances) {
        let filteredBalances = response.balances.filter((balance: any) => balance.caip === assetLoaded.caip);

        //if balances > 1 then sum all balances
        if (filteredBalances.length > 1) {
          const totalBalance = filteredBalances.reduce((acc, balance) => acc + Number(balance.balance), 0);
          filteredBalances = [{ balance: totalBalance, symbol: assetLoaded.symbol }];
        }

        setBalances(filteredBalances);
      } else {
        console.error('Invalid response for balances:', response);
      }
      setLoading(false);
    });
  };

  const formatBalance = (balance: number) => {
    if (balance === 0) {
      return '0.0000';
    }
    return balance.toFixed(4);
  };

  const openUrl = (pubkey: Pubkey) => {
    console.log('asset:  ', asset);
    console.log('pubkey:  ', pubkey);
    if (asset.explorerXpubLink) {
      console.log('xpub detected!');
      //use this
      const url = `${asset.explorerXpubLink}${pubkey.pubkey}`;
      window.open(url, '_blank');
    } else {
      console.log('address detected!');
      //use this
      const url = `${asset.explorerAddressLink}${pubkey.address || pubkey.pubkey}`;
      window.open(url, '_blank');
    }
  };

  const filteredPubkeys = pubkeys.filter((pubkey: Pubkey) => {
    if (asset?.networkId?.startsWith('eip155')) {
      return pubkey.networks.some((networkId: any) => networkId.startsWith('eip155'));
    }
    return pubkey?.networks?.includes(asset.networkId);
  });

  const handleReplaceTxClick = () => {
    setIsReplaceTxModalOpen(true);
  };

  const handleSubmitCancelTx = () => {
    // Build and submit the cancel transaction using nonce and fee
    // Placeholder for actual implementation

    /*
      Send a 0 amount tx to yourself with a forced nonce and forced 40pct high fee
     */

    const sendPayload = {
      amount: { amount: inputAmount, denom: assetContext?.symbol },
      recipient,
      memo,
      isMax,
    };

    let chain: string | undefined;
    if (assetContext?.networkId) {
      chain = assetContext?.networkId?.includes('eip155')
        ? 'ethereum'
        : NetworkIdToChain[assetContext.networkId]?.toLowerCase();

      if (chain && COIN_MAP_LONG[chain.toUpperCase()]) {
        chain = COIN_MAP_LONG[chain.toUpperCase()].toLowerCase();
      }

      if (!chain) {
        throw new Error(`Unsupported chain or network ID: ${assetContext.networkId}`);
      }
    } else {
      throw new Error('Network ID is undefined');
    }

    const requestInfo = {
      method: 'transfer',
      params: [sendPayload],
      chain,
      siteUrl: 'KeepKey Browser Extension',
    };

    // Close the modal
    setIsReplaceTxModalOpen(false);
  };

  return (
    <Flex direction="column" minHeight="100vh" width="100%">
      <Card>
        <CardBody>
          {loading ? (
            <VStack spacing={4} width="100%">
              {/* Skeleton Header */}
              <Flex align="center" justify="space-between" width="100%" mb={4}>
                <HStack spacing={3}>
                  <SkeletonCircle size="60px" />
                  <VStack align="flex-start" spacing={2}>
                    <Skeleton height="20px" width="120px" />
                    <Skeleton height="16px" width="80px" />
                  </VStack>
                </HStack>
              </Flex>

              {/* Skeleton Buttons */}
              <VStack spacing={2} width="100%">
                <Skeleton height="40px" width="100%" borderRadius="md" />
                <Skeleton height="40px" width="100%" borderRadius="md" />
                <Skeleton height="40px" width="100%" borderRadius="md" />
              </VStack>

              {/* Loading Indicator */}
              <Flex justify="center" align="center" py={4}>
                <Spinner size="sm" color="blue.400" mr={2} />
                <Text fontSize="sm" color="whiteAlpha.600">
                  Loading asset details...
                </Text>
              </Flex>
            </VStack>
          ) : activeTab === null && asset ? (
            <>
              <Box textAlign="center">
                <Badge>caip: {asset.caip}</Badge>
              </Box>

              <Flex align="center" justifyContent="space-between" mb={4}>
                <IconWithFallback src={asset.icon} alt={asset.name || asset.symbol} boxSize="60px" />
                <Box ml={3} flex="1">
                  <HStack spacing={2} align="center">
                    <Text fontSize="lg" fontWeight="bold">
                      {asset.name}
                    </Text>
                    {isToken && tokenMetadata && (
                      <Badge colorScheme="purple" fontSize="xs" px={2} py={1}>
                        {tokenMetadata.tokenStandard}
                      </Badge>
                    )}
                  </HStack>
                  <Text fontSize="md" color="whiteAlpha.800">
                    {asset.symbol}
                  </Text>
                  {isToken && tokenMetadata?.contractAddress && (
                    <Text fontSize="xs" color="whiteAlpha.600" fontFamily="mono" mt={1}>
                      {tokenMetadata.contractAddress.slice(0, 6)}...
                      {tokenMetadata.contractAddress.slice(-4)}
                    </Text>
                  )}
                </Box>
                {/*<Box>*/}
                {/*  {balances.length > 0 ? (*/}
                {/*    balances.map((balance: any, index: any) => (*/}
                {/*      <Text key={index}>*/}
                {/*        <Text as="span" fontSize="lg">*/}
                {/*          {formatBalance(Number(balance.balance))}*/}
                {/*        </Text>*/}
                {/*        <Box ml={3} display="inline">*/}
                {/*          <Badge ml={2} colorScheme="teal">*/}
                {/*            ({balance.symbol || asset.symbol})*/}
                {/*          </Badge>*/}
                {/*        </Box>*/}
                {/*      </Text>*/}
                {/*    ))*/}
                {/*  ) : (*/}
                {/*    <Text>No balance available</Text>*/}
                {/*  )}*/}
                {/*</Box>*/}
              </Flex>

              <Flex direction="column" align="center" mb={4} width="100%">
                <Button my={2} size="md" variant="outline" width="100%" onClick={() => setActiveTab('send')}>
                  <HStack spacing={2}>
                    <Text>Send {asset.symbol}</Text>
                    {isToken && (
                      <Badge colorScheme="purple" size="sm">
                        Token
                      </Badge>
                    )}
                  </HStack>
                </Button>
                <Button my={2} size="md" variant="outline" width="100%" onClick={() => setActiveTab('receive')}>
                  <HStack spacing={2}>
                    <Text>Receive {asset.symbol}</Text>
                    {isToken && (
                      <Badge colorScheme="purple" size="sm">
                        Token
                      </Badge>
                    )}
                  </HStack>
                </Button>

                <Button my={2} size="md" variant="outline" width="100%" onClick={() => setIsHistoryModalOpen(true)}>
                  View History
                </Button>
              </Flex>
            </>
          ) : activeTab === 'send' ? (
            <Transfer onClose={() => setActiveTab(null)} />
          ) : activeTab === 'receive' ? (
            <Receive onClose={() => setActiveTab(null)} />
          ) : (
            <Flex justifyContent="center" p={5}>
              <Text>No asset selected (Go Back!)</Text>
            </Flex>
          )}
        </CardBody>
      </Card>

      <TransactionHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        pubkeys={filteredPubkeys}
        asset={asset}
        openUrl={openUrl}
      />

      {/* Replace TX Modal */}
      <Modal isOpen={isReplaceTxModalOpen} onClose={() => setIsReplaceTxModalOpen(false)}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Build Cancel TX</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4}></VStack>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="blue" mr={3} onClick={handleSubmitCancelTx}>
              Submit
            </Button>
            <Button variant="ghost" onClick={() => setIsReplaceTxModalOpen(false)}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Box mt={4}>
        <Tabs variant="enclosed" mt={4} defaultIndex={0}>
          <TabList>
            <Tab>Tokens</Tab>
            <Tab>Dapps</Tab>
            {isEvm && <Tab>Recent</Tab>}
          </TabList>
          <TabPanels>
            <TabPanel>
              <Tokens asset={asset} networkId={asset?.networkId} />
            </TabPanel>
            <TabPanel>
              <AppStore networkId={asset?.networkId} />
            </TabPanel>
            {isEvm && (
              <TabPanel>
                <Text>EVM support</Text>
                <Button my={2} size="md" variant="outline" width="100%" onClick={handleReplaceTxClick}>
                  Build Cancel TX
                </Button>
                <Text mt={2}>Stuck TX? Build a cancel transaction.</Text>
              </TabPanel>
            )}
          </TabPanels>
        </Tabs>
      </Box>
    </Flex>
  );
}

export default Asset;
