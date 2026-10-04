import React from 'react';
import { Badge, Box, Button, Collapse, Flex, Grid, Stack, Text, useDisclosure } from '@chakra-ui/react';
import { decodedRows, isRiskFinding, tidy } from './clearSignFormat';

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

const severityScheme = (severity: string) =>
  severity === 'danger' ? 'red' : severity === 'warning' ? 'orange' : 'blue';

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
  const details = useDisclosure();
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
  const findings: any[] = report.findings || [];
  const allRows = decodedRows(findings);
  const action = allRows.find(r => r.key === 'Action');
  const rows = allRows.filter(r => r !== action);
  const risks = findings.filter(isRiskFinding);
  const otherFindings = findings.filter(f => !isRiskFinding(f) && f.code !== 'DECODED_FIELD');
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
          <Text fontWeight="bold" fontSize="md">
            {report.descriptor?.label || report.headline}
          </Text>
          {report.descriptor?.label && (
            <Text fontSize="xs" color="gray.400">
              {report.headline}
            </Text>
          )}
        </Box>
        <Badge colorScheme={LEVEL_COLORS[report.protectionLevel] || 'gray'} title={report.headline}>
          {report.protectionLevel}
        </Badge>
      </Flex>

      {action && (
        <Text fontSize="lg" fontWeight="semibold" mt={3} title={action.value}>
          {tidy(action.value)}
        </Text>
      )}

      {rows.length > 0 && (
        <Grid templateColumns="auto 1fr" columnGap={3} rowGap={1} mt={3} fontSize="sm">
          {rows.map(row => (
            <React.Fragment key={row.key}>
              <Text color="gray.400">{row.key}</Text>
              <Text title={row.value} wordBreak="break-word">
                {tidy(row.value)}
                {row.isSigner && (
                  <Badge ml={2} colorScheme="green" fontSize="0.65em">
                    you
                  </Badge>
                )}
              </Text>
            </React.Fragment>
          ))}
        </Grid>
      )}

      {risks.map((finding: any, index: number) => (
        <Box
          key={`${finding.code}-${index}`}
          mt={3}
          p={2}
          borderLeftWidth="3px"
          borderColor={`${severityScheme(finding.severity)}.400`}
          bg={`${severityScheme(finding.severity)}.900`}
          borderRadius="sm">
          <Text fontSize="sm" color={severityColor(finding.severity)} title={finding.message}>
            {tidy(finding.message)}
          </Text>
        </Box>
      ))}

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

      <Button size="xs" variant="link" mt={3} color="gray.400" onClick={details.onToggle}>
        {details.isOpen ? 'Hide technical details' : 'Technical details'}
      </Button>
      <Collapse in={details.isOpen} animateOpacity>
        <Box mt={2} pt={2} borderTopWidth="1px" borderColor="whiteAlpha.200">
          {[...otherFindings, ...(report.limitations || [])].map((finding: any, index: number) => (
            <Text key={`${finding.code}-${index}`} fontSize="xs" color="gray.400" mt={1} wordBreak="break-word">
              {finding.message}
            </Text>
          ))}
          <Text fontSize="xs" color="gray.400" mt={2}>
            {simulation.status === 'success'
              ? 'Effects are predictions from Vault simulation.'
              : `Simulation: ${simulation.status}.`}{' '}
            Device confirmation: {deviceStatus}.
          </Text>
          {(report.claims || []).map((claim: any, index: number) => (
            <Text key={index} fontSize="xs" color="gray.400" mt={1}>
              {claim.statement}
            </Text>
          ))}
          <Text fontSize="xs" color="gray.500" mt={1} wordBreak="break-all">
            Fingerprint: {report.transactionFingerprint}
          </Text>
        </Box>
      </Collapse>
    </Box>
  );
}
