import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PostFab } from '../PostFab';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const mockLaunchCamera = jest.fn();
const mockLaunchImageLibrary = jest.fn();

jest.mock('react-native-image-picker', () => ({
  launchCamera: (...args: unknown[]) => mockLaunchCamera(...args),
  launchImageLibrary: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PostFab', () => {
  it('opens the New Post sheet with Take Photo and Choose from Library options', async () => {
    const { getByLabelText, getByText } = await render(<PostFab />);

    await fireEvent.press(getByLabelText('New post'));

    expect(getByText('Take Photo')).toBeTruthy();
    expect(getByText('Choose from Library')).toBeTruthy();
  });

  it('captures a photo and navigates to UploadPhotoPost with it pre-attached', async () => {
    mockLaunchCamera.mockResolvedValue({
      didCancel: false,
      assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg' }],
    });

    const { getByLabelText, getByText } = await render(<PostFab />);
    await fireEvent.press(getByLabelText('New post'));
    await fireEvent.press(getByText('Take Photo'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'CommunityTab',
        params: {
          screen: 'UploadPhotoPost',
          params: { mode: 'progress', initialPhoto: { uri: 'file://photo.jpg', contentType: 'image/jpeg' } },
        },
      }),
    );
  });

  it('picks a photo from the library and navigates with it pre-attached', async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      didCancel: false,
      assets: [{ uri: 'file://library.jpg', type: 'image/png' }],
    });

    const { getByLabelText, getByText } = await render(<PostFab />);
    await fireEvent.press(getByLabelText('New post'));
    await fireEvent.press(getByText('Choose from Library'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'CommunityTab',
        params: {
          screen: 'UploadPhotoPost',
          params: { mode: 'progress', initialPhoto: { uri: 'file://library.jpg', contentType: 'image/png' } },
        },
      }),
    );
  });

  it('does nothing when the camera is cancelled', async () => {
    mockLaunchCamera.mockResolvedValue({ didCancel: true });

    const { getByLabelText, getByText } = await render(<PostFab />);
    await fireEvent.press(getByLabelText('New post'));
    await fireEvent.press(getByText('Take Photo'));

    await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows an alert if the camera errors', async () => {
    mockLaunchCamera.mockResolvedValue({ didCancel: false, errorCode: 'camera_unavailable', errorMessage: 'No camera' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByLabelText, getByText } = await render(<PostFab />);
    await fireEvent.press(getByLabelText('New post'));
    await fireEvent.press(getByText('Take Photo'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not open camera', 'No camera'));
    expect(mockNavigate).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
