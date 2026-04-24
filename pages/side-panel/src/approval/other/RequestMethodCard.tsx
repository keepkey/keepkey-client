import { Box, Flex, Text, Heading } from '@chakra-ui/react';
import { WarningIcon, InfoIcon, QuestionIcon } from '@chakra-ui/icons';

/**
 * Method-label resolver. `txType` is the top-level event type (coarse —
 * usually just 'transfer' for the chains that land on this renderer).
 * `kind` is the chain-specific refinement we attach on `unsignedTx.kind`
 * — today only Tron emits it, distinguishing native TRX vs TRC-20 vs a
 * generic smart-contract call. Without the kind-level branch, contract
 * calls (swap / approve / stake) previously rendered as "basic transfer"
 * which is actively misleading for the user approving them on-device.
 */
const getMethodInfo = (txType: string, kind?: string) => {
  if (kind === 'contract-call') {
    return {
      title: 'Smart Contract Call',
      description:
        'This transaction invokes a smart contract. Review the function and contract carefully before approving.',
      icon: <WarningIcon boxSize={8} />,
      color: 'orange.400',
    };
  }
  if (kind === 'trc20-transfer') {
    return {
      title: 'Token Transfer',
      description: 'This transaction transfers a TRC-20 token',
      icon: <InfoIcon boxSize={8} />,
      color: 'yellow.500',
    };
  }
  switch (txType) {
    case 'transfer':
      return {
        title: 'transfer',
        description: 'This transaction is a basic transfer',
        icon: <InfoIcon boxSize={8} />,
        color: 'yellow.500',
      };
    default:
      return {
        title: 'Unknown Method',
        description: 'Verify before proceeding',
        icon: <QuestionIcon boxSize={8} />,
        color: 'yellow.500',
      };
  }
};

/**
 * Component
 */
export default function RequestMethodCard({ transaction }: any) {
  const { title, description, icon, color } = getMethodInfo(transaction.type, transaction?.unsignedTx?.kind);

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
