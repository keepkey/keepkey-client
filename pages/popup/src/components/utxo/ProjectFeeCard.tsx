import React, { useState, useEffect } from 'react';
import {
  Box,
  Text,
  VStack,
  RadioGroup,
  Radio,
  Button,
  Input,
  Card,
  CardBody,
  Divider,
  Table,
  Tbody,
  Tr,
  Td,
  TableContainer,
  useToast,
} from '@chakra-ui/react';

// Placeholder function to get recommended fees
const getRecommendedFees = () => ({
  high: 20, // sat/byte
  medium: 10,
  low: 5,
});

// Placeholder function to request asset context (returns BTC price in USD)
const requestAssetContext = () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(response);
    });
  });
};

// Function to estimate transaction size
const estimateTxSize = (inputs, outputs) => {
  const baseTransactionWeight = 10 * 4; // 10 bytes * 4 weight units

  let totalWeight = 0;

  // Inputs
  inputs.forEach(input => {
    let weight = 0;
    if (input.scriptType === 'p2wpkh') {
      weight = 41 * 4; // P2WPKH input: 41 bytes * 4 weight units
    } else if (input.scriptType === 'p2pkh') {
      weight = 148 * 4; // P2PKH input: 148 bytes * 4 weight units
    } else if (input.scriptType === 'p2sh-p2wpkh') {
      weight = 91 * 4; // P2SH-P2WPKH input: 91 bytes * 4 weight units
    } else {
      weight = 148 * 4; // Default to P2PKH
    }
    totalWeight += weight;
  });

  // Outputs
  outputs.forEach(output => {
    let weight = 0;
    if (output.address && output.address.startsWith('bc1')) {
      weight = 31 * 4; // P2WPKH output: 31 bytes * 4 weight units
    } else if (output.address && output.address.startsWith('3')) {
      weight = 32 * 4; // P2SH output: 32 bytes * 4 weight units
    } else {
      weight = 34 * 4; // P2PKH output: 34 bytes * 4 weight units
    }
    totalWeight += weight;
  });

  const totalTxWeight = baseTransactionWeight + totalWeight;
  return Math.ceil((totalTxWeight + 3) / 4); // Virtual Size (vsize)
};

