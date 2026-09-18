// Rolling balance numeral (KEEPKEY_STYLE.md §6, "Number roll").
//
// Each digit is a column of the ten glyphs 0-9, translated up by
// `digit × lineHeight`. Symbols ($ , .) are static. A new value starts from a
// zeroed string of the same shape, so the reels spin up from 00,000.00 rather
// than snapping — which is what makes a refreshed balance legible as *changed*
// rather than merely different.
//
// Layout only ever changes via transform, never height (§6).
import React, { useEffect, useState } from 'react';
import { Box } from '@chakra-ui/react';
import { tokens, fonts, motion } from '../../styles/tokens';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function formatUsd(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Same string shape with every digit forced to zero — the roll's start state. */
export const zeroed = (formatted: string) => formatted.replace(/\d/g, '0');

interface RollingBalanceProps {
  /** The real value. Pass `null` while it is still unknown. */
  value: number | null;
  /** Digit height in px; also the type size the reels are cut to. */
  size?: number;
  /** Hold the reels at zero (used while the dashboard skeleton is up). */
  idle?: boolean;
}

export const RollingBalance = ({ value, size = 40, idle = false }: RollingBalanceProps) => {
  const lineHeight = Math.round(size * 1.2);
  const target = formatUsd(value ?? 0);
  const [shown, setShown] = useState(() => zeroed(target));

  useEffect(() => {
    if (idle || value === null) {
      setShown(zeroed(target));
      return;
    }
    // One frame at the zeroed shape first, so the transition has somewhere to
    // travel from even when the panel mounts straight into a loaded balance.
    const id = window.setTimeout(() => setShown(target), 30);
    return () => window.clearTimeout(id);
  }, [target, idle, value]);

  return (
    <Box
      aria-live="polite"
      aria-label={target}
      display="flex"
      fontFamily={fonts.mono}
      fontWeight={400}
      fontSize={`${size}px`}
      lineHeight={`${lineHeight}px`}
      height={`${lineHeight}px`}
      letterSpacing="-0.03em"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
      marginTop="6px"
      paddingX="1px">
      {shown.split('').map((ch, i) => {
        const isDigit = /\d/.test(ch);
        if (!isDigit) {
          return (
            <Box key={i} height={`${lineHeight}px`} color={tokens.dim} aria-hidden>
              {ch}
            </Box>
          );
        }
        return (
          <Box key={i} height={`${lineHeight}px`} overflow="hidden" aria-hidden>
            <Box
              transition={`transform ${motion.draw} ${motion.ease}`}
              transform={`translateY(-${Number(ch) * lineHeight}px)`}>
              {DIGITS.map(d => (
                <Box key={d} height={`${lineHeight}px`}>
                  {d}
                </Box>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default RollingBalance;
