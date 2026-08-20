import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { BodyProfileScreen } from '../BodyProfileScreen';
import { useOnboardingStore } from '../../../store/onboardingStore';

const mockNavigate = jest.fn();
const navigation = { navigate: mockNavigate } as never;
const route = { key: 'body-profile', name: 'BodyProfile' as const, params: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  useOnboardingStore.setState({
    sex: null,
    heightFeet: null,
    heightInches: null,
    weightLb: null,
  });
});

describe('BodyProfileScreen', () => {
  it('disables Next until sex, height, and weight are all filled in', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <BodyProfileScreen navigation={navigation} route={route} />,
    );

    await fireEvent.press(getByText('Next'));
    expect(mockNavigate).not.toHaveBeenCalled();

    await fireEvent.press(getByText('Female'));
    await fireEvent.changeText(getByPlaceholderText('5'), '5');
    await fireEvent.changeText(getByPlaceholderText('10'), '6');
    await fireEvent.changeText(getByPlaceholderText('165'), '140');

    await fireEvent.press(getByText('Next'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceLevel');
  });

  it('stores the typed values in the onboarding store', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <BodyProfileScreen navigation={navigation} route={route} />,
    );

    await fireEvent.press(getByText('Male'));
    await fireEvent.changeText(getByPlaceholderText('5'), '6');
    await fireEvent.changeText(getByPlaceholderText('10'), '1');
    await fireEvent.changeText(getByPlaceholderText('165'), '190');

    await waitFor(() => {
      const state = useOnboardingStore.getState();
      expect(state.sex).toBe('male');
      expect(state.heightFeet).toBe(6);
      expect(state.heightInches).toBe(1);
      expect(state.weightLb).toBe(190);
    });
  });
});
