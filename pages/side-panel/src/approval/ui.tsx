// Approval-screen primitives (KEEPKEY_STYLE.md §0, §2, §3).
//
// One visual language for every approval card: warm-black surfaces with a
// hairline border, mono micro labels, mono values. Colour carries meaning
// only — a small status dot or a 2px edge — never whole yellow/orange
// paragraphs. Gold is reserved for the single primary action (Approve).
import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { tokens, fonts } from '../styles/tokens';
import { MicroLabel } from '../components/v2/primitives';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const toneColor = (tone: Tone): string =>
  tone === 'good' ? tokens.good : tone === 'warn' ? tokens.warn : tone === 'bad' ? tokens.bad : tokens.faint;

export const ToneDot = ({ tone, size = 6 }: { tone: Tone; size?: number }) => (
  <Box flexShrink={0} width={`${size}px`} height={`${size}px`} borderRadius="50%" background={toneColor(tone)} />
);

/** Raised surface card. `edge` paints a 2px left rule in the tone colour. */
export const Surface = ({
  children,
  edge,
  ...rest
}: { children: React.ReactNode; edge?: Tone } & React.ComponentProps<typeof Box>) => (
  <Box
    background={tokens.surface}
    border={`1px solid ${tokens.line}`}
    borderLeft={edge ? `2px solid ${toneColor(edge)}` : undefined}
    borderRadius="12px"
    padding="14px 16px"
    {...rest}>
    {children}
  </Box>
);

/** Mono pill: `● P4`, `ETHEREUM`. */
export const Chip = ({ children, tone, title }: { children: React.ReactNode; tone?: Tone; title?: string }) => (
  <Flex
    as="span"
    display="inline-flex"
    alignItems="center"
    gap="6px"
    height="22px"
    padding="0 8px"
    borderRadius="999px"
    border={`1px solid ${tokens.lineHi}`}
    background={tokens.surfaceHi}
    fontFamily={fonts.mono}
    fontSize="10.5px"
    letterSpacing="0.08em"
    textTransform="uppercase"
    color={tokens.dim}
    whiteSpace="nowrap"
    title={title}>
    {tone && <ToneDot tone={tone} />}
    {children}
  </Flex>
);

/**
 * Label/value row with a hairline under it. Values are mono; long ones wrap
 * (addresses break anywhere) and keep the full string in the tooltip.
 */
export const KvRow = ({
  label,
  children,
  title,
  last,
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
  last?: boolean;
}) => (
  <Flex
    justifyContent="space-between"
    alignItems="baseline"
    gap="16px"
    padding="10px 0"
    borderBottom={last ? undefined : `1px solid ${tokens.line}`}>
    <MicroLabel flexShrink={0}>{label}</MicroLabel>
    <Box
      textAlign="right"
      fontFamily={fonts.mono}
      fontSize="12.5px"
      color={tokens.text}
      wordBreak="break-all"
      minWidth={0}
      title={title}>
      {children}
    </Box>
  </Flex>
);

/** Section heading inside a card. */
export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <MicroLabel marginBottom="6px">{children}</MicroLabel>
);

/** Scrollable mono block for calldata / raw payloads — never a textarea. */
export const CodeBlock = ({ children }: { children: React.ReactNode }) => (
  <Box
    as="pre"
    margin={0}
    padding="10px 12px"
    maxHeight="140px"
    overflowY="auto"
    background={tokens.bg}
    border={`1px solid ${tokens.line}`}
    borderRadius="8px"
    fontFamily={fonts.mono}
    fontSize="11.5px"
    lineHeight="1.6"
    color={tokens.dim}
    whiteSpace="pre-wrap"
    wordBreak="break-all">
    {children}
  </Box>
);

export const Muted = ({ children, ...rest }: { children: React.ReactNode } & React.ComponentProps<typeof Text>) => (
  <Text fontSize="12.5px" color={tokens.dim} lineHeight="1.5" {...rest}>
    {children}
  </Text>
);
