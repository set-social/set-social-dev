import React from 'react';
import { render } from '@testing-library/react-native';
import { LoadingScreen } from '../LoadingScreen';

describe('LoadingScreen', () => {
  it('renders the branded background with a labeled progress indicator', async () => {
    const { getByLabelText } = await render(<LoadingScreen />);
    expect(getByLabelText('Loading SetSocial')).toBeTruthy();
  });

  it('accepts a custom label for the progress indicator', async () => {
    const { getByLabelText } = await render(<LoadingScreen label="Checking your session" />);
    expect(getByLabelText('Checking your session')).toBeTruthy();
  });
});
