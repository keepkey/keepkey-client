import { useState } from 'react';
import { Box, Divider, Flex, Table, Tbody, Tr, Td, Badge, Fragment } from '@chakra-ui/react';

export default function RequestDetailsCard({ transaction }: any) {
  const [isNative, setIsNative] = useState(true); // Toggle for hex/native

  return (
    <div>
      <Flex direction="column" mb={4}>
        <Box mb={2}>
          <Table variant="simple" size="sm">
            <Tbody>
              <Tr>
                <Td>
                  <Badge>To:</Badge>
                </Td>
                <Td>{transaction?.request?.recipient || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>Amount:</Badge>
                </Td>
                {/* Using formatAmount to handle cases where amount is an object */}
                <Td>{transaction?.request?.amount.amount || 'N/A'}</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge>Memo:</Badge>
                </Td>
                <Td>{transaction?.request?.memo || 'N/A'}</Td>
              </Tr>
            </Tbody>
          </Table>
        </Box>
        <Divider my={2} />
      </Flex>
    </div>
  );
}
