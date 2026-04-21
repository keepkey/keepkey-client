import { Badge, Box, Divider, Flex, HStack, Switch, Table, Tbody, Td, Text, Textarea, Tr } from '@chakra-ui/react';
import React, { useState } from 'react';

export default function Eip712Tx({ transaction }: any) {
  const [isNative, setIsNative] = useState(true);
  const toggleHexNative = () => setIsNative(!isNative);

  // Assuming the EIP-712 typed data is in transaction.requestInfo.params[1]
  const typedData = JSON.parse(transaction?.requestInfo?.params[1]);

  // Example logic for handling the contract address and signer in EIP-712
  const contractAddress = typedData?.domain?.verifyingContract;
  const signer = transaction?.requestInfo?.params[0]; // Typically the signer is in the first param of `eth_signTypedData_v4`
  const spender = typedData?.message?.spender || 'Unknown';

  // Handle the native value from the typed data (if applicable)
  const ethValue = typedData?.message?.details?.amount;
  const nativeValue = parseFloat(parseInt(ethValue || '0', 10).toString()) / 1e18;

  return (
    <Flex direction="column" mb={4}>
      <Box mb={2}>
        <Table variant="simple" size="sm">
          <Tbody>
            <Tr>
              <Td>
                <Badge>Signer:</Badge>
              </Td>
              <Td>{signer || 'Unknown'}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>Contract:</Badge>
              </Td>
              <Td>{contractAddress || 'Unknown'}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>Spender:</Badge>
              </Td>
              <Td>{spender}</Td>
            </Tr>
            <Tr>
              <Td>
                <Badge>Data:</Badge>
              </Td>
              <Td>
                {/* Display a non-editable Textarea for large data payloads */}
                <Textarea
                  value={JSON.stringify(typedData, null, 2)}
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
