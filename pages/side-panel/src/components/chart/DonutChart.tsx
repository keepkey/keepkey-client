import React from 'react';
import { pie, arc, PieArcDatum } from 'd3';
import AnimatedSlice from './AnimatedSlice';
import { Box } from '@chakra-ui/react';
import CountUp from 'react-countup';

// Theme colors - matching dashboard theme
const theme = {
  bg: '#000000',
  cardBg: '#111111',
  gold: '#FFD700',
  goldHover: '#FFE135',
  border: '#222222',
};

export interface DonutChartItem {
  name: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutChartItem[];
  formatValue?: (value: number) => string;
  height?: number;
  width?: number;
  showTotalLabel?: boolean;
  activeIndex?: number;
  onHoverSlice?: (index: number | null) => void;
}

const DonutChart: React.FC<DonutChartProps> = ({
  data,
  formatValue = (value) => value.toString(),
  height = 220,
  width = 220,
  showTotalLabel = true,
  activeIndex,
  onHoverSlice,
}) => {
  const radius = Math.min(width, height) / 2;
  const gap = 0.01; // Gap between slices
  const lightStrokeEffect = 2; // 3d light effect around the slice

  // Calculate total for percentages
  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Pie layout and arc generator
  const pieLayout = pie<DonutChartItem>()
    .sort(null)
    .value((d) => d.value)
    .padAngle(gap); // Creates a gap between slices

  // Adjust innerRadius to create a thinner donut shape
  const innerRadius = radius * 0.65;
  const outerRadius = radius * 0.9; // Increased slightly since we don't need space for labels

  const arcGenerator = arc<PieArcDatum<DonutChartItem>>()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius)
    .cornerRadius(lightStrokeEffect); // Apply rounded corners

  // Hover effect - slightly larger arc
  const hoverArcGenerator = arc<PieArcDatum<DonutChartItem>>()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius * 1.05) // 5% larger on hover
    .cornerRadius(lightStrokeEffect);

  // Hit area - larger invisible area for better hover detection
  const hitAreaGenerator = arc<PieArcDatum<DonutChartItem>>()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius * 1.1)
    .cornerRadius(lightStrokeEffect);

  const arcs = pieLayout(data);

  return (
    <Box position="relative" height={`${height}px`} width={`${width}px`}>
      <svg
        viewBox={`-${radius} -${radius} ${radius * 2} ${radius * 2}`}
        width="100%"
        height="100%"
        className="overflow-visible"
      >
        {/* Slices */}
        {arcs.map((d, i) => {
          const isActive = activeIndex === i;
          const arcGen = isActive ? hoverArcGenerator : arcGenerator;

          return (
            <AnimatedSlice key={i} index={i} isActive={isActive}>
              <g>
                {/* Visible slice */}
                <path
                  stroke="#ffffff22" // Lighter stroke for a 3D effect
                  strokeWidth={lightStrokeEffect}
                  fill={d.data.color || theme.gold}
                  d={arcGen(d) || ''}
                  opacity={activeIndex !== undefined && activeIndex !== null && !isActive ? 0.7 : 1}
                  style={{ transition: 'all 0.15s ease-in-out' }}
                />

                {/* Invisible hit area for better hover detection */}
                <path
                  d={hitAreaGenerator(d) || ''}
                  fill="transparent"
                  onMouseEnter={() => onHoverSlice && onHoverSlice(i)}
                  onMouseLeave={() => onHoverSlice && onHoverSlice(null)}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            </AnimatedSlice>
          );
        })}

        {/* Center text showing total */}
        {showTotalLabel && total > 0 && (
          <g>
            <circle
              cx="0"
              cy="0"
              r={innerRadius * 0.85}
              fill="#00000060"
              stroke={theme.gold}
              strokeWidth="1"
              strokeOpacity="0.3"
            />
            <foreignObject
              x={-innerRadius * 0.75}
              y={-innerRadius * 0.5}
              width={innerRadius * 1.5}
              height={innerRadius * 1.0}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  color: theme.gold,
                  fontSize: `${radius * 0.16}px`,
                  fontWeight: 'bold',
                  textAlign: 'center',
                  filter: 'drop-shadow(0px 0px 1px rgba(0,0,0,0.8))',
                  gap: '0.25em',
                }}
              >
                <div>Portfolio</div>
                <div>
                  $<CountUp
                    end={total}
                    decimals={2}
                    duration={1.5}
                    separator=","
                  />
                </div>
              </div>
            </foreignObject>
          </g>
        )}
      </svg>
    </Box>
  );
};

export default DonutChart;
