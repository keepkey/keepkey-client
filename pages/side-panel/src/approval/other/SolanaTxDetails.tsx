import { Box, Flex, Text } from '@chakra-ui/react';
import { tokens, fonts } from '../../styles/tokens';

/**
 * What a Solana dApp transaction does, from the background's decode
 * (chrome-extension/src/background/chains/solanaTxSummary.ts). Shown instead of
 * the old "TO: N/A / AMOUNT: N/A" — and it has to be honest: for app programs
 * KeepKey can't read, the device shows only "Sign unverified Solana
 * transaction?", so this card is the user's one chance to see the parts that
 * CAN be decoded and a plain warning about the parts that can't.
 */

/** Mirrors SolanaTxSummary (background). */
interface Summary {
  version: string;
  feePayer: string;
  signers: string[];
  instructions: Array<{
    program: string;
    programName: string | null;
    known: boolean;
    title: string;
    fields: Array<{ label: string; value: string }>;
  }>;
  solOutLamports: string;
  priorityFeeLamports: string | null;
  lookupTables: number;
  warnings: Array<{ severity: 'danger' | 'caution'; code: string; text: string }>;
}

const sol = (lamports: string) => {
  const l = BigInt(lamports);
  const frac = (l % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${l / 1_000_000_000n}${frac ? '.' + frac : ''} SOL`;
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <Flex justify="space-between" gap={3} py="3px">
    <Text fontSize="xs" color={tokens.dim} flexShrink={0}>
      {label}
    </Text>
    <Text fontSize="xs" fontFamily={fonts.mono} color={tokens.text} textAlign="right" wordBreak="break-all">
      {value}
    </Text>
  </Flex>
);

export default function SolanaTxDetails({ summary, error }: { summary?: Summary; error?: string }) {
  if (!summary) {
    return (
      <Box p={3} borderWidth="1px" borderColor={tokens.bad} borderRadius="md" mb={4}>
        <Text fontWeight={600} color={tokens.bad}>
          KeepKey couldn't read this transaction
        </Text>
        <Text fontSize="sm" color={tokens.text}>
          {error || 'No decoded summary is available.'} Only approve if you trust this site.
        </Text>
      </Box>
    );
  }

  return (
    <Flex direction="column" gap={3} mb={4}>
      {summary.warnings.map(w => (
        <Box
          key={w.code + w.text}
          p={3}
          borderWidth="1px"
          borderRadius="md"
          borderColor={w.severity === 'danger' ? tokens.bad : tokens.warn}>
          <Text fontSize="sm" color={w.severity === 'danger' ? tokens.bad : tokens.warn} fontWeight={600}>
            {w.severity === 'danger' ? 'High risk' : 'Check this'}
          </Text>
          <Text fontSize="sm" color={tokens.text}>
            {w.text}
          </Text>
        </Box>
      ))}

      <Box>
        <Row label="SOL you send" value={BigInt(summary.solOutLamports) > 0n ? sol(summary.solOutLamports) : 'none'} />
        {summary.priorityFeeLamports && <Row label="Priority fee (max)" value={sol(summary.priorityFeeLamports)} />}
        <Row label="Fee payer" value={summary.feePayer} />
      </Box>

      {summary.instructions.map((ix, n) => (
        <Box
          key={n}
          p={3}
          borderWidth="1px"
          borderRadius="md"
          borderColor={ix.known ? tokens.lineHi : tokens.bad}
          bg={ix.known ? undefined : 'rgba(229,72,77,0.06)'}>
          <Text fontSize="sm" fontWeight={600} color={ix.known ? tokens.text : tokens.bad}>
            {n + 1}. {ix.title}
          </Text>
          {ix.programName && ix.known && (
            <Text fontSize="xs" color={tokens.faint} mb={1}>
              {ix.programName}
            </Text>
          )}
          {ix.fields.map(f => (
            <Row key={f.label} label={f.label} value={f.value} />
          ))}
        </Box>
      ))}
    </Flex>
  );
}
