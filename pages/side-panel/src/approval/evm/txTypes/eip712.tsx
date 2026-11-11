import React, { useState } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { ChevronDownIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { format, formatDistanceToNow } from 'date-fns';
import { MicroLabel } from '../../../components/v2/primitives';
import { getNetworkName } from '../../../components/header/headerConstants';
import { fonts, tokens } from '../../../styles/tokens';

/**
 * Approval view for eth_signTypedData / _v3 / _v4.
 *
 * The device signs typed data by hash (hdwallet-keepkey sends
 * EthereumSignTypedHash), so its screen shows two hashes and this card is the
 * user's only readable view of a permit. It renders the summary the background
 * decoded (chrome-extension/src/background/chains/evmTypedData.ts) and decodes
 * nothing itself: the summary reads values the way the vault's hasher does, and
 * a second reading here could only disagree with it.
 */

/** Mirrors TypedDataSummary from chrome-extension/src/background/chains/evmTypedData.ts */
interface TimeValue {
  raw: string;
  unixMs: number | null;
  note: 'no-deadline' | 'submitting-block' | null;
}
interface PermitToken {
  address: string;
  amountRaw: string;
  unlimited: boolean;
  symbol: string | null;
  decimals: number | null;
  amount: string | null;
  expires: TimeValue | null;
}
interface FieldNode {
  name: string;
  type: string;
  value: string | null;
  invalid: boolean;
  children: FieldNode[] | null;
}
interface TypedDataWarning {
  code: string;
  severity: 'danger' | 'caution';
  params: Record<string, string>;
}
interface TypedDataSummary {
  kind: 'eip2612' | 'dai-permit' | 'permit2-allowance' | 'permit2-transfer' | 'generic';
  looksLikePermit: boolean;
  primaryType: string;
  tokens: PermitToken[];
  spender: string | null;
  deadline: TimeValue | null;
  verifyingContract: string | null;
  unreadableContract: string | null;
  chainId: string | null;
  warnings: TypedDataWarning[];
  domainFields: FieldNode[];
  messageFields: FieldNode[];
  unsigned: { path: string; value: string }[];
}

const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';

const KIND_COPY: Record<TypedDataSummary['kind'], { title: string; explain: string }> = {
  eip2612: {
    title: 'Token permit',
    explain:
      'Gives the spender an allowance on this token that lasts until you revoke it. The deadline only limits when this signature can be used.',
  },
  'dai-permit': {
    title: 'DAI-style permit',
    explain:
      "Sets the spender's allowance on this token to unlimited or to zero, until you revoke it. The deadline only limits when this signature can be used.",
  },
  'permit2-allowance': {
    title: 'Permit2 allowance',
    explain: 'Gives the spender an allowance through Uniswap Permit2, until the expiry shown for each token.',
  },
  'permit2-transfer': {
    title: 'Permit2 transfer',
    explain: 'Lets the spender make one transfer of up to this amount through Uniswap Permit2, before the deadline.',
  },
  generic: {
    title: 'Typed data',
    explain: 'KeepKey does not recognise this format. Every field that will be signed is listed below.',
  },
};

const chainLabel = (id: string) => {
  const name = getNetworkName(`eip155:${id}`);
  return name ? `${name} (chain ${id})` : `chain ${id}`;
};

function timeText(t: TimeValue): string {
  if (t.note === 'no-deadline') return 'No deadline';
  if (t.note === 'submitting-block') return 'Only in the block that submits it';
  if (t.unixMs === null) return 'Never (beyond any real date)';
  const d = new Date(t.unixMs);
  return `${format(d, 'PPpp')} (${formatDistanceToNow(d, { addSuffix: true })})`;
}

function warningText(w: TypedDataWarning, s: TypedDataSummary): React.ReactNode {
  const token = (address: string) => {
    const symbol = s.tokens.find(t => t.address === address)?.symbol;
    return symbol ? <bdi>{symbol}</bdi> : address;
  };
  switch (w.code) {
    case 'UNLIMITED_AMOUNT':
      // A SignatureTransfer is one transfer, not a standing allowance.
      return s.kind === 'permit2-transfer' ? (
        <>
          UNLIMITED transfer: the spender can take all of your {token(w.params.token)} in one transfer before the
          deadline.
        </>
      ) : (
        <>UNLIMITED approval: the spender can take all of your {token(w.params.token)}, now and later.</>
      );
    case 'LONG_ALLOWANCE':
      return <>The {token(w.params.token)} allowance lasts more than 30 days.</>;
    case 'CHAIN_MISMATCH':
      return `Signed for ${chainLabel(w.params.domainChainId)}, but you are connected to ${chainLabel(w.params.activeChainId)}.`;
    case 'NO_CHAIN_BINDING':
      return 'No chain binding: this signature is not tied to one network.';
    case 'PERMIT2_NOT_CANONICAL':
      return `Claims to be Permit2, but ${w.params.verifyingContract || 'no contract'} is not Uniswap's Permit2. Review every field.`;
    case 'UNDECODABLE_PERMIT':
      return 'Token approval KeepKey could not decode — treat as UNLIMITED.';
    case 'UNKNOWN_TOKEN':
      return `Unknown token ${w.params.token}: amount shown in raw units.`;
    case 'FIELDS_TRUNCATED':
      return 'Too large to show in full: some fields below are cut off.';
    case 'UNREADABLE_DOMAIN':
      return 'KeepKey cannot read a signed domain field, so this signature may be valid for a contract or network not shown here. Check the domain under All signed fields.';
    case 'PERMIT2_WITNESS':
      return (
        <>
          This transfer also signs extra terms (
          <bdi>
            {w.params.type} {w.params.field}
          </bdi>
          ) that the spender acts on, such as who receives what you get back. Review them under All signed fields.
        </>
      );
    default:
      return w.code;
  }
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Box py="8px" borderBottom={`1px solid ${tokens.line}`}>
    <MicroLabel>{label}</MicroLabel>
    <Text fontFamily={fonts.mono} fontSize="12px" color={tokens.text} mt="3px" wordBreak="break-all">
      {children}
    </Text>
  </Box>
);

function TokenBlock({ token, kind }: { token: PermitToken; kind: TypedDataSummary['kind'] }) {
  const symbol = token.symbol && (
    <>
      {' '}
      <bdi>{token.symbol}</bdi>
    </>
  );
  return (
    <Box py="10px" borderBottom={`1px solid ${tokens.line}`}>
      <MicroLabel>{kind === 'permit2-transfer' ? 'Max transfer' : 'Allowance'}</MicroLabel>
      <Text
        fontFamily={fonts.mono}
        fontSize="20px"
        mt="4px"
        color={token.unlimited ? tokens.bad : tokens.text}
        wordBreak="break-all">
        {token.unlimited ? 'UNLIMITED' : (token.amount ?? `${token.amountRaw} raw units`)}
        {symbol}
      </Text>
      <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} mt="4px" wordBreak="break-all">
        {token.address}
      </Text>
      <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} wordBreak="break-all">
        raw {token.amountRaw} · {token.decimals !== null ? `${token.decimals} decimals` : 'decimals unknown'}
      </Text>
      {(kind === 'eip2612' || kind === 'dai-permit') && (
        <Text fontSize="12px" color={tokens.dim} mt="4px">
          Allowance: until revoked
        </Text>
      )}
      {token.expires && (
        <Text fontSize="12px" color={tokens.dim} mt="4px">
          Allowance expires: {timeText(token.expires)}
        </Text>
      )}
    </Box>
  );
}

