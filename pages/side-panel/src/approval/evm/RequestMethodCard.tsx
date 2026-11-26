import { Flex, Box, Text } from '@chakra-ui/react';
import { tokens } from '../../styles/tokens';
import { Surface, ToneDot, type Tone } from '../ui';

const getMethodInfo = (
  txType: string,
  hasSmartContractExecution: boolean,
  typedDataSummary?: any,
): { title: string; description: string; tone: Tone } => {
  switch (txType) {
    case 'eth_sign':
      return {
        title: 'Legacy signature',
        description: 'Signs raw data. Only continue if you trust this site.',
        tone: 'warn',
      };

    case 'personal_sign':
      return { title: 'Message signature', description: 'Does not move funds.', tone: 'good' };

    case 'transfer':
      return { title: 'Simple transfer', description: 'No smart contract interaction.', tone: 'good' };

    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return hasSmartContractExecution
        ? {
            title: 'Contract interaction',
            description: 'Calls a smart contract. Review the details below.',
            tone: 'warn',
          }
        : { title: 'Simple transfer', description: 'No smart contract interaction.', tone: 'good' };

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      // Background-decoded (evmTypedData.ts). A permit the decoder could not
      // read still gets the approval framing — looksLikePermit covers it.
      if (typedDataSummary && (typedDataSummary.kind !== 'generic' || typedDataSummary.looksLikePermit)) {
        return {
          title: 'Token approval signature',
          description: 'Lets the spender move your tokens later. No gas now. Check amount, spender and expiry.',
          tone: 'warn',
        };
      }
      return { title: 'Typed data signature', description: 'Can authorize actions. Review every field.', tone: 'warn' };

    case 'wallet_addEthereumChain':
      return {
        title: 'Add network',
        description: 'Saves an RPC the site chose. No on-device step. Verify the RPC URL.',
        tone: 'warn',
      };

    default:
      return { title: 'Unknown method', description: 'Verify before proceeding.', tone: 'bad' };
  }
};

export default function RequestMethodCard({ transaction }: any) {
  // `transaction.request` is the JSON-RPC params array (`[{ to, data, ... }]`),
  // not an object — so `request.data` is always undefined. The unsignedTx the
  // background builds from `params[0]` is the right source, and matches what
  // the Details tab renders.
  const data = transaction?.unsignedTx?.data ?? transaction?.request?.[0]?.data;
  const hasSmartContractExecution = typeof data === 'string' && data.length > 2 && data !== '0x';

  const { title, description, tone } = getMethodInfo(
    transaction.type,
    hasSmartContractExecution,
    transaction?.typedDataSummary,
  );

  return (
    <Surface edge={tone} padding="12px 14px">
      <Flex alignItems="center" gap="10px">
        <ToneDot tone={tone} size={8} />
        <Box minWidth={0}>
          <Text fontSize="13.5px" fontWeight={600} color={tokens.text}>
            {title}
          </Text>
          <Text fontSize="12.5px" color={tokens.dim} marginTop="1px">
            {description}
          </Text>
        </Box>
      </Flex>
    </Surface>
  );
}
