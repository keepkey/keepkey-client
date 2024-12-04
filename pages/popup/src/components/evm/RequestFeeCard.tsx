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
import { requestStorage } from '@extension/storage';
const TAG = ' | RequestFeeCard | ';

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

// const updateEventById = async (id, updatedTransaction) => {
//   return new Promise((resolve, reject) => {
//     chrome.runtime.sendMessage(
//       { type: 'UPDATE_EVENT_BY_ID', payload: { id, updatedEvent: updatedTransaction } },
//       response => {
//         if (chrome.runtime.lastError) {
//           return reject(chrome.runtime.lastError);
//         }
//         resolve(response);
//       },
//     );
//   });
// };

const hexToDecimal = hex => {
  return parseInt(hex, 16);
};

const decimalToHex = decimal => {
  return '0x' + BigInt(decimal).toString(16);
};

const RequestFeeCard = ({ transaction }) => {
  const [selectedFee, setSelectedFee] = useState('');
  const [customFee, setCustomFee] = useState('');
  const [dappProvidedFee, setDappProvidedFee] = useState(false);
  const [displayFee, setDisplayFee] = useState('');
  const [feeWarning, setFeeWarning] = useState(false);
  const [isEIP1559, setIsEIP1559] = useState(false);
  const [fees, setFees] = useState({
    dappSuggested: '',
    low: '',
    medium: '',
    high: '',
  });
  const [loading, setLoading] = useState(true);
  const [usdFee, setUsdFee] = useState('');
  const [assetContext, setAssetContext] = useState(null);

  const gasLimit = transaction.request.gasLimit ? hexToDecimal(transaction.request.gasLimit) : 21000;

  useEffect(() => {
    const fetchAssetContext = async () => {
      try {
        const context = await requestAssetContext();
        setAssetContext(context.assets);
      } catch (error) {
        console.error('Error fetching asset context:', error);
      }
    };
    fetchAssetContext();
  }, []);

  const calculateUsdValue = gweiFee => {
    if (!assetContext || !assetContext.priceUsd) {
      console.error('assetContext: ', assetContext);
      console.error('Missing Price Data for Native gas asset!');
      return '0.00';
    }

    const feeInETH = parseFloat(gweiFee) * gasLimit * 1e-9;
    const feeInUSD = feeInETH * parseFloat(assetContext.priceUsd);
    return feeInUSD.toFixed(2);
  };

  const getFee = async () => {
    const tag = TAG + ' | getFee | ';
    setLoading(true);
    try {
      const feeData = await requestFeeData();
      console.log(tag, ' feeData: ', feeData);

      // Since feeData.gasPrice is already in decimal format, there's no need for hexToDecimal
      const networkGasPrice = BigInt(feeData.gasPrice);
      console.log(tag, ' feeData: ', feeData);

      // Calculate low, medium, and high gas prices based on the network gas price
      const lowGasPrice = (networkGasPrice * BigInt(80)) / BigInt(100); // 80% of gas price
      const mediumGasPrice = networkGasPrice; // Use the network-provided gas price
      const highGasPrice = (networkGasPrice * BigInt(120)) / BigInt(100); // 120% of gas price
      console.log(tag, ' lowGasPrice: ', lowGasPrice);
      console.log(tag, ' mediumGasPrice: ', mediumGasPrice);
      console.log(tag, ' highGasPrice: ', highGasPrice);

      // Convert from wei to gwei (1e9)
      const feeSettings = {
        dappSuggested: fees.dappSuggested,
        low: Math.floor(Number(lowGasPrice) / 1e6).toString(), // Low gas price in gwei, rounded down
        medium: Math.floor(Number(mediumGasPrice) / 1e6).toString(), // Medium gas price in gwei, rounded down
        high: Math.floor(Number(highGasPrice) / 1e6).toString(), // High gas price in gwei, rounded down
      };
      console.log(tag, ' feeSettings: ', feeSettings);
      setFees(feeSettings);

      setFeeWarning(false);
    } catch (e) {
      console.error('Error fetching fee data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const isEthereumMainnet = transaction.networkId === 'eip155:1';
    setIsEIP1559(isEthereumMainnet);

    if (
      !transaction.request.maxPriorityFeePerGas &&
      !transaction.request.maxFeePerGas &&
      !transaction.request.gasPrice
    ) {
      getFee();
      setDappProvidedFee(false);
      setSelectedFee('medium');
    } else {
      const dappGasPrice = BigInt(hexToDecimal(transaction.request.gasPrice || '0x0'));
      const dappGasPriceGwei = (dappGasPrice / BigInt(1e9)).toString();

      setDappProvidedFee(true);
      setFees(prevFees => ({
        ...prevFees,
        dappSuggested: dappGasPriceGwei,
      }));

      if (!fees.medium) {
        getFee();
      }

      setSelectedFee('dappSuggested');
    }
  }, [transaction, assetContext]);

  useEffect(() => {
    let feeInGwei = '';
    if (selectedFee === 'custom') {
      feeInGwei = customFee;
    } else {
      feeInGwei = fees[selectedFee] || '';
    }

    setDisplayFee(feeInGwei);

    if (feeInGwei) {
      console.log('feeInGwei: ', feeInGwei);
      const feeInUsd = calculateUsdValue(feeInGwei);
      console.log('feeInUsd: ', feeInUsd);

      setUsdFee(feeInUsd);
    } else {
      setUsdFee('');
    }

    if (feeInGwei && selectedFee !== 'custom') {
      handleUpdateTransaction(feeInGwei);
    }
  }, [selectedFee, customFee, fees, assetContext]);

  const handleFeeChange = value => {
    setSelectedFee(value);
  };

  const handleCustomFeeChange = event => {
    setCustomFee(event.target.value);
  };

  const handleSubmit = () => {
    const feeInGwei = selectedFee === 'custom' ? customFee : fees[selectedFee];
    handleUpdateTransaction(feeInGwei);
  };

  const handleUpdateTransaction = async feeInGwei => {
    let selectedFeeData = {};
    if (isEIP1559) {
      const baseFeeInWei = BigInt(feeInGwei) * BigInt(1e9);
      const priorityFeeInWei = BigInt(2 * 1e9);
      const maxFeeInWei = baseFeeInWei + priorityFeeInWei;

      selectedFeeData = {
        maxFeePerGas: decimalToHex(maxFeeInWei),
        maxPriorityFeePerGas: decimalToHex(priorityFeeInWei),
      };

      // Remove gasPrice from request and requestInfo.params[0]
      delete transaction.request.gasPrice;
      delete transaction.requestInfo.params[0].gasPrice;

      // Set maxFeePerGas and maxPriorityFeePerGas in request and requestInfo.params[0]
      transaction.request.maxFeePerGas = selectedFeeData.maxFeePerGas;
      transaction.request.maxPriorityFeePerGas = selectedFeeData.maxPriorityFeePerGas;

      transaction.requestInfo.params[0].maxFeePerGas = selectedFeeData.maxFeePerGas;
      transaction.requestInfo.params[0].maxPriorityFeePerGas = selectedFeeData.maxPriorityFeePerGas;

      // Remove gasPrice from top-level transaction
      delete transaction.gasPrice;
    } else {
      const gasPriceInWei = BigInt(feeInGwei) * BigInt(1e9);

      selectedFeeData = {
        gasPrice: decimalToHex(gasPriceInWei),
      };

      // Set gasPrice in request and requestInfo.params[0]
      transaction.request.gasPrice = selectedFeeData.gasPrice;
      transaction.requestInfo.params[0].gasPrice = selectedFeeData.gasPrice;

      // Remove maxFeePerGas and maxPriorityFeePerGas from request and requestInfo.params[0]
      delete transaction.request.maxFeePerGas;
      delete transaction.request.maxPriorityFeePerGas;

      delete transaction.requestInfo.params[0].maxFeePerGas;
      delete transaction.requestInfo.params[0].maxPriorityFeePerGas;

      // Set gasPrice in top-level transaction
      transaction.request.gasPrice = selectedFeeData.gasPrice;

      // Remove maxFeePerGas and maxPriorityFeePerGas from top-level transaction
      delete transaction.maxFeePerGas;
      delete transaction.maxPriorityFeePerGas;
    }

    //
    requestStorage.updateEventById(transaction.id, transaction);
  };

  return (
    <Fragment>
      {(loading || !assetContext) && <Spinner size="xl" color="blue.500" />}

      {!loading && (
        <Heading as="h6" size="sm" mt={4}>
          <Text>Current Fee: {displayFee ? `${displayFee} Gwei ($${usdFee} USD)` : 'No fee selected'}</Text>
          <Text>Current Limit: {gasLimit}</Text>
        </Heading>
      )}

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

      {selectedFee === 'custom' && (
        <Box display="flex" alignItems="center" mt={4} justifyContent="space-between">
          <Button variant="outline" onClick={handleSubmit}>
            Update Fee
          </Button>
        </Box>
      )}

      {/*<Box display="flex" alignItems="center" mt={4} justifyContent="space-between">*/}
      {/*  <Box display="flex" alignItems="center">*/}
      {/*    <Text fontSize="sm" fontStyle="italic" mr={2}>*/}
      {/*      Use EIP-1559:*/}
      {/*    </Text>*/}
      {/*    <Switch*/}
      {/*        id="isEIP1559"*/}
      {/*        isChecked={isEIP1559}*/}
      {/*        isDisabled={transaction.networkId !== 'eip155:1'}*/}
      {/*        onChange={() => setIsEIP1559(!isEIP1559)}*/}
      {/*        colorScheme={isEIP1559 ? 'blue' : 'gray'}*/}
      {/*    />*/}
      {/*  </Box>*/}
      {/*</Box>*/}
    </Fragment>
  );
};

export default RequestFeeCard;
