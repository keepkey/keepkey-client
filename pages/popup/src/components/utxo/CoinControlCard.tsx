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
  Badge,
  Flex,
  Divider,
} from '@chakra-ui/react';
import { ExternalLinkIcon } from '@chakra-ui/icons';

export default function CoinControl({ transaction }) {
  const [inputs, setInputs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [adjustedFee, setAdjustedFee] = useState<number>(0);
  const [assetContext, setAssetContext] = useState({ priceUsd: 30000 }); // Placeholder for asset price
  const [feeOption, setFeeOption] = useState<string>('medium');
  const [customFeeRate, setCustomFeeRate] = useState<number>(10);

  const recommendedFees = { high: 20, medium: 10, low: 5 };

  useEffect(() => {
    if (transaction && transaction.unsignedTx) {
      setInputs(transaction.unsignedTx.inputs || []);
      setOutputs(transaction.unsignedTx.outputs || []);
      setAdjustedFee(transaction.unsignedTx.fee || 0);
    }
  }, [transaction]);

  // Update fee based on selected option
  useEffect(() => {
    let feeRate = recommendedFees.medium;

    if (feeOption === 'high') feeRate = recommendedFees.high;
    else if (feeOption === 'low') feeRate = recommendedFees.low;
    else if (feeOption === 'custom') feeRate = customFeeRate;

    const txSizeInBytes = 190; // Example tx size
    const newFee = Math.ceil(txSizeInBytes * feeRate);
    setAdjustedFee(newFee);
  }, [feeOption, customFeeRate]);

  const feeInUsd = (adjustedFee / 1e8 * assetContext.priceUsd).toFixed(2); // Fee in USD

  // Simple Transaction Diagram
  const renderTransactionDiagram = () => {
    return (
        <Box mt={4} textAlign="center">
          <Text fontSize="sm" fontWeight="bold" mb={2}>Transaction Diagram</Text>
          <Box display="inline-block">
            {/* Inputs */}
            <Flex justify="center">
              {inputs.map((input, index) => (
                  <Box key={index} textAlign="center">
                    <Text fontSize="xs">Input {index + 1}</Text>
                    <Box
                        h="10px"
                        w="2px"
                        bg="black"
                        my={1}
                        mx="auto"
                    />
                  </Box>
              ))}
            </Flex>

            {/* Transaction Node */}
            <Box
                border="2px solid black"
                display="inline-block"
                borderRadius="50%"
                p={2}
                fontSize="xs"
                fontWeight="bold"
                width="60px"
                height="60px"
                mb={2}
            >
              Transaction
            </Box>

            {/* Outputs & Fees */}
            <Flex justify="center" mt={2}>
              {outputs.map((output, index) => (
                  <Box key={index} textAlign="center">
                    <Box
                        h="10px"
                        w="2px"
                        bg="black"
                        my={1}
                        mx="auto"
                    />
                    <Text fontSize="xs">{output.addressType === 'change' ? 'Change' : 'Recipient'}</Text>
                  </Box>
              ))}

              {/* Fee Line */}
              <Box textAlign="center">
                <Box
                    h="10px"
                    w="2px"
                    bg="red"
                    my={1}
                    mx="auto"
                />
                <Text fontSize="xs">Fee</Text>
              </Box>
            </Flex>
          </Box>
        </Box>
    );
  };

  return (
      <Box p={4} maxW="350px" mx="auto">

        {/* Transaction Diagram */}
        {renderTransactionDiagram()}

        {/* Inputs/Outputs Sections */}
        <Text fontSize="lg" fontWeight="bold" mt={4}>
          Inputs
        </Text>
        {inputs.map((input, index) => (
            <Card key={index} w="100%" mb={2}>
              <CardBody>
                <Flex justify="space-between">
                  <Text>Amount: {input.amount} sats</Text>
                  <Text>Script Type: {input.scriptType}</Text>
                </Flex>
              </CardBody>
            </Card>
        ))}

        <Text fontSize="lg" fontWeight="bold" mt={4}>
          Outputs
        </Text>
        {outputs.map((output, index) => (
            <Card key={index} w="100%" mb={2}>
              <CardBody>
                <Flex justify="space-between">
                  <Text>Address: {output.address}</Text>
                  <Badge colorScheme={output.addressType === 'change' ? 'green' : 'blue'}>
                    {output.addressType === 'change' ? 'Change' : 'Recipient'}
                  </Badge>
                </Flex>
              </CardBody>
            </Card>
        ))}

        <Button colorScheme="blue" width="100%" mt={4}>
          Update Transaction
        </Button>
      </Box>
  );
}
