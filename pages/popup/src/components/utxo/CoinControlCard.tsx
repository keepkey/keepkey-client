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
  CardFooter,
  Badge,
  Flex,
} from '@chakra-ui/react';
import { ExternalLinkIcon, LockIcon, UnlockIcon, DeleteIcon } from '@chakra-ui/icons';

interface Input {
  addressNList: number[];
  amount: string;
  hex: string;
  scriptType: string;
  txid: string;
  vout: number;
}

interface Output {
  address: string;
  addressType: string;
  amount: number;
}

interface Transaction {
  requestInfo: {
    inputs: Input[];
    outputs: Output[];
    memo: string;
  };
}

interface IProps {
  transaction: Transaction;
}

export default function CoinControl({ transaction }: IProps) {
  const [inputs, setInputs] = useState<Input[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [lockedInputs, setLockedInputs] = useState<string[]>([]);
  const [selectedInputs, setSelectedInputs] = useState<string[]>([]);
  const [fee, setFee] = useState<number>(0);
  const [adjustedFee, setAdjustedFee] = useState<number>(0);

  useEffect(() => {
    if (transaction) {
      setInputs(transaction.requestInfo.inputs || []);
      setOutputs(transaction.requestInfo.outputs || []);
    }
  }, [transaction]);

  useEffect(() => {
    // Calculate total inputs and outputs amount
    const totalInputAmount = inputs.reduce((acc, input) => acc + parseInt(input.amount || '0'), 0);
    const totalOutputAmount = outputs.reduce((acc, output) => acc + parseInt(output.amount.toString() || '0'), 0);
    setFee(totalInputAmount - totalOutputAmount);
    setAdjustedFee(totalInputAmount - totalOutputAmount);
  }, [inputs, outputs]);

  const handleLockInput = (input: Input) => {
    // Toggle lock
    if (lockedInputs.includes(input.txid)) {
      setLockedInputs(lockedInputs.filter(txid => txid !== input.txid));
    } else {
      setLockedInputs([...lockedInputs, input.txid]);
    }
    // Mock saving to storage
    // exampleSidebarStorage.set('lockedInputs', lockedInputs);
  };

  const handleRemoveInput = (input: Input) => {
    setInputs(inputs.filter(i => i.txid !== input.txid));
  };

  const handleSelectInput = (input: Input) => {
    if (selectedInputs.includes(input.txid)) {
      setSelectedInputs(selectedInputs.filter(txid => txid !== input.txid));
    } else {
      setSelectedInputs([...selectedInputs, input.txid]);
    }
  };

  const openBlockExplorer = (txid: string) => {
    const url = `https://live.blockcypher.com/btc/tx/${txid}`;
    window.open(url, '_blank');
  };

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
                <Text>Amount: {input.amount}</Text>
                <Text>Script Type: {input.scriptType}</Text>
              </Flex>
            </CardBody>
            <CardFooter>
              <HStack spacing={2}>
                <Button
                  size="sm"
                  variant={selectedInputs.includes(input.txid) ? 'solid' : 'outline'}
                  onClick={() => handleSelectInput(input)}>
                  {selectedInputs.includes(input.txid) ? 'Deselect' : 'Select'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleRemoveInput(input)}>
                  <DeleteIcon mr={1} />
                  Remove
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleLockInput(input)}>
                  {lockedInputs.includes(input.txid) ? (
                    <>
                      <UnlockIcon mr={1} />
                      Unlock
                    </>
                  ) : (
                    <>
                      <LockIcon mr={1} />
                      Lock
                    </>
                  )}
                </Button>
              </HStack>
            </CardFooter>
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
                  <Text>Amount: {output.amount}</Text>
                </Box>
                <Badge colorScheme={output.addressType === 'change' ? 'green' : 'blue'}>{output.addressType}</Badge>
              </Flex>
            </CardBody>
          </Card>
        ))}

        <Card w="100%" mt={4}>
          <CardBody>
            <Text fontSize="lg" fontWeight="bold" mb={2}>
              Adjust Fee
            </Text>
            <Slider defaultValue={fee} min={0} max={fee * 2} step={1} onChange={val => setAdjustedFee(val)}>
              <SliderTrack bg="red.100">
                <SliderFilledTrack bg="tomato" />
              </SliderTrack>
              <SliderThumb boxSize={6}>
                <Box color="tomato" />
              </SliderThumb>
            </Slider>
            <HStack justify="space-between" mt={2}>
              <Text>Adjusted Fee: {adjustedFee}</Text>
              <Text>Total Fee: {fee}</Text>
            </HStack>
          </CardBody>
        </Card>
      </VStack>
    </Box>
  );
}
