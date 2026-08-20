import React from 'react';
import Svg, { Polygon } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';

type HoneycombBackdropProps = {
  width: number;
  height: number;
  opacity?: number;
};

const HEX_SIZE = 28;

function hexPoints(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`;
  }).join(' ');
}

/**
 * A single, very-low-opacity honeycomb texture — used sparingly (empty states,
 * header backgrounds) rather than as a pervasive theme, per the design brief.
 */
export function HoneycombBackdrop({ width, height, opacity = 0.04 }: HoneycombBackdropProps) {
  const theme = useTheme();
  const hexWidth = HEX_SIZE * Math.sqrt(3);
  const hexHeight = HEX_SIZE * 1.5;
  const cols = Math.ceil(width / hexWidth) + 2;
  const rows = Math.ceil(height / hexHeight) + 2;

  const hexes: { cx: number; cy: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * hexWidth + (row % 2 === 0 ? 0 : hexWidth / 2);
      const cy = row * hexHeight;
      hexes.push({ cx, cy });
    }
  }

  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {hexes.map((hex, i) => (
        <Polygon
          key={i}
          points={hexPoints(hex.cx, hex.cy, HEX_SIZE)}
          stroke={theme.colors.text.primary}
          strokeWidth={1}
          fill="none"
          opacity={opacity}
        />
      ))}
    </Svg>
  );
}
