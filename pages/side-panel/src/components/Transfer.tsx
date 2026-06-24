import {
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
  HStack,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  useDisclosure,
  InputGroup,
  InputRightElement,
  IconButton,
} from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import { AssetIcon } from './AssetIcon';
import React, { useCallback, useEffect, useState } from 'react';
import { NetworkIdToChain, COIN_MAP_LONG } from '@extension/shared';
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

  const onStart = async () => {
    const tag = TAG + ' | onStart | ';
    try {
      // Post-Pioneer the asset context carries a scalar `balance` string,
      // not the `balances[]` array the old SDK packed. Reading the array
      // alone left totalBalance at 0, which made Max / 50% useless. Try
      // scalar first; fall back to summing the legacy array if present.
      let totalBalanceCalc = 0;
      const scalar = parseFloat(assetContext?.balance ?? '');
      if (!Number.isNaN(scalar) && scalar > 0) {
        totalBalanceCalc = scalar;
      } else if (Array.isArray(assetContext?.balances)) {
        for (const b of assetContext.balances) {
          totalBalanceCalc += parseFloat(b?.balance) || 0;
        }
      }
      console.log(tag, 'totalBalance:', totalBalanceCalc, 'ctx:', assetContext);
      setTotalBalance(totalBalanceCalc);
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
      // Mirror onStart: scalar `balance` is the post-Pioneer shape;
      // `balances[]` is the legacy array we still support as a fallback.
      // The previous array-only path left Max as a no-op on every
      // current asset context — user would tap Max and get an empty
      // input.
      let total = 0;
      const scalar = parseFloat(assetContext?.balance ?? '');
      if (!Number.isNaN(scalar) && scalar > 0) {
        total = scalar;
      } else if (Array.isArray(assetContext?.balances)) {
        for (const b of assetContext.balances) {
          total += parseFloat(b?.balance) || 0;
        }
      }

      if (total <= 0) {
        console.log(tag, 'No spendable balance in asset context', assetContext);
        return;
      }

      console.log(tag, 'Total Balance:', total);
      setInputAmount(total.toString());
      setIsMax(true);
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
        // Carry the selected account so the background signs/builds from the
        // chosen account instead of defaulting to account 0: accountIndex
        // scopes the pubkey set for UTXO/Cosmos buildTx and selects the Solana
        // address_n. Without this, receiving on account 2 but spending from
        // account 0 is possible.
        accountIndex: assetContext?.accountIndex,
        note: assetContext?.note,
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
      <VStack align="stretch" spacing={5} p={2}>
        {/* Asset Card - Shows what you're sending */}
        <Box bg="kk.surface" borderRadius="xl" p={4} border="1px solid" borderColor="kk.line">
          <Flex align="center" justify="space-between">
            <Flex align="center" gap={3}>
              <AssetIcon src={avatarUrl} symbol={assetContext?.symbol} size={48} />
              <Box>
                <Text fontWeight="semibold" color="kk.text" fontSize="lg">
                  {assetContext?.name || 'Loading...'}
                </Text>
                <Text fontSize="sm" color="kk.dim">
                  {totalBalance.toFixed(6)} {assetContext?.symbol}
                </Text>
              </Box>
            </Flex>
            {isToken && (
              <Badge bg="kk.surfaceHi" color="kk.dim" fontSize="xs">
                {tokenStandard}
              </Badge>
            )}
          </Flex>
        </Box>

        {/* Recipient Input */}
        <Box>
          <Text fontSize="sm" color="kk.dim" mb={2} fontWeight="medium">
            To
          </Text>
          <InputGroup>
            <Input
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="Address, domain or identity"
              bg="kk.surface"
              border="1px solid"
              borderColor="kk.lineHi"
              borderRadius="xl"
              py={6}
              _placeholder={{ color: 'kk.faint' }}
              _focus={{ borderColor: 'kk.accent', boxShadow: 'none' }}
            />
            {recipient && (
              <InputRightElement h="100%">
                <IconButton
                  aria-label="Clear"
                  icon={<CloseIcon />}
                  size="xs"
                  variant="ghost"
                  onClick={() => setRecipient('')}
                />
              </InputRightElement>
            )}
          </InputGroup>
        </Box>

        {/* Amount Input */}
        <Box>
          <Flex justify="space-between" align="center" mb={2}>
            <Text fontSize="sm" color="kk.dim" fontWeight="medium">
              Amount
            </Text>
            <HStack spacing={2}>
              <Button
                size="xs"
                variant="ghost"
                color="kk.accent"
                onClick={() => {
                  const halfAmount = totalBalance / 2;
                  setInputAmount(halfAmount.toString());
                  setIsMax(false);
                  if (priceUsd) {
                    setInputAmountUsd((halfAmount * priceUsd).toFixed(2));
                  }
                }}>
                50%
              </Button>
              <Button size="xs" variant="ghost" color="kk.accent" onClick={setMaxAmount}>
                Max
              </Button>
            </HStack>
          </Flex>

          <Box bg="kk.surface" border="1px solid" borderColor="kk.lineHi" borderRadius="xl" p={4}>
            <Flex align="center" justify="space-between">
              <Input
                value={useUsdInput ? inputAmountUsd : inputAmount}
                onChange={handleInputChange}
                placeholder="0"
                variant="unstyled"
                fontSize="2xl"
                fontWeight="semibold"
                color="kk.text"
                _placeholder={{ color: 'kk.faint' }}
                flex={1}
              />
              <HStack spacing={2}>
                <Text color="kk.dim" fontWeight="medium">
                  {useUsdInput ? 'USD' : assetContext?.symbol || '---'}
                </Text>
              </HStack>
            </Flex>

            {/* Secondary amount display */}
            <Flex justify="space-between" align="center" mt={2}>
              <Text fontSize="sm" color="kk.dim">
                {useUsdInput ? `${inputAmount || '0'} ${assetContext?.symbol || ''}` : `$${inputAmountUsd || '0.00'}`}
              </Text>
              <Button size="xs" variant="ghost" color="kk.dim" onClick={() => setUseUsdInput(!useUsdInput)}>
                ↕ Switch to {useUsdInput ? assetContext?.symbol : 'USD'}
              </Button>
            </Flex>
          </Box>
        </Box>

        {/* Send Button */}
        <Button
          size="lg"
          w="full"
          borderRadius="xl"
          py={6}
          isDisabled={isSubmitting || !inputAmount || !recipient}
          onClick={onOpen}
          _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}>
          {!recipient ? 'Enter recipient' : !inputAmount ? 'Enter amount' : isSubmitting ? 'Sending...' : 'Continue'}
        </Button>
      </VStack>

      {/* Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay bg="blackAlpha.700" />
        <ModalContent bg="kk.bg2" borderRadius="xl">
          <ModalHeader color="kk.text">Confirm Transaction</ModalHeader>
          <ModalCloseButton color="kk.text" />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <Box bg="kk.surfaceHi" p={4} borderRadius="lg">
                <Text fontSize="sm" color="kk.dim">
                  Sending
                </Text>
                <Text fontSize="xl" fontWeight="bold" color="kk.text">
                  {inputAmount} {assetContext?.symbol}
                </Text>
                <Text fontSize="sm" color="kk.dim">
                  ${inputAmountUsd || '0.00'}
                </Text>
              </Box>

              <Box bg="kk.surfaceHi" p={4} borderRadius="lg">
                <Text fontSize="sm" color="kk.dim">
                  To
                </Text>
                <Text fontSize="sm" color="kk.text" wordBreak="break-all">
                  {recipient}
                </Text>
              </Box>
            </VStack>
          </ModalBody>
          <ModalFooter gap={3}>
            <Button variant="ghost" onClick={onClose} color="kk.text">
              Cancel
            </Button>
            <Button onClick={handleSend} isLoading={isSubmitting}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default Transfer;
