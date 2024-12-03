import { Badge, Box, Divider, Flex, HStack, Switch, Table, Tbody, Td, Text, Textarea, Tr } from '@chakra-ui/react';
import React, { useState } from 'react';

export default function LegacyTx({ transaction }: any) {
  const [isNative, setIsNative] = useState(true);
  const toggleHexNative = () => setIsNative(!isNative);
  const ethValue = transaction?.request?.value;
  const nativeValue = parseFloat(parseInt(ethValue, 16).toString()) / 1e18;

  return (
    <Flex direction="column" mb={4}>
      <Box mb={2}>
        <Table variant="simple" size="sm">
          <Tbody>
            <Tr>
              <Td>
                <Badge>chainid:</Badge>
              </Td>
              <Td>{transaction?.networkId}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>from:</Badge>
              </Td>
              <Td>{transaction?.request?.from}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>recipient:</Badge>
              </Td>
              <Td>{transaction?.request?.to || transaction?.request?.recipient}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>value:</Badge>
              </Td>
              <Td>
                {isNative ? `${nativeValue} ETH` : `${transaction?.request?.value} (Hex)`}

                {/* If you have price data and isNative is true, display equivalent USD */}
                {transaction?.price && isNative && (
                  <Text fontSize="sm" color="gray.500">
                    ≈ ${transaction?.price * nativeValue} USD
                  </Text>
                )}
              </Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>data:</Badge>
              </Td>
              <Td>
                {/* Display a non-editable Textarea for large data payloads */}
                <Textarea
                  value={transaction?.request?.data || 'No data provided'}
                  isReadOnly
                  size="sm"
                  resize="vertical"
                  minHeight="100px"
                  cursor="default"
                  _focus={{ boxShadow: 'none' }}
                />
              </Td>
            </Tr>
          </Tbody>
        </Table>
        <HStack mt={4}>
          <Text>Show as Hex</Text>
          <Switch onChange={toggleHexNative} isChecked={!isNative} />
        </HStack>
      </Box>
      <Divider my={2} />
    </Flex>
  );
}
