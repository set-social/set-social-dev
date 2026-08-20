import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TrendChart } from '../TrendChart';

const LAYOUT = { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 120 } } };

describe('TrendChart', () => {
  it('shows the empty label with fewer than 2 points, without ever measuring layout', async () => {
    const { getByText, queryByTestId } = await render(
      <TrendChart points={[10]} emptyLabel="Nothing yet" />,
    );
    expect(getByText('Nothing yet')).toBeTruthy();
    expect(queryByTestId('trend-chart-measure')).toBeNull();
  });

  it('renders first/middle/last date axis labels when dates are provided', async () => {
    const { getByTestId, getByText } = await render(
      <TrendChart
        points={[10, 20, 15, 30, 25]}
        dates={['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']}
      />,
    );
    await fireEvent(getByTestId('trend-chart-measure'), 'layout', LAYOUT);

    expect(getByText('Jan 1')).toBeTruthy();
    expect(getByText('Jan 3')).toBeTruthy();
    expect(getByText('Jan 5')).toBeTruthy();
  });

  it('does not render a delta line for callers that pass neither dates nor deltaVsPrevious', async () => {
    const { getByTestId, queryByText } = await render(
      <TrendChart points={[10, 20, 15]} />,
    );
    await fireEvent(getByTestId('trend-chart-measure'), 'layout', LAYOUT);
    expect(queryByText(/vs previous/)).toBeNull();
  });

  it('taps snap to the nearest point and show a dated tooltip with the formatted value', async () => {
    const { getByTestId, getByText, getAllByText } = await render(
      <TrendChart
        points={[100, 200, 150]}
        dates={['2026-01-01', '2026-01-02', '2026-01-03']}
        valueFormatter={v => `${v}kg`}
      />,
    );
    await fireEvent(getByTestId('trend-chart-measure'), 'layout', LAYOUT);

    // Middle of a 300-wide chart lands nearest the second point (index 1).
    await fireEvent.press(getByTestId('trend-chart-touch-area'), {
      nativeEvent: { locationX: 150, locationY: 50 },
    });

    expect(getByText('200kg')).toBeTruthy();
    // "Jan 2" is ambiguous here on purpose — it's both the tapped point's
    // tooltip date and the axis's own middle-date label, since the tapped
    // point (index 1) happens to be the axis midpoint for 3 points.
    expect(getAllByText('Jan 2').length).toBe(2);

    // Tapping the same spot again dismisses it (toggle behavior).
    await fireEvent.press(getByTestId('trend-chart-touch-area'), {
      nativeEvent: { locationX: 150, locationY: 50 },
    });
    expect(() => getByText('200kg')).toThrow();
  });

  it('renders an upward delta line in the success color when current >= previous', async () => {
    const { getByTestId, getByText } = await render(
      <TrendChart
        points={[10, 20]}
        deltaVsPrevious={{ current: 1200, previous: 1000, label: 'vs previous 7 days' }}
      />,
    );
    await fireEvent(getByTestId('trend-chart-measure'), 'layout', LAYOUT);

    expect(getByText('▲ 20%', { exact: false })).toBeTruthy();
    expect(getByText(/vs previous 7 days/)).toBeTruthy();
  });

  it('renders a downward delta line when current < previous', async () => {
    const { getByTestId, getByText } = await render(
      <TrendChart
        points={[10, 5]}
        deltaVsPrevious={{ current: 500, previous: 1000, label: 'vs previous 7 days' }}
      />,
    );
    await fireEvent(getByTestId('trend-chart-measure'), 'layout', LAYOUT);

    expect(getByText('▼ 50%', { exact: false })).toBeTruthy();
  });
});
