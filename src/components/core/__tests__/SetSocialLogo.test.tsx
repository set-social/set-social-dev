import React from 'react';
import { render } from '@testing-library/react-native';
import { SetSocialLogo, SetSocialIcon } from '../SetSocialLogo';

describe('SetSocialLogo', () => {
  it('renders the real combined mark+wordmark asset for the horizontal (light-on-dark) variant, not code-rendered text', async () => {
    const { getByLabelText, queryByText } = await render(<SetSocialLogo variant="horizontal" />);
    expect(getByLabelText('SetSocial')).toBeTruthy();
    expect(queryByText('Set')).toBeNull();
    expect(queryByText('Social')).toBeNull();
  });

  it('renders the wordmark text for the stacked variant', async () => {
    const { getByText } = await render(<SetSocialLogo variant="stacked" />);
    expect(getByText('Set')).toBeTruthy();
    expect(getByText('Social')).toBeTruthy();
  });

  it('renders text (not the horizontal image asset) for dark-on-light, since no light-surface asset exists', async () => {
    const { getByText } = await render(<SetSocialLogo variant="horizontal" theme="dark-on-light" />);
    expect(getByText('Set')).toBeTruthy();
    expect(getByText('Social')).toBeTruthy();
  });

  it('renders only the mark, no wordmark text, for the icon variant', async () => {
    const { queryByText } = await render(<SetSocialLogo variant="icon" />);
    expect(queryByText('Set')).toBeNull();
    expect(queryByText('Social')).toBeNull();
  });

  it('exposes a single "SetSocial" accessibility label by default, not per-word', async () => {
    const { getByLabelText } = await render(<SetSocialLogo variant="stacked" />);
    expect(getByLabelText('SetSocial')).toBeTruthy();
  });

  it('lets a caller suppress the accessibility label when a nearby element already labels it', async () => {
    const { queryByLabelText } = await render(<SetSocialLogo variant="icon" accessibilityLabel="" />);
    expect(queryByLabelText('SetSocial')).toBeNull();
  });

  it('SetSocialIcon renders without crashing in both themes', async () => {
    const { rerender } = await render(<SetSocialIcon theme="light-on-dark" />);
    await rerender(<SetSocialIcon theme="dark-on-light" />);
  });
});
