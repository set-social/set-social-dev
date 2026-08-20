import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { WelcomeScreen, fitBackdrop } from '../WelcomeScreen';

const mockNavigate = jest.fn();

function renderScreen() {
  return render(
    <WelcomeScreen
      navigation={{ navigate: mockNavigate } as never}
      route={{} as never}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WelcomeScreen', () => {
  it('renders the SetSocial wordmark and tagline over the backdrop', async () => {
    const { getByLabelText, getByText } = await renderScreen();
    expect(getByLabelText('SetSocial')).toBeTruthy();
    expect(getByText(/Sets made/)).toBeTruthy();
    expect(getByText('Social')).toBeTruthy();
  });

  it('navigates to Sign In', async () => {
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Sign In'));
    expect(mockNavigate).toHaveBeenCalledWith('SignIn');
  });

  it('navigates to Sign Up from Create Account', async () => {
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Create Account'));
    expect(mockNavigate).toHaveBeenCalledWith('SignUp');
  });
});

describe('fitBackdrop', () => {
  const ASPECT_RATIO = 853 / 1844;

  it('always returns a box with the source photo\'s exact aspect ratio, regardless of screen ratio', () => {
    for (const [screenWidth, screenHeight] of [
      [390, 844], // a typical narrow phone (taller than the photo, relatively)
      [430, 932], // a typical wide phone
      [768, 1024], // a much squarer ratio (tablet) — the case the old per-axis scaling got wrong
    ]) {
      const { width, height } = fitBackdrop(screenWidth, screenHeight, 0.98);
      expect(width / height).toBeCloseTo(ASPECT_RATIO, 5);
    }
  });

  it('never exceeds `scale` of either screen dimension', () => {
    const { width, height } = fitBackdrop(390, 844, 0.98);
    expect(width).toBeLessThanOrEqual(390 * 0.98 + 0.001);
    expect(height).toBeLessThanOrEqual(844 * 0.98 + 0.001);
  });

  it('is constrained by whichever axis actually binds for a given screen ratio', () => {
    // A squarer screen than the photo — height should hit the scale limit
    // first, width falls out smaller than scale*screenWidth.
    const square = fitBackdrop(768, 1024, 0.98);
    expect(square.height).toBeCloseTo(1024 * 0.98, 5);
    expect(square.width).toBeLessThan(768 * 0.98);

    // A screen taller/narrower than the photo — width should hit the scale
    // limit first, height falls out smaller than scale*screenHeight.
    const narrow = fitBackdrop(300, 900, 0.98);
    expect(narrow.width).toBeCloseTo(300 * 0.98, 5);
    expect(narrow.height).toBeLessThan(900 * 0.98);
  });
});
