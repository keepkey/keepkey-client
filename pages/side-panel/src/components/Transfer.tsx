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
//@ts-ignore
import confetti from 'canvas-confetti'; // Make sure to install the confetti package

const TAG = ' | Transfer | ';

export function Transfer({}: any): JSX.Element {
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputAmount, setInputAmount] = useState('');
  const [inputAmountUsd, setInputAmountUsd] = useState('');
  const [sendAmount, setSendAmount] = useState<any | undefined>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memo, setMemo] = useState('');
  const [assetContext, setAssetContext] = useState({});
  const [recipient, setRecipient] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [maxSpendable, setMaxSpendable] = useState('');
  const [loadingMaxSpendable, setLoadingMaxSpendable] = useState(true);
  const [useUsdInput, setUseUsdInput] = useState(false);

  const { isOpen, onOpen, onClose } = useDisclosure();

  const bgColor = useColorModeValue('white', 'gray.700');
  const headingColor = useColorModeValue('teal.500', 'teal.300');

  useEffect(() => {
    // Request asset context and set initial state
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      console.log('response:', response);
      console.log('response:', response.assets.icon);
      setAssetContext(response.assets);
      if (response?.assets.icon) {
        setAvatarUrl(response.assets.icon);
      }
      if (response?.assets.priceUsd) {
        setPriceUsd(response.assets.priceUsd);
      }
    });
  }, []);

  const onStart = async function () {
    let tag = TAG + ' | onStart Transfer | ';
    console.log(tag, 'Starting Transfer process');

    chrome.runtime.sendMessage(
      {
        type: 'GET_MAX_SPENDABLE',
      },
      maxSpendableResponse => {
        console.log('maxSpendableResponse:', maxSpendableResponse);
        if (maxSpendableResponse && maxSpendableResponse.maxSpendable) {
          setMaxSpendable(maxSpendableResponse.maxSpendable);
          setLoadingMaxSpendable(false);
        } else {
          console.error('Error fetching max spendable amount:', maxSpendableResponse?.error || 'Unknown error');
          toast({
            title: 'Error',
            description: 'Failed to fetch max spendable amount.',
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
          setLoadingMaxSpendable(false);
        }
      },
    );
  };

  useEffect(() => {
    onStart();
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (useUsdInput) {
      setInputAmountUsd(event.target.value);
      setInputAmount((parseFloat(event.target.value) / (priceUsd || 1)).toFixed(8));
    } else {
      setInputAmount(event.target.value);
      setInputAmountUsd((parseFloat(event.target.value) * (priceUsd || 1)).toFixed(2));
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
        amount: inputAmount,
        recipient,
        memo,
        isMax: false,
      };

      // Send transfer request to background
      chrome.runtime.sendMessage(
        {
          type: 'TRANSFER',
          payload: sendPayload,
        },
        response => {
          if (response.txHash) {
            confetti(); // Trigger confetti on success
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
      console.error('Error while sending transaction:', error);
      toast({
        title: 'Error',
        description: error.toString(),
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
      onClose(); // Close the confirmation modal after the transaction
    }
  }, [inputAmount, recipient, memo, toast]);

  const setMaxAmount = () => {
    setInputAmount(maxSpendable);
    setInputAmountUsd((parseFloat(maxSpendable) * (priceUsd || 1)).toFixed(2));
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
      <VStack align="start" borderRadius="md" p={6} spacing={5} bg={bgColor} margin="0 auto">
        <Heading as="h1" mb={4} size="lg" color={headingColor}>
          Send Crypto!
        </Heading>

        <Flex align="center" direction={{ base: 'column', md: 'row' }} gap={20}>
          <Avatar size="xl" src={avatarUrl} />
          <Box>
            <Text mb={2}>
              Asset: <Badge colorScheme="green">{assetContext?.name}</Badge>
            </Text>
            <Text mb={2}>
              Chain: <Badge colorScheme="green">{assetContext?.networkId}</Badge>
            </Text>
            <Text mb={4}>
              Symbol: <Badge colorScheme="green">{assetContext?.symbol}</Badge>
            </Text>
            <Text mb={4}>Max Spendable: {maxSpendable} Symbol</Text>
            <Badge colorScheme="teal" fontSize="sm">
              ${(parseFloat(maxSpendable) * (priceUsd || 1)).toFixed(2)} USD
            </Badge>
          </Box>
        </Flex>

        <Grid gap={10} templateColumns={{ base: 'repeat(1, 1fr)', md: 'repeat(2, 1fr)' }} w="full">
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
              <Text ml={2}>{useUsdInput ? 'USD' : 'Symbol'}</Text>
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
            <Text>Amount: {inputAmount} Symbol</Text>
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
