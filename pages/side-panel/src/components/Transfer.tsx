import {
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  Input,
  Spinner,
  Text,
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
import confetti from 'canvas-confetti'; // Make sure to install the confetti package

const TAG = ' | Transfer | ';

const convertToHex = (amountInEther: string) => {
  const weiMultiplier = BigInt(1e18); // 1 Ether = 1e18 Wei
  const amountInWei = BigInt(parseFloat(amountInEther || '0') * 1e18); // Convert Ether to Wei

  // Convert the amount in Wei to a hex string
  return '0x' + amountInWei.toString(16);
};

export function Transfer({}: any): JSX.Element {
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputAmount, setInputAmount] = useState(''); // Initialize as an empty string
  const [inputAmountUsd, setInputAmountUsd] = useState(''); // Initialize as an empty string
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memo, setMemo] = useState('');
  const [assetContext, setAssetContext] = useState<any>({});
  const [recipient, setRecipient] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [useUsdInput, setUseUsdInput] = useState(false);
  const [isMax, setIsMax] = useState(false);

  const { isOpen, onOpen, onClose } = useDisclosure();

  const bgColor = useColorModeValue('white', 'gray.700');
  const headingColor = useColorModeValue('teal.500', 'teal.300');

  useEffect(() => {
    // Request asset context and set initial state
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      setAssetContext(response.assets);
      if (response?.assets.icon) setAvatarUrl(response.assets.icon);
      if (response?.assets.priceUsd) setPriceUsd(response.assets.priceUsd);
    });
  }, []);

  const onStart = async function () {};

  useEffect(() => {
    onStart();
  }, []);

  const handleInputFocus = () => {
    // Optional: Clear input when focusing
    // setInputAmount('');
    // setInputAmountUsd('');
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;

    setIsMax(false); // Reset isMax if user manually changes input

    if (useUsdInput) {
      setInputAmountUsd(value);

      const parsedValue = parseFloat(value);
      if (!isNaN(parsedValue) && priceUsd) {
        setInputAmount((parsedValue / priceUsd).toFixed(4)); // 4 decimal places for NATIVE
      } else {
        setInputAmount('');
      }
    } else {
      setInputAmount(value);

      const parsedValue = parseFloat(value);
      if (!isNaN(parsedValue) && priceUsd) {
        setInputAmountUsd((parsedValue * priceUsd).toFixed(2)); // 2 decimal places for USD
      } else {
        setInputAmountUsd('');
      }
    }
  };

  const handleInputBlur = () => {
    if (!useUsdInput && inputAmount && !isNaN(parseFloat(inputAmount))) {
      setInputAmount(parseFloat(inputAmount).toFixed(4)); // 4 decimal places for NATIVE
    } else if (useUsdInput && inputAmountUsd && !isNaN(parseFloat(inputAmountUsd))) {
      setInputAmountUsd(parseFloat(inputAmountUsd).toFixed(2)); // 2 decimal places for USD
    }
  };

  const handleRecipientChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRecipient(event.target.value);
  };

  const handleSend = useCallback(async () => {
    try {
      if (!inputAmount || !recipient) {
        alert('You MUST input both amount and recipient to send!');
        return;
      }
      setIsSubmitting(true);

      const sendPayload = {
        amount: {
          amount: inputAmount,
          denom: assetContext?.symbol,
        },
        recipient,
        to: recipient,
        memo,
        isMax: isMax,
      };

      let chain;
      if (assetContext?.networkId) {
        if (assetContext.networkId.includes('eip155')) {
          chain = 'ethereum';
        } else {
          const chainFromNetworkId = NetworkIdToChain[assetContext.networkId];
          if (chainFromNetworkId) {
            chain = chainFromNetworkId.toLowerCase();
            console.log('chain2: ', chain.toUpperCase());
            const coinMapEntry = COIN_MAP_LONG[chain.toUpperCase()];
            console.log('coinMapEntry: ', coinMapEntry);
            if (coinMapEntry) {
              chain = coinMapEntry.toLowerCase();
            } else {
              throw new Error('Unsupported chain' + chain);
            }
          } else {
            throw new Error('Unsupported network ID');
          }
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
      console.log('requestInfo: ', requestInfo);

      chrome.runtime.sendMessage(
        {
          type: 'WALLET_REQUEST',
          requestInfo,
        },
        response => {
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
              title: 'Error',
              description: response.error,
              status: 'error',
              duration: 5000,
              isClosable: true,
            });
          }
        },
      );
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: error.toString(),
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
      onClose();
    }
  }, [inputAmount, recipient, memo, isMax, assetContext?.networkId, toast]);

  return (
    <>
      <VStack align="start" borderRadius="md" p={4} spacing={4} bg={bgColor} margin="0 auto">
        <Heading as="h1" mb={2} size="md" color={headingColor}>
          Send Crypto!
        </Heading>

        <Flex align="center" direction="row" gap={4}>
          <Avatar size="md" src={avatarUrl} />
          <Box>
            <Text mb={1}>
              Asset: <Badge colorScheme="green">{assetContext?.name}</Badge>
            </Text>
            <Text mb={1}>
              Chain: <Badge colorScheme="green">{assetContext?.networkId}</Badge>
            </Text>
            <Text mb={1}>
              Symbol: <Badge colorScheme="green">{assetContext?.symbol}</Badge>
            </Text>
          </Box>
        </Flex>

        <Grid gap={6} templateColumns="repeat(1, 1fr)" w="full">
          <FormControl>
            <FormLabel>Recipient:</FormLabel>
            <Input onChange={handleRecipientChange} placeholder="Address" value={recipient} />
          </FormControl>
          <FormControl>
            <FormLabel>Input Amount:</FormLabel>
            <Flex align="center">
              <Input
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                placeholder="0.0000"
                value={useUsdInput ? inputAmountUsd : inputAmount}
              />
              <Button ml={2} onClick={() => setUseUsdInput(!useUsdInput)}>
                {useUsdInput ? 'USD' : assetContext?.symbol || 'Symbol'}
              </Button>
              {/*<Button ml={2} onClick={setMaxAmount}>*/}
              {/*  Max*/}
              {/*</Button>*/}
            </Flex>
          </FormControl>
        </Grid>

        <Button
          colorScheme="green"
          w="full"
          mt={4}
          onClick={onOpen}
          isDisabled={isSubmitting || !inputAmount || !recipient}>
          {isSubmitting ? 'Sending...' : 'Send'}
        </Button>
      </VStack>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Transaction</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>Recipient: {recipient}</Text>
            <Text>
              Amount: {inputAmount} {assetContext?.symbol || 'Symbol'}
            </Text>
            <Text>Amount (USD): ${inputAmountUsd}</Text>
            {memo && <Text>Memo: {memo}</Text>}
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
