// Portfolio allocation (KEEPKEY_STYLE.md §0).
//
// v2 replaces the donut with a 3px stacked bar: segments grow from scaleX(0)
// with an 80ms stagger, largest first. A bar reads allocation at a glance in a
// 400px panel far better than a ring does, and it costs 3px of vertical space
// instead of 160.
//
// Chain brand colours are used here and in the legend dots only — never for
// text or buttons (§2).
import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { tokens, fonts, motion } from '../../styles/tokens';

export interface AllocationSegment {
  /** Stable key — a CAIP/network id, not the index. */
  id: string;
  /** Ticker shown in the legend. */
  label: string;
  color: string;
  /** Fiat value; shares are computed from the total of all segments. */
  value: number;
}

interface AllocationBarProps {
  segments: AllocationSegment[];
  /** Flip to true once balances have landed to run the grow-in. */
  grown: boolean;
  /** How many segments get a legend entry; the rest collapse to "+N MORE". */
  legendCount?: number;
}

export const AllocationBar = ({ segments, grown, legendCount = 3 }: AllocationBarProps) => {
  const ranked = [...segments].filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  const total = ranked.reduce((sum, s) => sum + s.value, 0);
  if (!ranked.length || total <= 0) return null;

  const pct = (v: number) => (v / total) * 100;
  const legend = ranked.slice(0, legendCount);
  const more = ranked.length - legend.length;

  return (
    <>
      <Flex gap="2px" height="3px" marginTop="18px" borderRadius="2px" overflow="hidden">
        {ranked.map((s, i) => (
          <Box
            key={s.id}
            width={`${pct(s.value).toFixed(2)}%`}
            background={s.color}
            transformOrigin="left"
            transform={`scaleX(${grown ? 1 : 0})`}
            transition={`transform ${motion.draw} ${motion.ease} ${i * 80}ms`}
          />
        ))}
      </Flex>
      <Flex
        gap="14px"
        marginTop="10px"
        fontFamily={fonts.mono}
        fontSize="11px"
        color={tokens.faint}
        flexWrap="wrap"
        aria-hidden>
        {legend.map(s => (
          <Flex key={s.id} alignItems="center" gap="6px">
            <Box width="6px" height="6px" borderRadius="50%" background={s.color} />
            <Text as="span" color={tokens.dim}>
              {s.label}
            </Text>
            <Text as="span">{pct(s.value).toFixed(1)}%</Text>
          </Flex>
        ))}
        {more > 0 && <Text as="span">{`+${more} MORE`}</Text>}
      </Flex>
    </>
  );
};

export default AllocationBar;
