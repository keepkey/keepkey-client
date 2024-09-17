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
import { AssetValue } from '@pioneer-platform/helpers';
import React, { useCallback, useEffect, useState } from 'react';
import { getWalletBadgeContent } from '../WalletIcon';
//@ts-ignore
import confetti from 'canvas-confetti'; // Make sure to install the confetti package

const TAG = ' | Transfer | ';

export function Transfer({ usePioneer }: any): JSX.Element {
  const toast = useToast();
  const { state, setIntent, connectWallet } = usePioneer();
  const { app, assetContext, context } = state;
  const [isPairing, setIsPairing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMax, setisMax] = useState(false);
  const [inputAmount, setInputAmount] = useState('');
  const [inputAmountUsd, setInputAmountUsd] = useState('');
  const [sendAmount, setSendAmount] = useState<any | undefined>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memo, setMemo] = useState('');
  const [recipient, setRecipient] = useState('');
  const [walletType, setWalletType] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [priceUsd, setPriceUsd] = useState(null);
  const [maxSpendable, setMaxSpendable] = useState('');
  const [loadingMaxSpendable, setLoadingMaxSpendable] = useState(true);
  const [useUsdInput, setUseUsdInput] = useState(false);

  const { isOpen, onOpen, onClose } = useDisclosure();

  const bgColor = useColorModeValue('white', 'gray.700');
  const headingColor = useColorModeValue('teal.500', 'teal.300');

  useEffect(() => {
    if (assetContext && assetContext.icon) setAvatarUrl(assetContext.icon);
  }, [app, app?.swapKit, assetContext]);

  useEffect(() => {
    if (context) {
      setWalletType(context.split(':')[0]);
    }
  }, [context]);

  useEffect(() => {
    setIsPairing(false);
  }, [app]);

  let onStart = async function () {
    let tag = TAG + ' | onStart Transfer | ';
    if (
      app &&
      app.swapKit &&
      assetContext &&
      assetContext.chain &&
      app.swapKit.estimateMaxSendableAmount &&
      assetContext.networkId
    ) {
      console.log('onStart Transfer page');
      console.log(tag, 'assetContext: ', assetContext);

      //get balance from app
      let balance = app.balances.filter((balance: any) => balance.caip === assetContext.caip);
      console.log(tag, 'balance: ', balance);
      if (balance && balance[0] && balance[0].priceUsd) setPriceUsd(balance[0].priceUsd);

      const walletInfo = await app.swapKit.syncWalletByChain(assetContext.chain);
      console.log(tag, 'walletInfo: ', walletInfo);
      if (!walletInfo) {
        console.log(tag, 'connectWallet needed!');
        await connectWallet('KEEPKEY');
        setTimeout(onStart, 200);
      } else {
        let pubkeys = await app.pubkeys;
        pubkeys = pubkeys.filter((pubkey: any) => pubkey.networks.includes(assetContext.networkId));
        console.log('onStart Transfer pubkeys', pubkeys);

        // Check local storage for cached maxSpendable
        const cacheKey = `maxSpendable_${assetContext.caip}`;
        const cachedMaxSpendable = localStorage.getItem(cacheKey);
        if (cachedMaxSpendable) {
          setMaxSpendable(cachedMaxSpendable);
          setLoadingMaxSpendable(false);
        }

        //get assetValue for the asset
        if (!assetContext.caip) throw Error('Invalid asset context. Missing caip.');
        let estimatePayload: any = {
          feeRate: 10,
          caip: assetContext.caip,
          pubkeys,
          memo,
          recipient,
        };
        let maxSpendableAmount = await app.swapKit.estimateMaxSendableAmount({
          chain: assetContext.chain,
          params: estimatePayload,
        });
        console.log('maxSpendableAmount', maxSpendableAmount);
        console.log('maxSpendableAmount', maxSpendableAmount.getValue('string'));
        console.log('onStart Transfer pubkeys', pubkeys);
        const newMaxSpendable = maxSpendableAmount.getValue('string');
        setMaxSpendable(newMaxSpendable);
        setLoadingMaxSpendable(false);
        localStorage.setItem(cacheKey, newMaxSpendable);
      }
    }
  };

  useEffect(() => {
    onStart();
  }, [app, app?.swapKit, assetContext]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setisMax(false);
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
      if (!inputAmount) {
        alert('You MUST input an amount to send!');
        return;
      }
      if (!recipient) {
        alert('You MUST input a recipient to send to!');
        return;
      }
      setIntent('transfer:' + assetContext.chain + ':' + assetContext.symbol + ':' + inputAmount + ':' + recipient);
      const walletInfo = await app.swapKit.syncWalletByChain(assetContext.chain);

      if (!walletInfo) {
        let walletType = app.context.split(':')[0];
        connectWallet(walletType.toUpperCase());
        setTimeout(() => {
          handleSend();
        }, 3000);
      } else {
        setIsSubmitting(true);
        await AssetValue.loadStaticAssets();
        //@ts-ignore
        const assetValue = await AssetValue.fromIdentifier(assetContext.identifier, parseFloat(inputAmount));

        let sendPayload: any = {
          assetValue,
          memo,
          recipient,
        };
        if (isMax) sendPayload.isMax = true;
        const txHash = await app.swapKit.transfer(sendPayload);

        if (typeof window !== 'undefined') {
          setTimeout(() => {
            window.open(`${app.swapKit.getExplorerTxUrl(assetContext.chain, txHash as string)}`, '_blank');
          }, 10000); // 30 seconds delay
        }

        confetti(); // Trigger confetti on successful transaction

        toast({
          title: 'Transaction Successful',
          description: `Transaction ID: ${txHash}`,
          status: 'success',
          duration: 5000,
          isClosable: true,
        });
      }
    } catch (errorSend: any) {
      console.error(errorSend);
      toast({
        title: 'Error',
        description: errorSend.toString(),
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
      onClose(); // Close the confirmation modal after the transaction
    }
  }, [assetContext, inputAmount, app, recipient, sendAmount, toast, memo, isMax, connectWallet, setIntent]);

  const setMaxAmount = () => {
    setisMax(true);
    setInputAmount(maxSpendable);
    setInputAmountUsd((parseFloat(maxSpendable) * (priceUsd || 1)).toFixed(2));
  };

  const formatNumber = (number: any) => {
    return number;
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

  const isOverMax = parseFloat(inputAmount) > parseFloat(maxSpendable);

  return (
    <>
      <VStack align="start" borderRadius="md" p={6} spacing={5} bg={bgColor} margin="0 auto">
        <Heading as="h1" mb={4} size="lg" color={headingColor}>
          Send Crypto!
        </Heading>

        {isPairing ? (
          <Box>
            <Text mb={2}>
              Connecting to {context}...
              <Spinner size="xl" />
              Please check your wallet to approve the connection.
            </Text>
          </Box>
        ) : (
          <div>
            <Flex align="center" direction={{ base: 'column', md: 'row' }} gap={20}>
              <Box>
                <Avatar size="xl" src={avatarUrl}>
                  {/*{getWalletBadgeContent(walletType, '4em')}*/}
                </Avatar>
              </Box>
              <Box>
                <Text mb={2}>
                  Asset: <Badge colorScheme="green">{assetContext?.name || 'N/A'}</Badge>
                </Text>
                <Text mb={2}>
                  Chain: <Badge colorScheme="green">{assetContext?.chain || 'N/A'}</Badge>
                </Text>
                <Text mb={4}>
                  Symbol: <Badge colorScheme="green">{assetContext?.symbol || 'N/A'}</Badge>
                </Text>
                <Text mb={4}>
                  Max Spendable: {formatNumber(maxSpendable)} {assetContext?.symbol}
                </Text>
                <Badge colorScheme="teal" fontSize="sm">
                  ${(parseFloat(maxSpendable) * (priceUsd || 1)).toFixed(2)} USD
                </Badge>
              </Box>
            </Flex>
            <br />
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
                    isInvalid={isOverMax}
                  />
                  <Text ml={2}>{useUsdInput ? 'USD' : assetContext?.symbol}</Text>
                </Flex>
                <Text fontSize="sm" color="blue.500" cursor="pointer" onClick={() => setUseUsdInput(!useUsdInput)}>
                  {useUsdInput
                    ? `Switch to ${assetContext?.symbol} (${inputAmount})`
                    : `Switch to USD ($${inputAmountUsd} USD)`}
                </Text>
              </FormControl>
            </Grid>
            <br />
            <Flex justify="space-between" w="full" mt="4">
              <Button onClick={setMaxAmount} size="sm" colorScheme="teal">
                MAX
              </Button>
              {!assetContext?.networkId.includes('eip155') && (
                <Button
                  variant="ghost"
                  rightIcon={showAdvanced ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  onClick={() => setShowAdvanced(!showAdvanced)}>
                  Advanced
                </Button>
              )}
            </Flex>
            {showAdvanced && (
              <FormControl mt={4}>
                <FormLabel>
                  Memo:
                  <Tooltip
                    label="Optional memo to include with your transaction for reference."
                    aria-label="A tooltip for memo input">
                    <InfoOutlineIcon ml="2" />
                  </Tooltip>
                </FormLabel>
                <Input placeholder="Enter memo (optional)" value={memo} onChange={e => setMemo(e.target.value)} />
              </FormControl>
            )}
            <br />
          </div>
        )}

        <Button colorScheme="green" w="full" mt={4} onClick={onOpen} isDisabled={isOverMax}>
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
              Amount: {inputAmount} {assetContext?.symbol}
            </Text>
            <Text>Amount (USD): ${inputAmountUsd}</Text>
            {memo && <Text>Memo: {memo}</Text>}
            {isSubmitting && <Box mt={4}></Box>}
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
