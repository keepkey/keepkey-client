/**
 * Hive approval body: what the request does, which key signs, every operation
 * in readable rows, and the checks the KeepKey enforces — a request the device
 * would refuse is flagged here, before Approve. View model:
 * @extension/shared hiveApproval (unit-tested per Keychain method).
 */
import { useState } from 'react';
import { Box, Flex, Stack, Text } from '@chakra-ui/react';
import type { HiveApprovalView, HiveCheck, HiveOpView, HiveRow } from '@extension/shared';
import { tokens, fonts } from '../../styles/tokens';
import { Chip, CodeBlock, KvRow, Muted, SectionLabel, Surface, ToneDot, type Tone } from '../ui';

const checkTone = (s: HiveCheck['status']): Tone => (s === 'block' ? 'bad' : s === 'warn' ? 'warn' : 'good');

const toggleStyle = {
  as: 'button' as const,
  fontFamily: fonts.mono,
  fontSize: '11px',
  letterSpacing: '0.06em',
  color: tokens.dim,
  marginTop: '6px',
  _hover: { color: tokens.text },
};

/** Long text (post body, memo): a few lines, then "Show all". */
function LongValue({ row }: { row: HiveRow }) {
  const [open, setOpen] = useState(false);
  const lines = row.value.split('\n').length;
  const clamp = !open && (lines > 4 || row.value.length > 280);
  return (
    <Box padding="10px 0" borderBottom={`1px solid ${tokens.line}`}>
      <SectionLabel>{row.label}</SectionLabel>
      {row.mono ? (
        <CodeBlock>{clamp ? `${row.value.slice(0, 280)}…` : row.value}</CodeBlock>
      ) : (
        <Text
          fontSize="13px"
          color={tokens.text}
          lineHeight="1.5"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          noOfLines={clamp ? 4 : undefined}>
          {row.value || '(empty)'}
        </Text>
      )}
      {(lines > 4 || row.value.length > 280) && (
        <Box {...toggleStyle} onClick={() => setOpen(v => !v)}>
          {open ? '− Show less' : '+ Show all'}
        </Box>
      )}
    </Box>
  );
}

function Rows({ rows }: { rows: HiveRow[] }) {
  return (
    <>
      {rows.map((r, i) =>
        r.long ? (
          <LongValue key={`${r.label}-${i}`} row={r} />
        ) : (
          <KvRow key={`${r.label}-${i}`} label={r.label} last={i === rows.length - 1}>
            {r.value}
          </KvRow>
        ),
      )}
    </>
  );
}

function OpCard({ op }: { op: HiveOpView }) {
  const [details, setDetails] = useState(false);
  return (
    <Surface data-hive-op={op.op}>
      <Flex justifyContent="space-between" alignItems="center" gap="10px" marginBottom="4px">
        <Text fontSize="13.5px" fontWeight={600} color={tokens.text} wordBreak="break-word">
          {op.title}
        </Text>
        <Chip title="Hive operation">
          <Text as="span" textTransform="none">
            {op.opNumber !== undefined ? `op ${op.opNumber} · ` : ''}
            {op.op}
          </Text>
        </Chip>
      </Flex>
      <Rows rows={op.rows} />
      {op.details.length > 0 && (
        <>
          <Box {...toggleStyle} onClick={() => setDetails(v => !v)}>
            {details ? '− Details' : '+ Details'}
          </Box>
          {details && <Rows rows={op.details} />}
        </>
      )}
    </Surface>
  );
}

export function HiveRequestSummary({ view }: { view: HiveApprovalView }) {
  return (
    <Surface edge={view.keyRole === 'active' ? 'warn' : 'good'} padding="12px 14px" data-hive-title={view.title}>
      <Text fontSize="14px" fontWeight={600} color={tokens.text} wordBreak="break-word">
        {view.title}
      </Text>
      <Muted marginTop="2px">{view.description}</Muted>
      <Flex gap="6px" marginTop="10px" flexWrap="wrap">
        {view.account && <Chip>@{view.account}</Chip>}
        <Chip tone={view.keyRole === 'active' ? 'warn' : 'good'}>{view.keyRole} key</Chip>
      </Flex>
    </Surface>
  );
}

