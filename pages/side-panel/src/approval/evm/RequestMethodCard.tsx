import { Box, Flex, Text, Heading, Icon } from '@chakra-ui/react';
import { CheckCircleIcon, WarningIcon, InfoIcon, QuestionIcon } from '@chakra-ui/icons';

const getMethodInfo = (txType: string, hasSmartContractExecution: boolean) => {
  switch (txType) {
    case 'eth_sign':
      return {
        title: 'Legacy Method',
        description: 'Sign data',
        icon: <InfoIcon boxSize={8} />,
        color: 'gray.500',
      };

    case 'personal_sign':
      return {
        title: 'Safe Method',
        description: 'Does not move funds',
        icon: <CheckCircleIcon boxSize={5} color="green.400" />,
        color: 'green.400',
      };

    case 'transfer':
      return {
        title: 'Transaction',
        description: 'Simple transfer - no smart contract interaction',
        icon: <CheckCircleIcon boxSize={5} color="green.400" />,
        color: 'green.400',
      };
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return {
        title: hasSmartContractExecution ? 'Smart Contract' : 'Transaction',
        description: hasSmartContractExecution
          ? 'Interacts with smart contract - review carefully'
          : 'Simple transfer - no smart contract interaction',
        icon: hasSmartContractExecution ? (
          <WarningIcon boxSize={5} color="yellow.400" />
        ) : (
          <CheckCircleIcon boxSize={5} color="green.400" />
        ),
        color: hasSmartContractExecution ? 'yellow.400' : 'green.400',
      };

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return {
        title: 'Typed Data Transaction',
        description: 'This transaction has smart contract execution, requires extended validation',
        icon: <InfoIcon boxSize={8} />,
        color: 'yellow.400',
      };

    default:
      return {
        title: 'Unknown Method',
        description: 'Verify before proceeding',
        icon: <QuestionIcon boxSize={8} />,
        color: 'red.500',
      };
  }
};

/**
 * Component
 */
export default function RequestMethodCard({ transaction }: any) {
  const hasSmartContractExecution =
    transaction.request?.data && transaction.request.data.length > 0 && transaction.request.data !== '0x';

  const { title, description, icon, color } = getMethodInfo(transaction.type, hasSmartContractExecution);

  return (
    <Flex direction="column" p={4} borderWidth={1} borderRadius="md" borderColor={color}>
      <Flex align="center" mb={4}>
        {icon && (
          <Box as="span" mr={3}>
            {icon}
          </Box>
        )}
        <Heading as="h6" size="sm" color={color}>
          {title}
        </Heading>
      </Flex>
      <Box>
        <Text fontSize="md" fontStyle="italic">
          {description}
        </Text>
      </Box>
    </Flex>
  );
}
