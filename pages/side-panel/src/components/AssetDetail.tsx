import React, { useState, useEffect } from 'react';
import { VStack, HStack, Box, Flex, Text, Button, Avatar, useToast, IconButton, Spinner } from '@chakra-ui/react';
import { ArrowUpIcon, ArrowDownIcon, CopyIcon, CheckIcon } from '@chakra-ui/icons';

interface AssetDetailProps {
  asset: any;
  balances: any[];
  onSend: () => void;
  onReceive: () => void;
}

const AssetDetail = ({ asset, balances, onSend, onReceive }: AssetDetailProps) => {
  const [address, setAddress] = useState<string>('');
  const [hasCopied, setHasCopied] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const toast = useToast();

  // Get balance for this asset
  const chainBalances = balances.filter(b => b.networkId === asset.networkId);
  const nativeBalances = chainBalances.filter(b => b.isNative === true || b.caip === asset.caip);
  let totalBalance = 0;
  if (nativeBalances.length > 0) {
    totalBalance = nativeBalances.reduce((acc, b) => acc + parseFloat(b.balance || '0'), 0);
  } else {
    const bal = balances.find(b => b.caip === asset.caip);
    totalBalance = parseFloat(bal?.balance || '0');
  }
  const totalUsdValue = chainBalances.reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);

  // Build icon URL using caipToIcon pattern
  const iconUrl = asset.icon || `https://api.keepkey.info/coins/${btoa(asset.caip || '').replace(/=+$/, '')}.png`;

  // Fetch address for this network
  useEffect(() => {
    // Check if address is already in asset pubkeys
    if (asset.pubkeys?.[0]?.address) {
      setAddress(asset.pubkeys[0].address);
      return;
    }

    if (asset.address) {
      setAddress(asset.address);
      return;
    }

    // Otherwise fetch from background
    if (asset.networkId) {
      setLoadingAddress(true);
      chrome.runtime.sendMessage({ type: 'GET_PUBKEYS_FOR_NETWORK', networkId: asset.networkId }, response => {
        if (response?.pubkeys?.[0]) {
          setAddress(response.pubkeys[0].address || response.pubkeys[0].master || '');
        }
        setLoadingAddress(false);
      });
    }
  }, [asset]);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setHasCopied(true);
      toast({ title: 'Address copied!', status: 'success', duration: 2000 });
      setTimeout(() => setHasCopied(false), 2000);
    }
  };

  const formatAddress = (addr: string) => {
    if (!addr) return '';
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
  };

  return (
    <VStack spacing={5} align="center" pt={4} px={2}>
      {/* Asset icon */}
      <Avatar src={iconUrl} size="lg" />

      {/* Balance */}
      <VStack spacing={1}>
        <Text fontSize="2xl" fontWeight="bold" color="white">
          {totalBalance.toFixed(4)} {asset.symbol}
        </Text>
        <Text fontSize="lg" color="whiteAlpha.700">
          ${totalUsdValue.toFixed(2)}
        </Text>
      </VStack>

      {/* Address */}
      {loadingAddress ? (
        <Spinner size="sm" />
      ) : address ? (
        <Flex
          bg="whiteAlpha.100"
          borderRadius="lg"
          px={4}
          py={2}
          align="center"
          gap={2}
          border="1px solid"
          borderColor="whiteAlpha.200"
          maxW="100%">
          <Text fontFamily="mono" fontSize="sm" color="whiteAlpha.800" isTruncated>
            {formatAddress(address)}
          </Text>
          <IconButton
            icon={hasCopied ? <CheckIcon /> : <CopyIcon />}
            aria-label="Copy address"
            size="xs"
            variant="ghost"
            colorScheme={hasCopied ? 'green' : 'gray'}
            onClick={handleCopy}
          />
        </Flex>
      ) : null}

      {/* Action buttons */}
      <HStack spacing={4} w="100%">
        <Button leftIcon={<ArrowUpIcon />} colorScheme="blue" variant="solid" size="md" flex={1} onClick={onSend}>
          Send
        </Button>
        <Button leftIcon={<ArrowDownIcon />} colorScheme="green" variant="solid" size="md" flex={1} onClick={onReceive}>
          Receive
        </Button>
      </HStack>
    </VStack>
  );
};

export default AssetDetail;