function FieldTree({ nodes, depth = 0 }: { nodes: FieldNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Box key={i} pl={depth ? '12px' : 0} borderLeft={depth ? `1px solid ${tokens.line}` : undefined}>
          {/* Page-chosen names and types (up to 256 chars) wrap within a cap, so the value stays in view. */}
          <Flex gap="8px" alignItems="baseline" py="2px">
            <Text
              fontFamily={fonts.mono}
              fontSize="11px"
              color={tokens.dim}
              flexShrink={0}
              maxW="40%"
              wordBreak="break-all">
              {n.name}
            </Text>
            <Text
              fontFamily={fonts.mono}
              fontSize="10px"
              color={tokens.faint}
              flexShrink={0}
              maxW="25%"
              wordBreak="break-all">
              {n.type}
            </Text>
            {(n.value !== null || n.invalid) && (
              <Text
                fontFamily={fonts.mono}
                fontSize="11px"
                color={n.invalid ? tokens.bad : tokens.text}
                wordBreak="break-all"
                whiteSpace="pre-wrap">
                {n.value ?? 'invalid'}
              </Text>
            )}
          </Flex>
          {n.children && <FieldTree nodes={n.children} depth={depth + 1} />}
        </Box>
      ))}
    </>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box borderBottom={`1px solid ${tokens.line}`} py="6px">
      <Flex
        as="button"
        onClick={() => setOpen(o => !o)}
        alignItems="center"
        gap="6px"
        w="full"
        background="transparent"
        color={tokens.faint}
        textAlign="left">
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <MicroLabel>{title}</MicroLabel>
      </Flex>
      {open && <Box mt="6px">{children}</Box>}
    </Box>
  );
}

