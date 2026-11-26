import React from 'react';
import { Box, Collapse, Flex, Stack, Text, useDisclosure } from '@chakra-ui/react';
import { decodedRows, isRiskFinding, shortAddresses, tidy } from './clearSignFormat';
import { tokens, fonts } from '../styles/tokens';
import { Chip, KvRow, Muted, SectionLabel, Surface, ToneDot, type Tone } from './ui';

// Protection level → status tone. P0 is a Vault block; P4/P5 are
// authenticated descriptions.
const LEVEL_TONE: Record<string, Tone> = {
  P0: 'bad',
  P1: 'warn',
  P2: 'warn',
  P3: 'neutral',
  P4: 'good',
  P5: 'good',
};

const severityTone = (severity: string): Tone =>
  severity === 'danger' ? 'bad' : severity === 'warning' ? 'warn' : 'neutral';

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
      <Surface edge="warn">
        <Text fontSize="13.5px" fontWeight={600} color={tokens.text}>
          Human-readable review unavailable
        </Text>
        <Muted marginTop="2px">Vault could not produce its ClearSign report. Review the raw request carefully.</Muted>
        {error && (
          <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} marginTop="6px" wordBreak="break-word">
            {error}
          </Text>
        )}
      </Surface>
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
  const level = report.protectionLevel;
  const blocked = level === 'P0';

  const verification =
    level === 'P4' || level === 'P5'
      ? deviceConfirmed
        ? { tone: 'good' as Tone, text: 'Verified on device' }
        : authenticated
          ? { tone: 'neutral' as Tone, text: 'Authenticated description · device check pending' }
          : { tone: 'neutral' as Tone, text: 'ClearSign expected · device check pending' }
      : null;

  return (
    <Surface edge={blocked ? 'bad' : undefined} padding="16px">
      <Flex justifyContent="space-between" alignItems="flex-start" gap="12px">
        <Box minWidth={0}>
          <Text fontSize="15px" fontWeight={600} color={tokens.text} letterSpacing="-0.01em">
            {report.descriptor?.label || report.headline}
          </Text>
          {report.descriptor?.label && <Muted marginTop="2px">{report.headline}</Muted>}
        </Box>
        <Chip tone={LEVEL_TONE[level] || 'neutral'} title={report.headline}>
          {level}
        </Chip>
      </Flex>

      {verification && (
        <Flex alignItems="center" gap="8px" marginTop="10px">
          <ToneDot tone={verification.tone} />
          <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} letterSpacing="0.02em">
            {verification.text}
          </Text>
        </Flex>
      )}

      {action && (
        <Text fontSize="16px" fontWeight={600} color={tokens.text} marginTop="14px" title={action.value}>
          {tidy(action.value)}
        </Text>
      )}

      {rows.length > 0 && (
        <Box marginTop="10px">
          {rows.map((row, i) => (
            <KvRow key={row.key} label={row.key} title={row.value} last={i === rows.length - 1}>
              {tidy(row.value)}
              {row.isSigner && (
                <Text as="span" marginLeft="6px" color={tokens.good}>
                  (you)
                </Text>
              )}
            </KvRow>
          ))}
        </Box>
      )}

      {risks.length > 0 && (
        <Stack spacing="8px" marginTop="14px">
          {risks.map((finding: any, index: number) => {
            const tone = severityTone(finding.severity);
            return (
              <Flex
                key={`${finding.code}-${index}`}
                gap="10px"
                alignItems="flex-start"
                padding="10px 12px"
                borderRadius="8px"
                background={tokens.bg}
                border={`1px solid ${tokens.line}`}>
                <Box paddingTop="6px">
                  <ToneDot tone={tone} />
                </Box>
                <Text fontSize="12.5px" color={tokens.text} lineHeight="1.5" title={finding.message}>
                  {tidy(finding.message)}
                </Text>
              </Flex>
            );
          })}
        </Stack>
      )}

      {Array.isArray(simulation.assetChanges) && simulation.assetChanges.length > 0 && (
        <Box marginTop="16px">
          <SectionLabel>Predicted balance changes</SectionLabel>
          {simulation.assetChanges.map((change: any, index: number) => {
            const amount = signedAmount(String(change.delta), change.asset?.decimals);
            return (
              <KvRow
                key={`${change.account}-${change.asset?.id}-${index}`}
                label={change.asset?.symbol || change.asset?.kind || 'asset'}
                title={`${change.asset?.id ?? ''}\nAccount: ${change.account}`}
                last={index === simulation.assetChanges.length - 1}>
                <Text as="span" color={amount.startsWith('-') ? tokens.bad : tokens.good}>
                  {amount}
                </Text>
              </KvRow>
            );
          })}
        </Box>
      )}

      {Array.isArray(simulation.authorityChanges) && simulation.authorityChanges.length > 0 && (
        <Box marginTop="16px">
          <SectionLabel>Permissions</SectionLabel>
          {simulation.authorityChanges.map((change: any, index: number) => (
            <Box key={`${change.authority}-${index}`} marginTop={index ? '10px' : 0}>
              <Flex alignItems="center" gap="8px">
                {change.unlimited && <ToneDot tone="bad" />}
                <Text fontSize="13.5px" fontWeight={500} color={change.unlimited ? tokens.bad : tokens.text}>
                  {change.revoked ? 'Revoke' : 'Grant'} {change.kind}
                  {change.unlimited ? ' · unlimited' : ''}
                </Text>
              </Flex>
              <KvRow label="Spender" title={change.authority}>
                {shortAddresses(String(change.authority ?? ''))}
              </KvRow>
              <KvRow label="Token" title={change.assetOrAccount} last>
                {shortAddresses(String(change.assetOrAccount ?? ''))}
              </KvRow>
            </Box>
          ))}
        </Box>
      )}

      {simulation.fee && (
        <Box marginTop="12px">
          <KvRow label="Estimated fee" last>
            {simulation.fee.amount} {simulation.fee.asset}
          </KvRow>
        </Box>
      )}

      <Box
        as="button"
        marginTop="12px"
        fontFamily={fonts.mono}
        fontSize="10.5px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color={tokens.faint}
        background="transparent"
        border={0}
        padding={0}
        cursor="pointer"
        _hover={{ color: tokens.text }}
        onClick={details.onToggle}>
        {details.isOpen ? '− Technical details' : '+ Technical details'}
      </Box>
      <Collapse in={details.isOpen} animateOpacity>
        <Stack
          spacing="6px"
          marginTop="10px"
          paddingTop="10px"
          borderTop={`1px solid ${tokens.line}`}
          fontFamily={fonts.mono}
          fontSize="11px"
          color={tokens.faint}
          wordBreak="break-word">
          {[...otherFindings, ...(report.limitations || [])].map((finding: any, index: number) => (
            <Text key={`${finding.code}-${index}`}>{finding.message}</Text>
          ))}
          <Text>
            {simulation.status === 'success'
              ? 'Effects are predictions from Vault simulation.'
              : `Simulation: ${simulation.status}.`}{' '}
            Device confirmation: {deviceStatus}.
          </Text>
          {(report.claims || []).map((claim: any, index: number) => (
            <Text key={index}>{claim.statement}</Text>
          ))}
          <Text wordBreak="break-all">Fingerprint: {report.transactionFingerprint}</Text>
        </Stack>
      </Collapse>
    </Surface>
  );
}
