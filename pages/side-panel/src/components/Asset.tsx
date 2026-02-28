import React, { useState, useEffect } from 'react';
import {
  VStack,
  Box,
  Flex,
  Text,
  Button,
  Spinner,
  Badge,
  Card,
  CardBody,
  HStack,
  Image,
  Skeleton,
  SkeletonCircle,
} from '@chakra-ui/react';
import { FaCoins } from 'react-icons/fa';
import { Transfer } from './Transfer';
import { Receive } from './Receive';

// TODO: Re-enable when stabilized:
// import AppStore from './AppStore';              // Dapps tab
// import TransactionHistoryModal from './TransactionHistoryModal'; // History modal
// import Tokens from './Tokens';                  // Tokens tab
// import { COIN_MAP_LONG } from '@extension/shared'; // Used by DataTable / cancel TX

interface Pubkey {
  note: string;
  url: string;
  type: string;
  pubkey: string;
  address?: string;
  networks: string[];
}

// Icon component with fallback for broken/empty images
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

// TODO: Re-enable DataTable when Advanced Data tab is restored
// const DataTable = ({ data, title }: { data: any; title?: string }) => { ... };

export function Asset() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive' | null>(null);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<any[]>([]);
  const [pubkeys, setPubkeys] = useState<Pubkey[]>([]);
  const [asset, setAsset] = useState<any>(null);
  const [isToken, setIsToken] = useState<boolean>(false);
  const [tokenMetadata, setTokenMetadata] = useState<any>(null);

  // TODO: Re-enable when tabs section is restored:
  // const [isEvm, setIsEvm] = useState<boolean>(false);
  // const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  // const [isReplaceTxModalOpen, setIsReplaceTxModalOpen] = useState(false);

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
    return () => chrome.runtime.onMessage.removeListener(messageListener);
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

        if (response.assets.pubkeys) {
          setPubkeys(response.assets.pubkeys);
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
    const addressEth = assetLoaded.pubkeys?.[0]?.address || assetLoaded.address;
    if (!addressEth) {
      chrome.runtime.sendMessage({ type: 'GET_PUBKEYS_FOR_NETWORK', networkId: assetLoaded.networkId }, resp => {
        if (resp?.pubkeys?.[0]?.address) {
          assetLoaded.address = resp.pubkeys[0].address;
          fetchEthereumBalance(assetLoaded);
        } else {
          console.error('No Ethereum address found');
          setLoading(false);
        }
      });
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
        let filteredBalances = response.balances.filter(
          (balance: any) => balance.caip === assetLoaded?.caip || balance.networkId === assetLoaded?.networkId,
        );

        if (filteredBalances.length > 1) {
          const totalBalance = filteredBalances.reduce(
            (acc: number, balance: any) => acc + Number(balance.balance || 0),
            0,
          );
          filteredBalances = [{ balance: totalBalance, symbol: assetLoaded?.symbol || '', caip: assetLoaded?.caip }];
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

      {/* TODO: Re-enable tabs section when features are stabilized:
       * - Tokens tab: <Tokens asset={asset} networkId={asset?.networkId} />
       * - Dapps tab: <AppStore networkId={asset?.networkId} />
       * - Recent tab (EVM only): Cancel/replace stuck transactions
       * - Advanced Data tab: DataTable showing raw asset/pubkey/balance data
       * - TransactionHistoryModal: View transaction history per pubkey
       * - Replace TX Modal: Build cancel transactions with custom nonce/fee
       */}
    </Flex>
  );
}

export default Asset;
