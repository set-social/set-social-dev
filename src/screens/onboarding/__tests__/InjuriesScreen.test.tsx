import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { InjuriesScreen } from '../InjuriesScreen';
import { useOnboardingStore } from '../../../store/onboardingStore';

const mockNavigate = jest.fn();
const navigation = { navigate: mockNavigate } as never;
const route = { key: 'injuries', name: 'Injuries' as const, params: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  useOnboardingStore.setState({
    sex: 'female',
    heightFeet: 5,
    heightInches: 6,
    weightLb: 140,
    goal: 'strength',
    experienceLevel: 'intermediate',
    daysPerWeek: 4,
    equipment: ['barbell', 'dumbbell'],
    injuriesNotes: '',
  });
});

describe('InjuriesScreen', () => {
  it('advances to BuildFirstWeek without saving anything itself', async () => {
    const { getByText } = await render(<InjuriesScreen navigation={navigation} route={route} />);
    await fireEvent.press(getByText('Next'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('BuildFirstWeek'));
  });

  it('shows an inline error and does not navigate when answers are missing', async () => {
    useOnboardingStore.setState({ daysPerWeek: null });

    const { getByText } = await render(<InjuriesScreen navigation={navigation} route={route} />);
    await fireEvent.press(getByText('Next'));

    await waitFor(() => expect(getByText(/please go back and complete every step/i)).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
