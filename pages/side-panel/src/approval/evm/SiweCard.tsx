import React from 'react';
import { Box, Checkbox, Flex, Text } from '@chakra-ui/react';
import { MicroLabel } from '../../components/v2/primitives';
import { tokens, fonts } from '../../styles/tokens';

/** Mirrors SiweCheck from chrome-extension/src/background/chains/siwe.ts */
type SiweCheck = {
  message: { scheme: string | null; domain: string; uri: string } | null;
  origin: string | null;
  host: string | null;
  warnings: { level: 'danger' | 'warning'; code: string; text: string }[];
};

interface Props {
  siwe: SiweCheck;
  /** Danger only — parent EvmTransaction reads this to decide whether to enable Approve. */
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Flex justify="space-between" align="baseline" gap={3} py="6px" borderTop={`1px solid ${tokens.line}`}>
    <MicroLabel flexShrink={0}>{label}</MicroLabel>
    <Box textAlign="right" fontFamily={fonts.mono} fontSize="12px" color={tokens.text} wordBreak="break-all">
      {children}
    </Box>
  </Flex>
);

/**
 * Sign-In with Ethereum (EIP-4361) domain check. The background compares the
 * message's domain with the site Chrome says sent the request; this only
 * renders that verdict. The device shows these messages as a hash, so a
 * sign-in meant for another site can only be caught here.
 */
export default function SiweCard({ siwe, acknowledged, onAcknowledge }: Props) {
  const m = siwe.message;
  const danger = siwe.warnings.some(w => w.level === 'danger');
  const mismatch = siwe.warnings.some(w => w.level === 'danger' && w.code.endsWith('_mismatch'));
  const schemeMismatch = siwe.warnings.some(w => w.code === 'scheme_mismatch');
  const tone = danger ? tokens.bad : siwe.warnings.length ? tokens.warn : tokens.lineHi;
  // EIP-4361 assumes https when the scheme is omitted; spell it out when the scheme is what differs.
  const scheme = m?.scheme ?? (schemeMismatch ? 'https' : null);
  const target = m ? `${scheme ? `${scheme}://` : ''}${m.domain}` : 'Unknown';

  let siteHost: string | null = null;
  try {
    siteHost = siwe.origin ? new URL(siwe.origin).host : null;
  } catch {
    // Never shown — the ack falls back to the generic wording.
  }

  const heading = mismatch
    ? 'Sign-in site does not match this page'
    : danger
      ? "KeepKey can't verify this sign-in"
      : siwe.warnings.length
        ? 'Check this sign-in'
        : null;

  return (
    <Box borderWidth="1px" borderColor={tone} borderRadius="md" px={3} py={3} mb={3}>
      <MicroLabel mb={2}>Sign-In with Ethereum</MicroLabel>
      {heading && (
        <Text fontWeight={600} color={tone} mb={1}>
          {heading}
        </Text>
      )}
      {siwe.warnings.map(w => (
        <Text key={w.code} fontSize="sm" color={tokens.text} mb={1}>
          {w.text}
        </Text>
      ))}
      {danger && (
        <Text fontSize="sm" color={tokens.dim} mb={2}>
          Your KeepKey can't tell which site is asking — this panel is the only place that check happens.
        </Text>
      )}
      {!siwe.warnings.length && (
        <Text fontSize="sm" color={tokens.good} mb={2}>
          Sign-in domain matches the requesting site.
        </Text>
      )}

      <Row label="Site">{siwe.origin ?? 'Unknown'}</Row>
      <Row label="Signing in to">
        {target}
        {m && siwe.host && siwe.host !== m.domain && <Text color={tokens.faint}>{siwe.host}</Text>}
      </Row>
      {m && siwe.warnings.some(w => w.code === 'uri_mismatch') && <Row label="URI">{m.uri}</Row>}

      {danger && (
        <Checkbox
          mt={3}
          alignItems="flex-start"
          isChecked={acknowledged}
          onChange={e => onAcknowledge(e.target.checked)}
          sx={{ '.chakra-checkbox__control[data-checked]': { bg: tokens.bad, borderColor: tokens.bad } }}>
          <Text fontSize="sm">
            {mismatch && m && siteHost
              ? schemeMismatch
                ? `I understand ${siwe.origin} is asking to sign me in to ${target}`
                : `I understand ${siteHost} is asking to sign me in to ${m.domain}`
              : 'I understand the risk of agreeing to this sign-in'}
          </Text>
        </Checkbox>
      )}
    </Box>
  );
}
