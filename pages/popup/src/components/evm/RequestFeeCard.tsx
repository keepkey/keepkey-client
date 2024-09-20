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
} from '@chakra-ui/react';

const RequestFeeCard = ({ data, updateFeeData, chainId }: any) => {
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

  const getFee = async () => {
    try {
      // const network = chainId;
      // const rpcUrl = EIP155_CHAINS[network].rpc;
      // const provider = new JsonRpcProvider(rpcUrl);
      // const feeData = await provider.getFeeData();
      //
      // const networkRecommendedFee = feeData.gasPrice
      //   ? (BigInt(feeData.gasPrice.toString()) / BigInt(1e9)).toString()
      //   : '';
      //
      // setFees((prevFees: any) => ({
      //   ...prevFees,
      //   networkRecommended: networkRecommendedFee,
      // }));

      setFeeWarning(false);
    } catch (e) {
      console.error('Error fetching fee data:', e);
    }
  };

  useEffect(() => {
    // if (!data.maxPriorityFeePerGas && !data.maxFeePerGas && !data.gasPrice) {
    //   getFee();
    //   setDappProvidedFee(false);
    //   setSelectedFee('networkRecommended');
    // } else {
    //   const dappFee = data.gasPrice
    //     ? (BigInt(data.gasPrice.toString()) / BigInt(1e9)).toString()
    //     : '';
    //   const networkFee = fees.networkRecommended;
    //
    //   setDappProvidedFee(true);
    //   setFees((prevFees: any) => ({
    //     ...prevFees,
    //     dappSuggested: dappFee,
    //   }));
    //   if (networkFee && BigInt(dappFee) < BigInt(networkFee)) {
    //     setFeeWarning(true);
    //   }
    //   setSelectedFee('dappSuggested');
    // }
  }, [data, fees.networkRecommended]);

  useEffect(() => {
    if (selectedFee === 'custom') {
      setDisplayFee(customFee + ' Gwei');
    } else {
      setDisplayFee(fees[selectedFee] + ' Gwei');
    }
  }, [selectedFee, customFee, fees]);

  const handleFeeChange = (event: any) => {
    setSelectedFee(event.target.value);
  };

  const handleCustomFeeChange = (event: any) => {
    setCustomFee(event.target.value);
  };

  const handleSubmit = () => {
    let selectedFeeData;
    const feeInGwei = selectedFee === 'custom' ? customFee : fees[selectedFee];

    if (isEIP1559) {
      const baseFeeInWei = BigInt(feeInGwei) * BigInt(1e9);
      const priorityFeeInWei = BigInt(2 * 1e9);
      const maxFeeInWei = baseFeeInWei + priorityFeeInWei;

      selectedFeeData = {
        gasPrice: baseFeeInWei.toString(),
        maxFeePerGas: maxFeeInWei.toString(),
        maxPriorityFeePerGas: priorityFeeInWei.toString(),
      };
    } else {
      const gasPriceInWei = BigInt(feeInGwei) * BigInt(1e9);
      selectedFeeData = {
        gasPrice: gasPriceInWei.toString(),
        maxFeePerGas: gasPriceInWei.toString(),
        maxPriorityFeePerGas: gasPriceInWei.toString(),
      };
    }

    const feeDataHex = {
      gasPrice: `0x${BigInt(selectedFeeData.gasPrice).toString(16)}`,
      maxFeePerGas: `0x${BigInt(selectedFeeData.maxFeePerGas).toString(16)}`,
      maxPriorityFeePerGas: `0x${BigInt(selectedFeeData.maxPriorityFeePerGas).toString(16)}`,
    };

    updateFeeData(feeDataHex);
  };

  return (
    <Fragment>
      {!dappProvidedFee && (
        <Text fontSize="sm" fontStyle="italic" mt={2}>
          Please select a fee option below:
        </Text>
      )}

      {feeWarning && (
        <Alert status="warning" borderRadius="md" mb={2}>
          <AlertTitle>Warning</AlertTitle>
          Dapp suggested fee is lower than the network recommended fee.
        </Alert>
      )}

      <FormControl as="fieldset">
        <RadioGroup name="fee" value={selectedFee} onChange={handleFeeChange}>
          {dappProvidedFee && <Radio value="dappSuggested">DApp Suggested Fee ({fees.dappSuggested} Gwei)</Radio>}
          {fees.networkRecommended && (
            <Radio value="networkRecommended">Network Recommended Fee ({fees.networkRecommended} Gwei)</Radio>
          )}
          <Radio value="custom">Custom Fee</Radio>
        </RadioGroup>
        {selectedFee === 'custom' && (
          <Input
            variant="outline"
            value={customFee}
            onChange={handleCustomFeeChange}
            // fullWidth
            margin="normal"
            type="number"
            bg="white"
            color="black"
            mt={2}
          />
        )}
      </FormControl>
      <Heading as="h6" size="sm" mt={4}>
        Current Fee: {displayFee}
      </Heading>
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