export function HiveChecks({ view }: { view: HiveApprovalView }) {
  return (
    <Surface padding="10px 14px">
      {view.checks.map((c, i) => (
        <Flex key={i} gap="10px" alignItems="baseline" padding="6px 0" data-hive-check={c.status}>
          <Box transform="translateY(-1px)">
            <ToneDot tone={checkTone(c.status)} size={7} />
          </Box>
          <Box>
            <Text fontSize="12.5px" fontWeight={600} color={c.status === 'block' ? tokens.bad : tokens.text}>
              {c.title}
            </Text>
            {c.detail && <Muted>{c.detail}</Muted>}
          </Box>
        </Flex>
      ))}
      {view.deviceHint && (
        <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} marginTop="6px">
          KeepKey screen: “{view.deviceHint}”
        </Text>
      )}
    </Surface>
  );
}

/** Basic tab: the message (signBuffer) or one card per operation. */
export function HiveDetails({ view }: { view: HiveApprovalView }) {
  if (view.message) {
    return (
      <Box>
        {view.message.purpose && <Muted marginBottom="8px">{view.message.purpose}</Muted>}
        <SectionLabel>{view.message.printable ? 'Message' : 'Message (not readable text)'}</SectionLabel>
        <CodeBlock>{view.message.text || '(empty)'}</CodeBlock>
      </Box>
    );
  }
  if (!view.ops.length) {
    return <Muted>No readable details. The Raw tab has the complete request.</Muted>;
  }
  return (
    <Stack spacing="10px">
      {view.ops.map((op, i) => (
        <OpCard key={i} op={op} />
      ))}
    </Stack>
  );
}

/** First blocking check, or undefined — the reason Approve is disabled. */
export const hiveBlockReason = (view: HiveApprovalView | null) => view?.checks.find(c => c.status === 'block')?.title;

export type HiveSignerPick = 'keepkey' | 'client';

/** Blocking reason given who signs: the browser key is not bound by KeepKey-only limits. */
export const hiveBlockReasonFor = (view: HiveApprovalView | null, signer: HiveSignerPick) =>
  view?.checks.find(c => c.status === 'block' && !(signer === 'client' && c.deviceOnly))?.title;

/**
 * Signer choice for posting-only Hive batches when a browser posting key
 * exists. Over the KeepKey's limits the KeepKey option is disabled and the
 * browser key is offered instead of a dead end.
 */
export function HiveSignerChoice({
  view,
  value,
  onChange,
}: {
  view: HiveApprovalView;
  value: HiveSignerPick;
  onChange: (v: HiveSignerPick) => void;
}) {
  const deviceBlocked = view.checks.some(c => c.status === 'block' && c.deviceOnly);
  const option = (pick: HiveSignerPick, title: string, detail: string, disabled = false) => (
    <Box
      as="button"
      type="button"
      onClick={() => !disabled && onChange(pick)}
      textAlign="left"
      padding="10px 12px"
      borderRadius="10px"
      border={`1px solid ${value === pick ? tokens.text : tokens.line}`}
      background={value === pick ? tokens.surfaceHi : 'transparent'}
      opacity={disabled ? 0.45 : 1}
      cursor={disabled ? 'not-allowed' : 'pointer'}
      data-hive-signer={pick}
      aria-pressed={value === pick}>
      <Text fontSize="12.5px" fontWeight={600} color={tokens.text}>
        {title}
      </Text>
      <Muted>{detail}</Muted>
    </Box>
  );
  return (
    <Surface padding="10px 14px">
      <SectionLabel>Sign with</SectionLabel>
      <Stack spacing="8px">
        {option(
          'keepkey',
          'KeepKey',
          deviceBlocked ? 'Too big for the KeepKey.' : 'Confirm on the device.',
          deviceBlocked,
        )}
        {option('client', 'Browser posting key', 'Signs here, no device step. Posting only — it can never move funds.')}
      </Stack>
    </Surface>
  );
}
