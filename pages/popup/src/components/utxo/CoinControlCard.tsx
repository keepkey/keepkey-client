import React, { useState, useEffect } from 'react';
import {
  Box,
  Text,
  VStack,
  HStack,
  Button,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Card,
  CardBody,
  CardHeader,
  Badge,
  Flex,
  Input,
} from '@chakra-ui/react';
import { ExternalLinkIcon } from '@chakra-ui/icons';
import { requestStorage } from '@extension/storage';

interface InputType {
  addressNList: number[];
  amount: string;
  hex: string;
  scriptType: string;
  txid: string;
  vout: number;
}

interface OutputType {
  address: string;
  addressType: string;
  amount: number;
}

interface UnsignedTx {
  inputs: InputType[];
  outputs: OutputType[];
  memo?: string;
  fee?: number;
}

interface Transaction {
  id: string; // Include id for updating the event
  unsignedTx: UnsignedTx;
}

interface AssetContext {
  priceUsd: number;
}

interface IProps {
  transaction: Transaction;
}

const requestAssetContext = (): Promise<AssetContext> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_ASSET_CONTEXT' }, response => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(response);
    });
  });
};

const updateEventById = async (id: string, updatedTransaction: Transaction) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'UPDATE_EVENT_BY_ID', payload: { id, updatedEvent: updatedTransaction } },
      response => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      },
    );
  });
};

