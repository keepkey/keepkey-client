// Shared v2 primitives (KEEPKEY_STYLE.md §0, §3, §5).
//
// The small pieces every v2 screen is built from: the mono micro label, the
// hairline field that replaces boxed inputs, the 60px hairline row, and the
// skeleton that stands in for a row while balances load.
import React from 'react';
import { Box, Flex, Input, Text } from '@chakra-ui/react';
import { tokens, fonts, motion } from '../../styles/tokens';

/** Uppercase mono micro label — Geist Mono 10.5px, tracking .16em (§0). */
export const MicroLabel = ({
  children,
  color = tokens.faint,
  ...rest
}: {
  children: React.ReactNode;
  color?: string;
} & React.ComponentProps<typeof Text>) => (
  <Text
    fontFamily={fonts.mono}
    fontSize="10.5px"
    letterSpacing="0.16em"
    textTransform="uppercase"
    color={color}
    transition={`color ${motion.fast} ease`}
    {...rest}>
    {children}
  </Text>
);

interface HairlineFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rendered to the right of the label — percentage chips, a PASTE button. */
  actions?: React.ReactNode;
  /** Mono helper under the value (fiat estimate, validation message). */
  hint?: string;
  hintColor?: string;
  /** Amount fields use the 34px numeral; address fields stay at 13px. */
  size?: 'amount' | 'text';
  /** Ticker or unit pinned to the right of an amount. */
  suffix?: string;
  inputMode?: 'decimal' | 'text';
}

/**
 * Hairline field (§0) — no box, no fill. A micro label, the value, and a 1px
 * bottom line; focus turns both the line and the label gold. Removing the box
 * is what lets a 400px panel carry a 34px amount without feeling cramped.
 */
export const HairlineField = ({
  label,
  value,
  onChange,
  placeholder,
  actions,
  hint,
  hintColor = tokens.faint,
  size = 'text',
  suffix,
  inputMode,
}: HairlineFieldProps) => {
  const [focused, setFocused] = React.useState(false);
  const isAmount = size === 'amount';

  return (
    <Box
      borderBottom={`1px solid ${focused ? tokens.accent : tokens.lineHi}`}
      padding="0 2px 10px"
      transition={`border-color ${motion.fast} ease`}>
      <Flex justifyContent="space-between" alignItems="center">
        <MicroLabel color={focused ? tokens.accent : tokens.faint}>{label}</MicroLabel>
        {actions}
      </Flex>
      <Flex alignItems="baseline" gap="10px" marginTop={isAmount ? '6px' : '8px'}>
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          spellCheck={false}
          inputMode={inputMode ?? (isAmount ? 'decimal' : 'text')}
          variant="unstyled"
          flex={1}
          minWidth={0}
          height={isAmount ? '40px' : '24px'}
          color={tokens.text}
          fontFamily={fonts.mono}
          fontSize={isAmount ? '34px' : '13px'}
          fontWeight={400}
          letterSpacing={isAmount ? '-0.03em' : undefined}
        />
        {suffix && (
          <Text as="span" fontFamily={fonts.mono} fontSize="13px" color={tokens.dim} letterSpacing="0.06em">
            {suffix}
          </Text>
        )}
      </Flex>
      {hint && (
        <Text fontFamily={fonts.mono} fontSize="12px" color={hintColor} marginTop="4px">
          {hint}
        </Text>
      )}
    </Box>
  );
};

/**
 * 60px list row with a hairline divider (§0) — no cards. Grid is
 * `28px 1fr auto`: logo, name over a mono sub-line, value over a mono delta.
 */
export const HairlineRow = ({
  icon,
  title,
  subtitle,
  value,
  delta,
  deltaColor = tokens.faint,
  onClick,
  delayMs = 0,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  delta?: React.ReactNode;
  deltaColor?: string;
  onClick?: () => void;
  delayMs?: number;
}) => (
  <Box
    as={onClick ? 'button' : 'div'}
    onClick={onClick}
    width="100%"
    display="grid"
    gridTemplateColumns="28px 1fr auto"
    gap="12px"
    alignItems="center"
    height="60px"
    padding="0 2px"
    border={0}
    borderBottom={`1px solid ${tokens.line}`}
    background="transparent"
    color={tokens.text}
    textAlign="left"
    cursor={onClick ? 'pointer' : 'default'}
    animation={`kk-rise 400ms ${motion.ease} ${delayMs}ms both`}
    _hover={onClick ? { background: tokens.bg2 } : undefined}>
    {icon}
    <Box minWidth={0}>
      <Text fontSize="14px" fontWeight={500} noOfLines={1}>
        {title}
      </Text>
      {subtitle && (
        <Text fontSize="11px" color={tokens.faint} fontFamily={fonts.mono} marginTop="3px" noOfLines={1}>
          {subtitle}
        </Text>
      )}
    </Box>
    {(value || delta) && (
      <Box textAlign="right">
        {value && (
          <Text fontFamily={fonts.mono} fontSize="14px" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Text>
        )}
        {delta && (
          <Text fontFamily={fonts.mono} fontSize="11px" marginTop="3px" color={deltaColor}>
            {delta}
          </Text>
        )}
      </Box>
    )}
  </Box>
);

const shimmer = {
  background: `linear-gradient(90deg,${tokens.surface} 25%,${tokens.surface3} 50%,${tokens.surface} 75%)`,
  backgroundSize: '200% 100%',
  animation: 'kk-shimmer 1.4s linear infinite',
};

/** Skeleton rows share the row's exact geometry (§5) so nothing jumps when the
 *  real balances land. */
export const SkeletonRows = ({ count = 5 }: { count?: number }) => (
  <Box display="flex" flexDirection="column">
    {Array.from({ length: count }, (_, i) => (
      <Box
        key={i}
        display="grid"
        gridTemplateColumns="28px 1fr auto"
        gap="12px"
        alignItems="center"
        height="60px"
        borderBottom={`1px solid ${tokens.line}`}>
        <Box width="28px" height="28px" borderRadius="50%" sx={shimmer} />
        <Flex direction="column" gap="7px">
          <Box height="11px" width="92px" borderRadius="4px" sx={shimmer} />
          <Box height="9px" width="58px" borderRadius="4px" sx={shimmer} />
        </Flex>
        <Box height="11px" width="70px" borderRadius="4px" sx={shimmer} />
      </Box>
    ))}
  </Box>
);
