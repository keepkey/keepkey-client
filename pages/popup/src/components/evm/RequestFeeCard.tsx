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
  InputGroup,
  InputLeftAddon,
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

const hexToDecimal = hex => {
  return parseInt(hex, 16);
};

const RequestFeeCard = ({ transaction }: any) => {
  const [selectedFee, setSelectedFee] = useState('');
  const [customFee, setCustomFee] = useState('');
  const [dappProvidedFee, setDappProvidedFee] = useState(false);
  const [displayFee, setDisplayFee] = useState('');
  const [feeWarning, setFeeWarning] = useState(false);
  const [isEIP1559, setIsEIP1559] = useState(false);
  const [fees, setFees] = useState<any>({
    dappSuggested: '',
    low: '',
    medium: '',
    high: '',
  });
  const [loading, setLoading] = useState(true); // Start with loading true
  const [usdFee, setUsdFee] = useState(''); // USD value of the selected fee
  const [assetContext, setAssetContext] = useState<any>(null);

  // Fetch asset context to get priceUsd
  useEffect(() => {
    const fetchAssetContext = async () => {
      try {
        const context = await requestAssetContext();
        setAssetContext(context);
      } catch (error) {
        console.error('Error fetching asset context:', error);
      }
    };
    fetchAssetContext();
  }, []);

  // Convert Gwei to ETH and then to USD
  const calculateUsdValue = (gweiFee: string) => {
    if (!assetContext || !assetContext.priceUsd) return '0.00';
    const ethFee = parseFloat(gweiFee) / 1e9; // Convert Gwei to ETH
    return (ethFee * parseFloat(assetContext.priceUsd)).toFixed(2); // Convert ETH to USD and format
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

      const networkGasPrice = BigInt(hexToDecimal(feeData.gasPrice));

      const lowGasPrice = (networkGasPrice * BigInt(80)) / BigInt(100); // 80% of network gas price
      const mediumGasPrice = networkGasPrice; // same as network gas price
      const highGasPrice = (networkGasPrice * BigInt(120)) / BigInt(100); // 120% of network gas price

      setFees({
        ...fees,
        low: (lowGasPrice / BigInt(1e9)).toString(),
        medium: (mediumGasPrice / BigInt(1e9)).toString(),
        high: (highGasPrice / BigInt(1e9)).toString(),
      });

      setFeeWarning(false);
    } catch (e) {
      console.error('Error fetching fee data:', e);
    } finally {
      setLoading(false); // Ensure the spinner stops after fetching
    }
  };

  useEffect(() => {
    // EIP-1559 should be selected if it's Ethereum (chainId 1)
    const isEthereumMainnet = transaction.request.chainId === '0x1';
    setIsEIP1559(isEthereumMainnet);

    if (
      !transaction.request.maxPriorityFeePerGas &&
      !transaction.request.maxFeePerGas &&
      !transaction.request.gasPrice
    ) {
      console.log('DApp did not provide fee data');
      getFee();
      setDappProvidedFee(false);
      setSelectedFee('medium');
    } else {
      console.log('DApp provided fee data');
      const dappGasPrice = BigInt(hexToDecimal(transaction.request.gasPrice));
      const dappGasPriceGwei = (dappGasPrice / BigInt(1e9)).toString();

      setDappProvidedFee(true);
      setFees((prevFees: any) => ({
        ...prevFees,
        dappSuggested: dappGasPriceGwei,
      }));

      if (!fees.medium) {
        // If network fees not yet fetched, fetch them
        getFee();
      }

      setSelectedFee('dappSuggested');
    }
  }, [transaction]);

  useEffect(() => {
    let feeInGwei = '';
    if (selectedFee === 'custom') {
      feeInGwei = customFee;
    } else {
      feeInGwei = fees[selectedFee] || '';
    }

    setDisplayFee(feeInGwei + ' Gwei');

    if (feeInGwei) {
      const feeInUsd = calculateUsdValue(feeInGwei);
      setUsdFee(feeInUsd);
    } else {
      setUsdFee('');
    }
  }, [selectedFee, customFee, fees, assetContext]);

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
      {(loading || !assetContext) && <Spinner size="xl" color="blue.500" />}

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

      {!loading && assetContext && (
        <FormControl as="fieldset" mt={4}>
          <RadioGroup name="fee" value={selectedFee} onChange={handleFeeChange}>
            {dappProvidedFee && fees.dappSuggested && (
              <Radio value="dappSuggested" colorScheme="blue">
                DApp Suggested Fee ({fees.dappSuggested} Gwei){' '}
                <Badge colorScheme="blue">${calculateUsdValue(fees.dappSuggested)} USD</Badge>
              </Radio>
            )}
            <Radio value="low" colorScheme="green" mt={2}>
              Low ({fees.low} Gwei) <Badge colorScheme="green">${calculateUsdValue(fees.low)} USD</Badge>
            </Radio>
            <Radio value="medium" colorScheme="yellow" mt={2}>
              Medium ({fees.medium} Gwei) <Badge colorScheme="yellow">${calculateUsdValue(fees.medium)} USD</Badge>
            </Radio>
            <Radio value="high" colorScheme="red" mt={2}>
              High ({fees.high} Gwei) <Badge colorScheme="red">${calculateUsdValue(fees.high)} USD</Badge>
            </Radio>
            <br />
            <Radio value="custom" mt={2}>
              Custom Fee
            </Radio>
          </RadioGroup>
          {selectedFee === 'custom' && (
            <InputGroup size="md" mt={2}>
              <InputLeftAddon children="Gwei" />
              <Input
                variant="outline"
                value={customFee}
                onChange={handleCustomFeeChange}
                margin="normal"
                type="number"
                bg="white"
                color="black"
              />
            </InputGroup>
          )}
        </FormControl>
      )}

      {!loading && (
        <Heading as="h6" size="sm" mt={4}>
          Current Fee: {displayFee || 'No fee selected'}
        </Heading>
      )}

      {usdFee && (
        <Text fontSize="sm" color="gray.500" mt={2}>
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
            isDisabled={transaction.request.chainId !== '0x1'} // Disable if not Ethereum mainnet
            onChange={() => setIsEIP1559(!isEIP1559)}
            colorScheme={isEIP1559 ? 'blue' : 'gray'}
          />
        </Box>
      </Box>
    </Fragment>
  );
};

export default RequestFeeCard;
