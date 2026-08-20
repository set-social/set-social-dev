import React from 'react';
import { Image } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AvatarPositionScreen } from '../AvatarPositionScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { pickedUri?: string; contentType?: string } | undefined;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
const mockUploadAvatarMutateAsync = jest.fn();
const mockUpdateProfileMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
  useUploadAvatar: jest.fn(() => ({ mutateAsync: mockUploadAvatarMutateAsync })),
  useUpdateProfile: jest.fn(() => ({ mutateAsync: mockUpdateProfileMutateAsync })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;
  mockUseProfile.mockReturnValue({
    data: { avatar_url: 'https://example.com/existing.jpg', avatar_focal_x: 0.5, avatar_focal_y: 0.5 },
  });
});

describe('AvatarPositionScreen', () => {
  it('disables Save until the photo has been measured', async () => {
    // Never resolves in this test — Save should stay disabled the whole time.
    jest.spyOn(Image, 'getSize').mockImplementation(() => {});

    const { getByText } = await render(<AvatarPositionScreen />);
    await fireEvent.press(getByText('Save'));

    expect(mockUpdateProfileMutateAsync).not.toHaveBeenCalled();
    expect(mockUploadAvatarMutateAsync).not.toHaveBeenCalled();
  });

  it('repositions the existing photo (no upload) and returns once the photo is measured and Save is pressed untouched', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => success(400, 200));

    const { getByText } = await render(<AvatarPositionScreen />);
    await waitFor(() => expect(getByText('Save').parent).toBeTruthy());
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockUpdateProfileMutateAsync).toHaveBeenCalled());
    // Untouched — the saved focal point should round-trip back to the same
    // (0.5, 0.5) the photo already had, not drift just from measuring it.
    expect(mockUpdateProfileMutateAsync).toHaveBeenCalledWith({ avatar_focal_x: 0.5, avatar_focal_y: 0.5 });
    expect(mockUploadAvatarMutateAsync).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('uploads a freshly picked photo before saving its (centered, untouched) focal point', async () => {
    mockRouteParams = { pickedUri: 'file:///tmp/new.jpg', contentType: 'image/jpeg' };
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => success(400, 200));

    const { getByText } = await render(<AvatarPositionScreen />);
    await waitFor(() => expect(getByText('Save').parent).toBeTruthy());
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockUploadAvatarMutateAsync).toHaveBeenCalledWith({ uri: 'file:///tmp/new.jpg', contentType: 'image/jpeg' }));
    expect(mockUpdateProfileMutateAsync).toHaveBeenCalledWith({ avatar_focal_x: 0.5, avatar_focal_y: 0.5 });
    expect(mockGoBack).toHaveBeenCalled();
  });
});
