import React, { useMemo } from 'react';
import { Box, Text, Flex } from '@chakra-ui/react';
import { motion } from 'framer-motion';

const COLORS = [
  '#4299E1', // blue.400
  '#48BB78', // green.400
  '#ED8936', // orange.400
  '#9F7AEA', // purple.400
  '#F56565', // red.400
  '#718096', // gray.500 (Other)
];

interface DonutChartProps {
  balances: any[];
  totalUsd: number;
}

const DonutChart: React.FC<DonutChartProps> = ({ balances, totalUsd }) => {
  const slices = useMemo(() => {
    if (!balances || balances.length === 0 || totalUsd <= 0) return [];

    const sorted = [...balances]
      .filter(b => parseFloat(b.valueUsd || '0') > 0)
      .sort((a, b) => parseFloat(b.valueUsd || '0') - parseFloat(a.valueUsd || '0'));

    const top5 = sorted.slice(0, 5);
    const otherValue = sorted.slice(5).reduce((sum, b) => sum + parseFloat(b.valueUsd || '0'), 0);

    const items = top5.map((b, i) => ({
      symbol: b.symbol || b.ticker || '?',
      value: parseFloat(b.valueUsd || '0'),
      color: COLORS[i],
    }));

    if (otherValue > 0) {
      items.push({ symbol: 'Other', value: otherValue, color: COLORS[5] });
    }

    return items;
  }, [balances, totalUsd]);

  if (slices.length === 0) return null;

  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const chainCount = slices.length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}>
      <Flex align="center" justify="center" gap={3}>
        <Box position="relative" w={`${size}px`} h={`${size}px`}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={strokeWidth}
            />
            {slices.map((slice, i) => {
              const pct = slice.value / totalUsd;
              const dashLength = pct * circumference;
              const dashGap = circumference - dashLength;
              const offset = cumulativeOffset;
              cumulativeOffset += dashLength;

              return (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${dashGap}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
          </svg>
          <Flex
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            align="center"
            justify="center"
            direction="column">
            <Text className="kk-eyebrow" lineHeight={1}>
              Portfolio
            </Text>
            <Text className="mono" fontSize="10px" color="kk.accent" mt="2px" lineHeight={1}>
              {chainCount} {chainCount === 1 ? 'chain' : 'chains'}
            </Text>
          </Flex>
        </Box>
        <Flex direction="column" gap={0.5}>
          {slices.map((slice, i) => (
            <Flex key={i} align="center" gap={1.5}>
              <Box w="8px" h="8px" borderRadius="full" bg={slice.color} flexShrink={0} />
              <Text fontSize="2xs" color="kk.dim" lineHeight={1.2}>
                {slice.symbol}
              </Text>
              <Text fontSize="2xs" color="kk.faint" lineHeight={1.2} className="mono">
                {((slice.value / totalUsd) * 100).toFixed(0)}%
              </Text>
            </Flex>
          ))}
        </Flex>
      </Flex>
    </motion.div>
  );
};

export default DonutChart;
