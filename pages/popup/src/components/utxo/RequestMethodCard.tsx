import { Box, Flex, Text, Heading, Icon } from '@chakra-ui/react';
import { CheckCircleIcon, WarningIcon, InfoIcon, QuestionIcon } from '@chakra-ui/icons';

const getMethodInfo = (txType: string, hasSmartContractExecution: boolean) => {
  switch (txType) {
    case 'transfer':
      return {
        title: 'transfer',
        description: 'This transaction is a basic transfer',
        icon: <InfoIcon boxSize={8} />,
        color: 'gray.500',
      };
    default:
      return {
        title: 'Unknown Method',
        description: 'Verify before proceeding',
        icon: <QuestionIcon boxSize={8} />,
        color: 'gray.500',
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