export default function CoinControl({ transaction }: IProps) {
  const [inputs, setInputs] = useState<InputType[]>([]);
  const [outputs, setOutputs] = useState<OutputType[]>([]);
  const [memo, setMemo] = useState<string | null>(null);
  const [lockedInputs, setLockedInputs] = useState<string[]>([]);
  const [adjustedFee, setAdjustedFee] = useState<number>(0);
  const [assetContext, setAssetContext] = useState<AssetContext | null>(null);
  const [recommendedFeeRate, setRecommendedFeeRate] = useState<number>(10); // Placeholder 10 sat/byte

  useEffect(() => {
    if (transaction && transaction.unsignedTx) {
      setInputs(transaction.unsignedTx.inputs || []);
      setOutputs(transaction.unsignedTx.outputs || []);
      setMemo(transaction.unsignedTx.memo || null);
      setAdjustedFee(transaction.unsignedTx.fee || 0);
    }
  }, [transaction]);

  useEffect(() => {
    // Fetch asset context to get priceUsd
    requestAssetContext()
      .then(context => {
        setAssetContext(context);
      })
      .catch(error => {
        console.error('Error fetching asset context:', error);
      });
  }, []);

  // Calculate total inputs amount once
  const totalInputAmount = inputs.reduce((acc, input) => acc + parseInt(input.amount || '0'), 0);

  // Calculate estimated transaction size
  const txSizeInBytes = inputs.length * 180 + outputs.length * 34 + 10;

  // Initialize fee if not set
  useEffect(() => {
    if (adjustedFee === 0) {
      const initialFee = Math.ceil(txSizeInBytes * recommendedFeeRate);
      setAdjustedFee(initialFee);
    }
  }, [adjustedFee, recommendedFeeRate, txSizeInBytes]);

  const handleFeeChange = (newFee: number) => {
    setAdjustedFee(newFee);

    // Adjust the outputs amounts accordingly
    const newTotalOutputsAmount = totalInputAmount - newFee;

    // Start by adjusting the change output if it exists
    const changeOutputIndex = outputs.findIndex(output => output.addressType === 'change');
    const recipientOutputs = outputs.filter(output => output.addressType !== 'change');

    if (changeOutputIndex !== -1) {
      // There is a change output; adjust its amount
      const recipientAmount = recipientOutputs.reduce((acc, output) => acc + output.amount, 0);
      let newChangeAmount = newTotalOutputsAmount - recipientAmount;

      if (newChangeAmount >= 0) {
        outputs[changeOutputIndex].amount = newChangeAmount;
      } else {
        // Remove the change output if its amount is zero or negative
        outputs.splice(changeOutputIndex, 1);
        // Adjust recipient outputs proportionally
        adjustRecipientOutputs(newTotalOutputsAmount);
      }
    } else {
      // No change output, adjust recipient outputs
      adjustRecipientOutputs(newTotalOutputsAmount);
    }

    // Update the outputs state
    setOutputs([...outputs]);
  };

  const adjustRecipientOutputs = (newTotalOutputsAmount: number) => {
    const recipientOutputs = outputs.filter(output => output.addressType !== 'change');
    const totalRecipientAmount = recipientOutputs.reduce((acc, output) => acc + output.amount, 0);

    // Adjust recipient outputs proportionally
    recipientOutputs.forEach(output => {
      const proportion = output.amount / totalRecipientAmount;
      output.amount = Math.max(Math.floor(newTotalOutputsAmount * proportion), 0);
    });
  };

  const handleUpdateTransaction = async () => {
    // Update the transaction in storage
    const updatedTransaction = { ...transaction };
    updatedTransaction.unsignedTx.outputs = outputs;
    updatedTransaction.unsignedTx.fee = adjustedFee;

    try {
      await updateEventById(transaction.id, updatedTransaction);
      console.log('Transaction updated in storage:', updatedTransaction);
    } catch (error) {
      console.error('Error updating transaction in storage:', error);
    }
  };

  const openBlockExplorer = (txid: string) => {
    const url = `https://live.blockcypher.com/btc/tx/${txid}`;
    window.open(url, '_blank');
  };

  const formatAmount = (amountInSatoshi: number) => {
    const btcAmount = amountInSatoshi / 1e8;
    const usdValue = assetContext && assetContext.priceUsd ? (btcAmount * assetContext.priceUsd).toFixed(2) : 'N/A';
    return `${amountInSatoshi} sats (${btcAmount.toFixed(8)} BTC) ≈ $${usdValue}`;
  };

  const feeRate = adjustedFee / txSizeInBytes; // satoshi per byte

  // Calculate fee in USD
  const feeInBtc = adjustedFee / 1e8;
  const feeInUsd = assetContext && assetContext.priceUsd ? (feeInBtc * assetContext.priceUsd).toFixed(2) : 'N/A';

  // Show fee calculation
  const totalOutputAmount = outputs.reduce((acc, output) => acc + output.amount, 0);
  const feeMath = totalInputAmount - totalOutputAmount;

  return (
    <Box p={4}>
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Coin Control
      </Text>
      <VStack align="stretch" spacing={4}>
        <Text fontSize="lg" fontWeight="bold">
          Inputs
        </Text>
        {inputs.map(input => (
          <Card key={input.txid} w="100%">
            <CardHeader>
              <Flex justify="space-between" align="center">
                <Text fontSize="sm" fontWeight="bold">
                  TXID: {input.txid}
                </Text>
                <HStack spacing={2}>
                  {lockedInputs.includes(input.txid) && <Badge colorScheme="red">Locked</Badge>}
                  <Button size="xs" variant="ghost" onClick={() => openBlockExplorer(input.txid)}>
                    <ExternalLinkIcon />
                  </Button>
                </HStack>
              </Flex>
            </CardHeader>
            <CardBody>
              <Flex justify="space-between">
                <Text>Amount: {formatAmount(parseInt(input.amount))}</Text>
                <Text>Script Type: {input.scriptType}</Text>
              </Flex>
            </CardBody>
          </Card>
        ))}

        <Text fontSize="lg" fontWeight="bold" mt={4}>
          Outputs
        </Text>
        {outputs.map((output, index) => (
          <Card key={index} w="100%">
            <CardBody>
              <Flex justify="space-between" align="center">
                <Box>
                  <Text>Address: {output.address}</Text>
                  <Text>Amount: {formatAmount(output.amount)}</Text>
                </Box>
                <Badge colorScheme={output.addressType === 'change' ? 'green' : 'blue'}>{output.addressType}</Badge>
              </Flex>
            </CardBody>
          </Card>
        ))}

        {memo && (
          <Card w="100%" mt={4}>
            <CardBody>
              <Text fontSize="lg" fontWeight="bold">
                Memo
              </Text>
              <Text>{memo}</Text>
            </CardBody>
          </Card>
        )}

        <Card w="100%" mt={4}>
          <CardBody>
            <Flex justify="space-between" align="center">
              <Text fontSize="lg" fontWeight="bold" mb={2}>
                Adjust Fee
              </Text>
              <HStack>
                <Text>Recommended Fee:</Text>
                <Input
                  width="80px"
                  value={recommendedFeeRate}
                  onChange={e => setRecommendedFeeRate(parseInt(e.target.value) || 10)}
                  size="sm"
                  type="number"
                />
                <Text>sat/byte</Text>
              </HStack>
            </Flex>
            <Slider
              min={1} // Minimum fee
              max={totalInputAmount}
              step={1}
              value={adjustedFee}
              onChange={handleFeeChange}>
              <SliderTrack bg="red.100">
                <SliderFilledTrack bg="tomato" />
              </SliderTrack>
              <SliderThumb boxSize={6}>
                <Box color="tomato" />
              </SliderThumb>
            </Slider>
            <HStack justify="space-between" mt={2}>
              <Text>
                Adjusted Fee: {adjustedFee} sats ({feeRate.toFixed(2)} sat/byte) ≈ ${feeInUsd}
              </Text>
              <Text>Original Fee: {transaction.unsignedTx.fee || 'N/A'} sats</Text>
            </HStack>
            <Text mt={2}>Estimated Transaction Size: {txSizeInBytes} bytes</Text>
            <Text mt={2}>
              Fee Calculation: {totalInputAmount} sats (inputs) - {totalOutputAmount} sats (outputs) = {feeMath} sats
              (fee)
            </Text>
          </CardBody>
        </Card>

        <Button colorScheme="blue" onClick={handleUpdateTransaction}>
          Update Transaction
        </Button>
      </VStack>
    </Box>
  );
}
