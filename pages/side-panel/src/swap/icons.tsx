// Ported from the BEX design — minimal inline-SVG icon set.
import React from 'react';

export const Icon = ({
  d,
  size = 16,
  stroke = 1.6,
  style,
}: {
  d: string;
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}>
    <path d={d} />
  </svg>
);

export const I = {
  up: 'M12 19V5 M5 12l7-7 7 7',
  down: 'M12 5v14 M5 12l7 7 7-7',
  swap: 'M7 4v13 M4 14l3 3 3-3 M17 20V7 M14 10l3-3 3 3',
  copy: 'M9 9h10v10H9z M5 15V5h10',
  chev: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7 M21 3v6h-6',
  x: 'M6 6l12 12 M6 18L18 6',
  check: 'M5 13l4 4L19 7',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-3.5-3.5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  shield: 'M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z',
  send: 'M4 4l16 8-16 8 4-8-4-8z',
  recv: 'M20 20L4 12l16-8-4 8 4 8z',
} as const;
