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
  Tooltip,
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
import { ChevronDownIcon, ChevronUpIcon, InfoOutlineIcon } from '@chakra-ui/icons';
import React, { useCallback, useEffect, useState } from 'react';
import { NetworkIdToChain } from '@pioneer-platform/pioneer-caip';
//@ts-ignore
import confetti from 'canvas-confetti'; // Make sure to install the confetti package

const TAG = ' | Transfer | ';

const convertToHex = (amountInEther) => {
  const weiMultiplier = BigInt(1e18); // 1 Ether = 1e18 Wei
  const amountInWei = BigInt(parseFloat(amountInEther) * 1e18); // Convert Ether to Wei

  // Convert the amount in Wei to a hex string
  return '0x' + amountInWei.toString(16);
};

export function Transfer({}: any): JSX.Element {
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputAmount, setInputAmount] = useState(0);
  const [inputAmountUsd, setInputAmountUsd] = useState(0);
  const [sendAmount, setSendAmount] = useState<any | undefined>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memo, setMemo] = useState('');
  const [assetContext, setAssetContext] = useState<any>({});
  const [recipient, setRecipient] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [maxSpendable, setMaxSpendable] = useState('');
  const [loadingMaxSpendable, setLoadingMaxSpendable] = useState(true);
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

  const onStart = async function () {
    const tag = TAG + ' | onStart Transfer | ';
    chrome.runtime.sendMessage({ type: 'GET_MAX_SPENDABLE' }, maxSpendableResponse => {
      if (maxSpendableResponse && maxSpendableResponse.maxSpendable) {
        setMaxSpendable(maxSpendableResponse.maxSpendable);
        setLoadingMaxSpendable(false);
      } else {
        toast({
          title: 'Error',
          description: 'Failed to fetch max spendable amount.',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        setLoadingMaxSpendable(false);
      }
    });
  };

  useEffect(() => {
    onStart();
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setIsMax(false); // Reset isMax if user manually changes input
    if (useUsdInput) {
      setInputAmountUsd(value);
      setInputAmount((parseFloat(value) / (priceUsd || 1)).toFixed(8));
    } else {
      setInputAmount(value);
      setInputAmountUsd((parseFloat(value) * (priceUsd || 1)).toFixed(2));
    }
  };

  const handleRecipientChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRecipient(event.target.value);
  };

  useEffect(() => {
    if (useUsdInput) {
      setInputAmountUsd((parseFloat(inputAmount) * (priceUsd || 1)).toFixed(2));
    } else {
      setInputAmount((parseFloat(inputAmountUsd) / (priceUsd || 1)).toFixed(8));
    }
  }, [useUsdInput, priceUsd]);

  const handleSend = useCallback(async () => {
    try {
      if (!inputAmount || !recipient) {
        alert('You MUST input both amount and recipient to send!');
        return;
      }
      setIsSubmitting(true);

      const sendPayload = {
        value: convertToHex(inputAmount),
        to:recipient,
        memo,
        isMax: isMax,
      };

      let chain = assetContext?.networkId.includes('eip155')
        ? 'ethereum'
        : NetworkIdToChain(assetContext?.networkId).toLowerCase();

      chain = chain.toLowerCase();

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

  const setMaxAmount = () => {
    const maxAmount = maxSpendable;
    setInputAmount(maxAmount);
    setInputAmountUsd((parseFloat(maxAmount) * (priceUsd || 1)).toFixed(2));
    setIsMax(true); // Set isMax to true when Max button is clicked
  };

  const formatMaxSpendable = (amount: string) => {
    const [integerPart, fractionalPart] = amount.toString().split('.');
    let formattedIntegerPart;
    if (integerPart.length > 4) {
      formattedIntegerPart = (
        <>
          <Text as="span">{integerPart.slice(0, 4)}</Text>
          <Text as="span" fontSize="sm">
            {integerPart.slice(4)}
          </Text>
        </>
      );
    } else {
      formattedIntegerPart = <Text as="span">{integerPart}</Text>;
    }
    let formattedFractionalPart;
    if (fractionalPart) {
      if (fractionalPart.length > 4) {
        formattedFractionalPart = (
          <>
            .<Text as="span">{fractionalPart.slice(0, 4)}</Text>
            <Text as="span" fontSize="sm">
              {fractionalPart.slice(4)}
            </Text>
          </>
        );
      } else {
        formattedFractionalPart = (
          <>
            .<Text as="span">{fractionalPart}</Text>
          </>
        );
      }
    } else {
      formattedFractionalPart = null;
    }
    return (
      <>
        {formattedIntegerPart}
        {formattedFractionalPart}
      </>
    );
  };

  if (loadingMaxSpendable) {
    return (
      <Flex align="center" justify="center" height="100vh">
        <Box p={10} borderRadius="md" boxShadow="lg" bg={bgColor}>
          <Flex align="center" justify="center">
            <Spinner size="xl" />
            <Text ml={4}>Calculating max spendable amount...</Text>
          </Flex>
        </Box>
      </Flex>
    );
  }

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
            <Text mb={1}>
              Max Spendable: {formatMaxSpendable(maxSpendable)} {assetContext?.symbol || 'Symbol'}
            </Text>
            <Badge colorScheme="teal" fontSize="sm">
              ${(parseFloat(maxSpendable) * (priceUsd || 1)).toFixed(2)} USD
            </Badge>
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
                placeholder="0.0"
                value={useUsdInput ? inputAmountUsd : inputAmount}
              />
              <Button ml={2} onClick={() => setUseUsdInput(!useUsdInput)}>
                {useUsdInput ? 'USD' : assetContext?.symbol || 'Symbol'}
              </Button>
              <Button ml={2} onClick={setMaxAmount}>
                Max
              </Button>
            </Flex>
          </FormControl>
        </Grid>

        <Button colorScheme="green" w="full" mt={4} onClick={onOpen} isDisabled={isSubmitting}>
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