// Main component
const ProjectFeeCard = ({ transaction }) => {
  const [feeOption, setFeeOption] = useState<string>('medium');
  const [customFeeRate, setCustomFeeRate] = useState<string>('');
  const [adjustedFee, setAdjustedFee] = useState<number>(0);
  const [usdFee, setUsdFee] = useState<string>('0.00');
  const [btcPrice, setBtcPrice] = useState<number>(30000); // Default BTC price
  const [txSizeInBytes, setTxSizeInBytes] = useState<number>(0);
  const [isFeeRateInvalid, setIsFeeRateInvalid] = useState<boolean>(false);

  const toast = useToast();
  const recommendedFees = getRecommendedFees();
  const inputs = transaction?.unsignedTx?.inputs || [];
  const outputs = transaction?.unsignedTx?.outputs || [];

  // Calculate estimated transaction size
  useEffect(() => {
    const estimatedSize = estimateTxSize(inputs, outputs);
    setTxSizeInBytes(estimatedSize);
  }, [inputs, outputs]);

  // Fetch BTC/USD price
  useEffect(() => {
    const fetchAssetContext = async () => {
      try {
        const assetContext: any = await requestAssetContext();
        const priceUsd = parseFloat(assetContext.assets.priceUsd);
        if (!isNaN(priceUsd)) {
          setBtcPrice(priceUsd);
        }
      } catch (error) {
        console.error('Error fetching asset context:', error);
      }
    };
    fetchAssetContext();
  }, []);

  // Calculate fee in sats and USD
  useEffect(() => {
    let feeRate = recommendedFees[feeOption as keyof typeof recommendedFees];

    if (feeOption === 'custom') {
      const parsedFeeRate = parseFloat(customFeeRate);
      if (!isNaN(parsedFeeRate) && parsedFeeRate > 0) {
        feeRate = parsedFeeRate;
      } else {
        feeRate = 0;
      }
    }

    if (!isNaN(txSizeInBytes) && txSizeInBytes > 0 && feeRate > 0) {
      let newFee = Math.ceil(txSizeInBytes * feeRate); // Fee in sats
      const totalInputs = inputs.reduce((sum, input) => sum + Number(input.amount), 0);
      const amountToSend = Number(transaction.request.amount.amount) * 1e8;
      const maxAvailableFee = totalInputs - amountToSend;

      if (newFee > maxAvailableFee) {
        feeRate = Math.floor(maxAvailableFee / txSizeInBytes);
        newFee = Math.ceil(txSizeInBytes * feeRate);
        setCustomFeeRate(feeRate.toString());
        setIsFeeRateInvalid(true);
        toast({
          id: 'fee-adjusted-warning',
          title: 'Fee adjusted',
          description: 'The fee rate has been adjusted.',
          status: 'warning',
          duration: 5000,
          isClosable: true,
        });
      } else {
        setIsFeeRateInvalid(false);
      }

      setAdjustedFee(newFee);
      setUsdFee(((newFee / 1e8) * btcPrice).toFixed(2));
    } else {
      setAdjustedFee(0);
      setUsdFee('0.00');
    }
  }, [feeOption, customFeeRate, txSizeInBytes, btcPrice, inputs, transaction.request.amount.amount, toast]);

  const handleCustomFeeRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newCustomFeeRate = e.target.value;
    setCustomFeeRate(newCustomFeeRate);
    setIsFeeRateInvalid(false);
  };

  const handleUpdateFee = async () => {
    try {
      // Update transaction with new fee here (same as your logic)
      console.log('Update transaction with fee:', adjustedFee);
    } catch (error) {
      console.error('Error updating fee:', error.message);
      toast({
        title: 'Error updating fee',
        description: error.message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  return (
    <Card mx="auto">
      <CardBody>
        <VStack align="stretch" mb={4}>
          <Text fontSize="lg" fontWeight="bold" mb={2}>
            Select Fee Option
          </Text>

          <RadioGroup onChange={setFeeOption} value={feeOption}>
            <VStack align="flex-start" spacing={1}>
              <Radio value="high">High ({recommendedFees.high} sat/byte)</Radio>
              <Radio value="medium">Medium ({recommendedFees.medium} sat/byte)</Radio>
              <Radio value="low">Low ({recommendedFees.low} sat/byte)</Radio>
              <Radio value="custom">Custom</Radio>
            </VStack>
          </RadioGroup>

          {feeOption === 'custom' && (
            <Box mt={2}>
              <Text mb={1} fontSize="sm">
                Enter Custom Fee Rate (sat/byte):
              </Text>
              <Input
                placeholder="Enter fee rate"
                value={customFeeRate}
                onChange={handleCustomFeeRateChange}
                type="number"
                size="sm"
                isInvalid={isFeeRateInvalid}
                errorBorderColor="red.300"
              />
              {isFeeRateInvalid && (
                <Text color="red.500" fontSize="sm">
                  Fee rate adjusted to maximum possible.
                </Text>
              )}
            </Box>
          )}
        </VStack>

        <Divider />

        <TableContainer>
          <Table variant="simple" size="xs">
            <Tbody>
              <Tr>
                <Td>Asset Price</Td>
                <Td isNumeric>${btcPrice.toLocaleString()} USD</Td>
              </Tr>
              <Tr>
                <Td>Transaction Size</Td>
                <Td isNumeric>{txSizeInBytes} bytes</Td>
              </Tr>
              <Tr>
                <Td>Total Fee</Td>
                <Td isNumeric>
                  ${usdFee} ({adjustedFee.toLocaleString()} sats)
                </Td>
              </Tr>
            </Tbody>
          </Table>
        </TableContainer>

        <Divider />

        <Button colorScheme="blue" width="100%" mt={3} size="sm" onClick={handleUpdateFee}>
          Confirm Fee
        </Button>
      </CardBody>
    </Card>
  );
};

export default ProjectFeeCard;
