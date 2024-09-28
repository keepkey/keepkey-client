import React, { useState, useEffect, Fragment } from 'react';
import {
  FormControl,
  RadioGroup,
  Radio,
  Text,
  Alert,
  Button,
  AlertTitle,
  Box,
  Switch,
  Heading,
  Input,
  Spinner,
  Badge,
} from '@chakra-ui/react';

const requestFeeData = () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_GAS_ESTIMATE' }, response => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(response);
    });
  });
};

// Sample ETH price in USD for calculation
const ETH_PRICE_IN_USD = 1800;

const RequestFeeCard = ({ transaction }: any) => {
  const [selectedFee, setSelectedFee] = useState('');
  const [customFee, setCustomFee] = useState('');
  const [dappProvidedFee, setDappProvidedFee] = useState(false);
  const [displayFee, setDisplayFee] = useState('');
  const [feeWarning, setFeeWarning] = useState(false);
  const [isEIP1559, setIsEIP1559] = useState(false);
  const [fees, setFees] = useState<any>({
    dappSuggested: '',
    networkRecommended: '',
  });
  const [loading, setLoading] = useState(false); // Track if data is being fetched
  const [usdFee, setUsdFee] = useState(''); // USD value of the selected fee

  const calculateUsdValue = (gweiFee: string) => {
    const ethFee = parseFloat(gweiFee) / 1e9; // Convert Gwei to ETH
    return (ethFee * ETH_PRICE_IN_USD).toFixed(2); // Convert ETH to USD and format
  };

  const updateFeeData = (feeData: any) => {
    console.log('updateFeeData: ', feeData);
    console.log('transaction: ', transaction);

    if (!isEIP1559) {
      transaction.gasPrice = feeData.gasPrice;
      transaction.maxFeePerGas = null;
      transaction.maxPriorityFeePerGas = null;
    } else {
      transaction.gasPrice = null;
      transaction.maxFeePerGas = feeData.maxFeePerGas;
      transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    }
  };

  const getFee = async () => {
    setLoading(true);
    try {
      const feeData = await requestFeeData();
      console.log('feeData fetched: ', feeData);

      const networkRecommendedFee = feeData.gasPrice
        ? (BigInt(feeData.gasPrice.toString()) / BigInt(1e9)).toString()
        : '';
      console.log('networkRecommendedFee calculated: ', networkRecommendedFee);

      setFees((prevFees: any) => ({
        ...prevFees,
        networkRecommended: networkRecommendedFee,
      }));

      setFeeWarning(false);
    } catch (e) {
      console.error('Error fetching fee data:', e);
    } finally {
      setLoading(false); // Ensure the spinner stops after fetching
    }
  };

  useEffect(() => {
    if (
      !transaction.request.maxPriorityFeePerGas &&
      !transaction.request.maxFeePerGas &&
      !transaction.request.gasPrice
    ) {
      console.log('DApp did not provide fee data');
      getFee();
      setDappProvidedFee(false);
      setSelectedFee('networkRecommended');
    } else {
      console.log('DApp provided fee data');
      const dappFee = transaction.request.gasPrice
        ? (BigInt(transaction.request.gasPrice.toString()) / BigInt(1e9)).toString()
        : '';
      const networkFee = fees.networkRecommended;
      console.log('networkFee: ', networkFee);

      setDappProvidedFee(true);
      setFees((prevFees: any) => ({
        ...prevFees,
        dappSuggested: dappFee,
      }));

      if (networkFee && BigInt(dappFee) < BigInt(networkFee)) {
        setFeeWarning(true);
      }
      setSelectedFee('dappSuggested');
    }
  }, [transaction, fees.networkRecommended]);

  useEffect(() => {
    console.log('Selected fee updated: ', selectedFee);
    console.log('Fees object: ', fees);

    if (selectedFee === 'custom') {
      setDisplayFee(customFee + ' Gwei');
    } else {
      setDisplayFee(fees[selectedFee] ? fees[selectedFee] + ' Gwei' : '');
    }

    if (fees[selectedFee]) {
      const feeInUsd = calculateUsdValue(fees[selectedFee]);
      setUsdFee(feeInUsd);
    }

    console.log('Display fee updated: ', displayFee);
    console.log('USD Fee: ', usdFee);
  }, [selectedFee, customFee, fees]);

  const handleFeeChange = (event: any) => {
    setSelectedFee(event.target.value);
  };

  const handleCustomFeeChange = (event: any) => {
    setCustomFee(event.target.value);
  };

  const handleSubmit = () => {
    console.log('handleSubmit called');
    let selectedFeeData;
    const feeInGwei = selectedFee === 'custom' ? customFee : fees[selectedFee];

    if (isEIP1559) {
      const baseFeeInWei = BigInt(feeInGwei) * BigInt(1e9);
      const priorityFeeInWei = BigInt(2 * 1e9);
      const maxFeeInWei = baseFeeInWei + priorityFeeInWei;

      selectedFeeData = {
        gasPrice: null,
        maxFeePerGas: maxFeeInWei.toString(),
        maxPriorityFeePerGas: priorityFeeInWei.toString(),
      };
    } else {
      const gasPriceInWei = BigInt(feeInGwei) * BigInt(1e9);
      selectedFeeData = {
        gasPrice: gasPriceInWei.toString(),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      };
    }

    const feeDataHex = {
      gasPrice: selectedFeeData.gasPrice ? `0x${BigInt(selectedFeeData.gasPrice).toString(16)}` : null,
      maxFeePerGas: selectedFeeData.maxFeePerGas ? `0x${BigInt(selectedFeeData.maxFeePerGas).toString(16)}` : null,
      maxPriorityFeePerGas: selectedFeeData.maxPriorityFeePerGas
        ? `0x${BigInt(selectedFeeData.maxPriorityFeePerGas).toString(16)}`
        : null,
    };

    console.log('feeDataHex after submit: ', feeDataHex);
    updateFeeData(feeDataHex);
  };

  return (
    <Fragment>
      {/* Show spinner while loading fee data */}
      {loading && <Spinner size="xl" color="blue.500" />}

      {!loading && !dappProvidedFee && (
        <Text fontSize="sm" fontStyle="italic" mt={2}>
          Please select a fee option below:
        </Text>
      )}

      {feeWarning && (
        <Alert status="warning" borderRadius="md" mb={2}>
          <AlertTitle>Warning</AlertTitle>
          DApp suggested fee is lower than the network recommended fee.
        </Alert>
      )}

      {!loading && (
        <FormControl as="fieldset">
          <RadioGroup name="fee" value={selectedFee} onChange={handleFeeChange}>
            {dappProvidedFee && fees.dappSuggested && (
              <Radio value="dappSuggested">
                DApp Suggested Fee ({fees.dappSuggested} Gwei){' '}
                <Badge colorScheme="green">${calculateUsdValue(fees.dappSuggested)} USD</Badge>
              </Radio>
            )}
            {/*{fees.networkRecommended && (*/}
            {/*    <Radio value="networkRecommended">*/}
            {/*      Network Recommended Fee ({fees.networkRecommended} Gwei) <Badge colorScheme="green">${calculateUsdValue(fees.networkRecommended)} USD</Badge>*/}
            {/*    </Radio>*/}
            {/*)}*/}

            <Radio value="networkRecommended">
              Network Recommended Fee ({fees.networkRecommended} Gwei){' '}
              <Badge colorScheme="green">${calculateUsdValue(fees.networkRecommended)} USD</Badge>
            </Radio>

            <Radio value="custom">Custom Fee</Radio>
          </RadioGroup>
          {selectedFee === 'custom' && (
            <Input
              variant="outline"
              value={customFee}
              onChange={handleCustomFeeChange}
              margin="normal"
              type="number"
              bg="white"
              color="black"
              mt={2}
            />
          )}
        </FormControl>
      )}

      {!loading && (
        <Heading as="h6" size="sm" mt={4}>
          Current Fee: {displayFee || 'No fee selected'}
        </Heading>
      )}

      {usdFee && (
        <Text fontSize="sm" color="green.500" mt={2}>
          Estimated fee in USD: ${usdFee}
        </Text>
      )}

      <Box display="flex" alignItems="center" mt={4} justifyContent="space-between">
        <Button colorScheme="green" onClick={handleSubmit}>
          Submit Fee
        </Button>
        <Box display="flex" alignItems="center">
          <Text fontSize="sm" fontStyle="italic" mr={2}>
            Use EIP-1559:
          </Text>
          <Switch
            id="isEIP1559"
            isChecked={isEIP1559}
            onChange={() => setIsEIP1559(!isEIP1559)}
            colorScheme={isEIP1559 ? 'blue' : 'gray'}
          />
        </Box>
      </Box>
    </Fragment>
  );
};

export default RequestFeeCard;
