import React from 'react';
import { render } from '@testing-library/react-native';
import { StreakRiskNudge } from '../StreakRiskNudge';

describe('StreakRiskNudge', () => {
  it('renders nothing when there is no streak to protect', async () => {
    const { toJSON } = await render(<StreakRiskNudge streak={0} hour={19} isTodayCompleted={false} hasPlanToday />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing once today is already completed', async () => {
    const { toJSON } = await render(<StreakRiskNudge streak={5} hour={19} isTodayCompleted hasPlanToday />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when today has no required plan', async () => {
    const { toJSON } = await render(
      <StreakRiskNudge streak={5} hour={19} isTodayCompleted={false} hasPlanToday={false} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing before the evening cutoff', async () => {
    const { toJSON } = await render(<StreakRiskNudge streak={5} hour={16} isTodayCompleted={false} hasPlanToday />);
    expect(toJSON()).toBeNull();
  });

  it('shows the nudge with hours-left and correct pluralization once evening arrives', async () => {
    const { getByText } = await render(<StreakRiskNudge streak={5} hour={17} isTodayCompleted={false} hasPlanToday />);
    expect(getByText('Your 5-day streak is still alive — about 7 hours left today.')).toBeTruthy();
  });

  it('singularizes "hour" for the last hour of the day', async () => {
    const { getByText } = await render(<StreakRiskNudge streak={1} hour={23} isTodayCompleted={false} hasPlanToday />);
    expect(getByText('Your 1-day streak is still alive — about 1 hour left today.')).toBeTruthy();
  });
});
