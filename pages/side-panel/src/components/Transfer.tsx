import {
  Avatar,
  Badge,
  Text,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  Input,
  VStack,
  useToast,
  useColorModeValue,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from '@chakra-ui/react';
import React, { useCallback, useEffect, useState } from 'react';
import { NetworkIdToChain } from '@pioneer-platform/pioneer-caip';
import { COIN_MAP_LONG } from '@pioneer-platform/pioneer-coins';
//@ts-ignore
import confetti from 'canvas-confetti';

const TAG = ' | Transfer | ';

const convertToHex = (amountInEther: string) => {
  const weiMultiplier = BigInt(1e18);
  const amountInWei = BigInt(parseFloat(amountInEther || '0') * 1e18);
  return '0x' + amountInWei.toString(16);
};

export function Transfer(): JSX.Element {
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputAmount, setInputAmount] = useState('');
  const [inputAmountUsd, setInputAmountUsd] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memo, setMemo] = useState('');
  const [assetContext, setAssetContext] = useState<any>({});
  const [recipient, setRecipient] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [useUsdInput, setUseUsdInput] = useState(false);
  const [isMax, setIsMax] = useState(false);
  const [totalBalance, setTotalBalance] = useState(0);
  const [isToken, setIsToken] = useState(false);
  const [tokenStandard, setTokenStandard] = useState<string>('');

  const { isOpen, onOpen, onClose } = useDisclosure();

  const bgColor = useColorModeValue('white', 'gray.700');
  const headingColor = useColorModeValue('teal.500', 'teal.300');

  const onStart = async () => {
    let tag = TAG + ' | onStart | ';
    try {
      let totalBalanceCalc = 0;
      console.log(tag, 'balances: ', assetContext?.balances);
      if (assetContext?.balances) {
        // Loop through balances to calculate total balance
        for (let i = 0; i < assetContext?.balances.length; i++) {
          console.log(tag, assetContext?.balances[i]);

          const balance = parseFloat(assetContext?.balances[i]?.balance) || 0; // Safely handle undefined balances
          totalBalanceCalc += balance; // Accumulate total balance
        }
        console.log('totalBalanceCalc: ', totalBalanceCalc);
        setTotalBalance(totalBalanceCalc);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    onStart();
  }, [assetContext]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      setAssetContext(response.assets);
      if (response?.assets.icon) setAvatarUrl(response.assets.icon);
      if (response?.assets.priceUsd) setPriceUsd(response.assets.priceUsd);

      // Detect if this is a token
      const caip = response?.assets?.caip || '';
      const isTokenAsset =
        caip.includes('/erc20:') ||
        caip.includes('/cw20:') ||
        caip.includes('/bep20:') ||
        response?.assets?.token === true;
      setIsToken(isTokenAsset);

      if (isTokenAsset) {
        const standard = caip.includes('/erc20:')
          ? 'ERC-20'
          : caip.includes('/cw20:')
            ? 'CW-20'
            : caip.includes('/bep20:')
              ? 'BEP-20'
              : 'Token';
        setTokenStandard(standard);
      }
    });
  }, []);

  const setMaxAmount = () => {
    const tag = TAG + ' | setMaxAmount | ';
    try {
      console.log(tag, assetContext?.balances);

      // Initialize total balance
      let totalBalance = 0;
      if (assetContext?.balances) {
        // Loop through balances to calculate total balance
        for (let i = 0; i < assetContext?.balances.length; i++) {
          console.log(tag, assetContext?.balances[i]);

          const balance = parseFloat(assetContext?.balances[i]?.balance) || 0; // Safely handle undefined balances
          totalBalance += balance; // Accumulate total balance
        }
        console.log(tag, 'Total Balance:', totalBalance);
        console.log(tag, 'Total Balance:', totalBalance.toString());
        setInputAmount(totalBalance.toString());
        console.log(tag, 'Total Balance:', totalBalance);

        // Set the max amount and mark as max
        setIsMax(true);
      }
    } catch (error) {
      console.error(`${TAG} setMaxAmount error:`, error);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setIsMax(false);

    if (useUsdInput) {
      setInputAmountUsd(value);
      const parsedValue = parseFloat(value);
      if (!isNaN(parsedValue) && priceUsd) {
        setInputAmount((parsedValue / priceUsd).toFixed(4));
      } else {
        setInputAmount('');
      }
    } else {
      setInputAmount(value);
      const parsedValue = parseFloat(value);
      if (!isNaN(parsedValue) && priceUsd) {
        setInputAmountUsd((parsedValue * priceUsd).toFixed(2));
      } else {
        setInputAmountUsd('');
      }
    }
  };

  const handleSend = useCallback(async () => {
    try {
      if (!inputAmount || !recipient) {
        toast({
          title: 'Validation Error',
          description: 'You must input both amount and recipient to send!',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      setIsSubmitting(true);

      const sendPayload = {
        caip: assetContext?.caip,
        amount: { amount: inputAmount, denom: assetContext?.symbol },
        recipient,
        memo,
        isMax,
      };

      // Log token transaction info for debugging
      if (isToken) {
        console.log(TAG, 'Sending token transaction:');
        console.log(TAG, '  Token CAIP:', assetContext?.caip);
        console.log(TAG, '  Token Standard:', tokenStandard);
        console.log(TAG, '  Amount:', inputAmount, assetContext?.symbol);
      }

      let chain: string | undefined;
      if (assetContext?.networkId) {
        chain = assetContext.networkId.includes('eip155')
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

      chrome.runtime.sendMessage({ type: 'WALLET_REQUEST', requestInfo }, response => {
        if (response.txHash) {
          confetti();
          toast({
            title: 'Transaction Successful',
            description: `Transaction ID: ${response.txHash}`,
            status: 'success',
            duration: 5000,
            isClosable: true,
          });
        } else if (response.error) {
          toast({
            title: 'Transaction Error',
            description: response.error,
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
        }
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : String(error),
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
      onClose();
    }
  }, [inputAmount, recipient, memo, isMax, assetContext, toast]);

  return (
    <>
      <VStack align="start" borderRadius="md" p={4} spacing={4} bg={bgColor} margin="0 auto">
        <Heading as="h1" size="md" color={headingColor}>
          Send {isToken ? tokenStandard : 'Crypto'}
        </Heading>

        <Flex align="center" gap={4}>
          <Avatar size="md" src={avatarUrl} />
          <Box>
            <Text>
              Asset: <Badge colorScheme="green">{assetContext?.name}</Badge>
              {isToken && (
                <Badge colorScheme="purple" ml={2}>
                  {tokenStandard}
                </Badge>
              )}
            </Text>
            <Text>
              Chain: <Badge colorScheme="green">{assetContext?.networkId}</Badge>
            </Text>
            <Text>
              Symbol: <Badge colorScheme="green">{assetContext?.symbol}</Badge>
            </Text>
            <Text>
              balance: <Badge colorScheme="green">{totalBalance}</Badge>
            </Text>
          </Box>
        </Flex>

        <Grid gap={4} templateColumns="1fr">
          <FormControl>
            <FormLabel>Recipient</FormLabel>
            <Input
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="Enter recipient address"
            />
          </FormControl>

          <FormControl>
            <FormLabel>Amount</FormLabel>
            <Flex>
              <Input
                value={useUsdInput ? inputAmountUsd : inputAmount}
                onChange={handleInputChange}
                placeholder="Enter amount"
              />
              <Button ml={2} onClick={() => setUseUsdInput(!useUsdInput)}>
                {useUsdInput ? 'USD' : assetContext?.symbol || 'Symbol'}
              </Button>
              {/* Conditionally hide this button if networkId includes "eip155" */}
              {!assetContext?.networkId?.includes('eip155') && (
                <Button ml={2} onClick={setMaxAmount}>
                  Max
                </Button>
              )}
            </Flex>
          </FormControl>
        </Grid>

        <Button colorScheme="green" w="full" isDisabled={isSubmitting || !inputAmount || !recipient} onClick={onOpen}>
          {isSubmitting ? 'Sending...' : 'Send'}
        </Button>
      </VStack>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm {isToken ? `${tokenStandard} Token ` : ''}Transaction</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>Recipient: {recipient}</Text>
            <Text>
              Amount: {inputAmount} {assetContext?.symbol}
              {isToken && (
                <Badge colorScheme="purple" ml={2}>
                  {tokenStandard}
                </Badge>
              )}
            </Text>
            {memo && <Text>Memo: {memo}</Text>}
            {isToken && (
              <Text fontSize="xs" color="gray.500" mt={2}>
                This will send {assetContext?.symbol} tokens on {assetContext?.networkId}
              </Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="red" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button colorScheme="green" onClick={handleSend} isLoading={isSubmitting}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default Transfer;
