import React from 'react';
import { Badge, Box, Flex, Stack, Text } from '@chakra-ui/react';

const LEVEL_COLORS: Record<string, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'yellow',
  P3: 'blue',
  P4: 'purple',
  P5: 'green',
};

const severityColor = (severity: string) =>
  severity === 'danger' ? 'red.300' : severity === 'warning' ? 'orange.300' : 'gray.300';

function signedAmount(delta: string, decimals?: number): string {
  if (!/^-?\d+$/.test(delta)) return delta;
  const negative = delta.startsWith('-');
  const digits = negative ? delta.slice(1) : delta;
  if (!decimals) return `${negative ? '-' : '+'}${digits}`;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${negative ? '-' : '+'}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Presentation only: every statement and classification comes from Vault. */
export default function ClearSignReportCard({ report, error }: { report?: any; error?: string }) {
  if (!report && !error) return null;
  if (!report) {
    return (
      <Box borderWidth="1px" borderColor="orange.400" borderRadius="md" p={3}>
        <Text fontWeight="bold" color="orange.300">
          Human-readable review unavailable
        </Text>
        <Text fontSize="xs" mt={1}>
          Vault could not produce its ClearSign report. Review the raw request carefully.
        </Text>
        {error && (
          <Text fontSize="xs" mt={1} color="gray.400" wordBreak="break-word">
            {error}
          </Text>
        )}
      </Box>
    );
  }

  const simulation = report.simulation || {};
  const authenticated = !!report.descriptor?.authenticated;
  const deviceStatus = report.deviceVerification?.status || 'not-attempted';
  const deviceConfirmed = deviceStatus === 'verified';

  return (
    <Box
      borderWidth="1px"
      borderColor={report.protectionLevel === 'P0' ? 'red.500' : 'whiteAlpha.300'}
      borderRadius="md"
      p={3}>
      <Flex justify="space-between" align="start" gap={3}>
        <Box>
          <Text fontWeight="bold">{report.headline}</Text>
          {report.descriptor?.label && (
            <Text fontSize="sm" color="gray.300">
              {report.descriptor.label}
            </Text>
          )}
        </Box>
        <Badge colorScheme={LEVEL_COLORS[report.protectionLevel] || 'gray'}>{report.protectionLevel}</Badge>
      </Flex>

      {(report.protectionLevel === 'P4' || report.protectionLevel === 'P5') && (
        <Text fontSize="xs" color={deviceConfirmed ? 'green.300' : 'orange.300'} mt={2}>
          {deviceConfirmed
            ? 'Description verified by the device.'
            : authenticated
              ? 'Authenticated description found; device verification has not happened yet.'
              : 'Expected ClearSign capability; not yet confirmed by the device.'}
        </Text>
      )}

      {Array.isArray(simulation.assetChanges) && simulation.assetChanges.length > 0 && (
        <Stack spacing={2} mt={3}>
          <Text fontSize="xs" fontWeight="bold" color="gray.400">
            Predicted balance changes
          </Text>
          {simulation.assetChanges.map((change: any, index: number) => (
            <Box key={`${change.account}-${change.asset?.id}-${index}`} fontSize="sm">
              <Text fontWeight="semibold">
                {signedAmount(String(change.delta), change.asset?.decimals)}{' '}
                {change.asset?.symbol || change.asset?.kind || 'asset'}
              </Text>
              <Text fontSize="xs" color="gray.400" wordBreak="break-all">
                {change.asset?.id}
              </Text>
              <Text fontSize="xs" color="gray.400" wordBreak="break-all">
                Account: {change.account}
              </Text>
            </Box>
          ))}
        </Stack>
      )}

      {Array.isArray(simulation.authorityChanges) && simulation.authorityChanges.length > 0 && (
        <Stack spacing={2} mt={3}>
          <Text fontSize="xs" fontWeight="bold" color="gray.400">
            Permissions
          </Text>
          {simulation.authorityChanges.map((change: any, index: number) => (
            <Box key={`${change.authority}-${index}`} fontSize="sm">
              <Text color={change.unlimited ? 'red.300' : undefined}>
                {change.revoked ? 'Revoke' : 'Grant'} {change.kind}
                {change.unlimited ? ' — unlimited' : ''}
              </Text>
              <Text fontSize="xs" color="gray.400" wordBreak="break-all">
                Authority: {change.authority}
              </Text>
              <Text fontSize="xs" color="gray.400" wordBreak="break-all">
                Asset/account: {change.assetOrAccount}
              </Text>
            </Box>
          ))}
        </Stack>
      )}

      {simulation.fee && (
        <Text fontSize="sm" mt={3}>
          Estimated fee: {simulation.fee.amount} {simulation.fee.asset}
        </Text>
      )}

      {[...(report.findings || []), ...(report.limitations || [])].map((finding: any, index: number) => (
        <Box key={`${finding.code}-${index}`} mt={2}>
          <Text fontSize="sm" color={severityColor(finding.severity)}>
            {finding.message}
          </Text>
        </Box>
      ))}

      <Box mt={3} pt={2} borderTopWidth="1px" borderColor="whiteAlpha.200">
        <Text fontSize="xs" color="gray.500">
          {simulation.status === 'success'
            ? 'Effects are predictions from Vault simulation.'
            : `Simulation: ${simulation.status}.`}{' '}
          Device confirmation: {deviceStatus}.
        </Text>
        {(report.claims || []).map((claim: any, index: number) => (
          <Text key={index} fontSize="xs" color="gray.500" mt={1}>
            {claim.statement}
          </Text>
        ))}
        <Text fontSize="xs" color="gray.600" mt={1} wordBreak="break-all">
          Fingerprint: {report.transactionFingerprint}
        </Text>
      </Box>
    </Box>
  );
}