export default function Eip712Tx({ transaction }: any) {
  const s: TypedDataSummary | null = transaction?.typedDataSummary ?? null;

  if (!s) {
    // Events stored before the background attached a summary.
    return (
      <Box
        as="pre"
        fontFamily={fonts.mono}
        fontSize="11px"
        color={tokens.text}
        whiteSpace="pre-wrap"
        wordBreak="break-all">
        {JSON.stringify(transaction?.request ?? null, null, 2)}
      </Box>
    );
  }

  const copy =
    s.kind === 'generic' && s.looksLikePermit
      ? {
          title: 'Token approval',
          explain: 'This has the shape of a token approval, but KeepKey could not read it safely.',
        }
      : KIND_COPY[s.kind];
  const isPermit = s.kind !== 'generic';

  return (
    <Flex direction="column" mb={4}>
      <Text fontFamily={fonts.ui} fontSize="16px" fontWeight={600} color={tokens.text}>
        {copy.title}
      </Text>
      <Text fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} wordBreak="break-all">
        {s.primaryType}
      </Text>
      <Text fontSize="13px" color={tokens.dim} mt="6px">
        {copy.explain}
      </Text>

      {s.warnings.length > 0 && (
        <Flex direction="column" gap="6px" mt="12px">
          {s.warnings.map((w, i) => {
            const color = w.severity === 'danger' ? tokens.bad : tokens.warn;
            return (
              <Box key={i} borderLeft={`2px solid ${color}`} bg={tokens.surface} px="10px" py="8px">
                <MicroLabel color={color}>{w.severity === 'danger' ? 'Danger' : 'Caution'}</MicroLabel>
                <Text fontSize="13px" color={tokens.text} mt="2px" wordBreak="break-word">
                  {warningText(w, s)}
                </Text>
              </Box>
            );
          })}
        </Flex>
      )}

      <Box mt="8px">
        {s.tokens.map((t, i) => (
          <TokenBlock key={i} token={t} kind={s.kind} />
        ))}
        {s.spender && (
          <Row label="Spender">
            {s.spender}
            {s.spender.toLowerCase() === PERMIT2 && ' · Uniswap Permit2'}
          </Row>
        )}
        {s.deadline && (
          <Row label={s.kind === 'permit2-transfer' ? 'Transfer deadline' : 'Must be submitted by'}>
            {timeText(s.deadline)}
          </Row>
        )}
        <Row label="Contract">
          {s.verifyingContract ??
            (s.unreadableContract ? (
              <Text as="span" color={tokens.bad}>
                Unreadable: {s.unreadableContract}
              </Text>
            ) : (
              'Not signed'
            ))}
          {s.verifyingContract?.toLowerCase() === PERMIT2 && ' · Uniswap Permit2'}
        </Row>
        <Row label="Network">{s.chainId ? chainLabel(s.chainId) : 'No chain binding'}</Row>

        <Section
          title="All signed fields"
          defaultOpen={!isPermit || s.warnings.some(w => w.code === 'PERMIT2_WITNESS')}>
          <MicroLabel>Domain</MicroLabel>
          <FieldTree nodes={s.domainFields} />
          <MicroLabel mt="8px">Message</MicroLabel>
          <FieldTree nodes={s.messageFields} />
        </Section>
        {s.unsigned.length > 0 && (
          <Section title="Not signed (ignored)" defaultOpen={!isPermit}>
            {s.unsigned.map((u, i) => (
              <Text key={i} fontFamily={fonts.mono} fontSize="11px" color={tokens.faint} wordBreak="break-all">
                {u.path}: {u.value}
              </Text>
            ))}
          </Section>
        )}
      </Box>
    </Flex>
  );
}
