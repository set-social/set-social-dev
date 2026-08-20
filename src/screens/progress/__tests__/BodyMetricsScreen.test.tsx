import React from 'react';
import { act } from 'react-test-renderer';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { BodyMetricsScreen } from '../BodyMetricsScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ canGoBack: () => false }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
const mockUpdateProfileMutate = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
  useUpdateProfile: jest.fn(() => ({ mutate: mockUpdateProfileMutate, isPending: false })),
}));

const mockUseBodyMetrics = jest.fn();
const mockLogMetricMutateAsync = jest.fn();
jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useBodyMetrics: (...args: unknown[]) => mockUseBodyMetrics(...args),
  useLogBodyMetric: jest.fn(() => ({ mutateAsync: mockLogMetricMutateAsync, isPending: false })),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'lb',
}));

// Same capture-the-real-onChange convention as SignUpScreen.test.tsx — the
// real DateTimePicker is a native component; this stands in for it so a
// test can report an arbitrary picked date, then confirm it via the
// screen's own "Confirm" button, the same two-step flow the real picker
// drives.
let mockDatePickerOnChange: ((event: unknown, date?: Date) => void) | null = null;
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: { onChange: (event: unknown, date?: Date) => void }) => {
    mockDatePickerOnChange = props.onChange;
    return null;
  },
}));

function profileFixture(overrides: Partial<{ sex: string | null; height_cm: number | null; birth_date: string | null }> = {}) {
  return {
    data: {
      sex: 'female',
      height_cm: 167.6, // 5'6"
      birth_date: '1996-04-12',
      ...overrides,
    },
    isLoading: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProfile.mockReturnValue(profileFixture());
  mockUseBodyMetrics.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
  mockDatePickerOnChange = null;
});

async function pickBirthDate(
  getByPlaceholderText: Awaited<ReturnType<typeof render>>['getByPlaceholderText'],
  getByText: Awaited<ReturnType<typeof render>>['getByText'],
  date: Date,
) {
  await fireEvent.press(getByPlaceholderText('Select your birth date'));
  await waitFor(() => expect(mockDatePickerOnChange).not.toBeNull());
  await act(async () => {
    mockDatePickerOnChange?.({}, date);
  });
  await fireEvent.press(getByText('Confirm'));
}

describe('BodyMetricsScreen', () => {
  it('shows the current weight tile from the latest logged entry', async () => {
    mockUseBodyMetrics.mockReturnValue({
      data: [{ id: 'm1', logged_at: '2024-06-01', weight_kg: 79.4, notes: null }],
      isLoading: false,
      refetch: jest.fn(),
    });
    const { getByText } = await render(<BodyMetricsScreen />);
    expect(getByText('CURRENT WEIGHT')).toBeTruthy();
  });

  it('pre-fills height and birth date from the profile', async () => {
    const { getByPlaceholderText, getByDisplayValue } = await render(<BodyMetricsScreen />);

    expect(getByPlaceholderText('5').props.value).toBe('5');
    expect(getByPlaceholderText('10').props.value).toBe('6');
    expect(getByDisplayValue('April 12, 1996')).toBeTruthy();
  });

  it('keeps Save a no-op until a field is actually touched', async () => {
    const { getByText } = await render(<BodyMetricsScreen />);
    await fireEvent.press(getByText('Save'));
    expect(mockUpdateProfileMutate).not.toHaveBeenCalled();
  });

  it('saves only the changed field when sex is switched', async () => {
    const { getByText } = await render(<BodyMetricsScreen />);
    await fireEvent.press(getByText('Male'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ sex: 'male' }, expect.anything());
  });

  it('saves a converted height in cm when feet/inches are edited', async () => {
    const { getByText, getByPlaceholderText } = await render(<BodyMetricsScreen />);
    await fireEvent.changeText(getByPlaceholderText('5'), '6');
    await fireEvent.changeText(getByPlaceholderText('10'), '0');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ height_cm: 182.9 }, expect.anything());
  });

  it('saves the picked birth date as a plain yyyy-MM-dd string', async () => {
    const { getByText, getByPlaceholderText, getByDisplayValue } = await render(<BodyMetricsScreen />);
    const newBirthDate = new Date(2000, 0, 15);
    await pickBirthDate(getByPlaceholderText, getByText, newBirthDate);

    expect(getByDisplayValue('January 15, 2000')).toBeTruthy();
    await fireEvent.press(getByText('Save'));
    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ birth_date: '2000-01-15' }, expect.anything());
  });

  it('rejects a birth date under the minimum age without saving', async () => {
    const { getByText, getByPlaceholderText } = await render(<BodyMetricsScreen />);
    const under13 = new Date();
    under13.setFullYear(under13.getFullYear() - 10);
    await pickBirthDate(getByPlaceholderText, getByText, under13);

    await fireEvent.press(getByText('Save'));

    expect(getByText('You must be at least 13 years old.')).toBeTruthy();
    expect(mockUpdateProfileMutate).not.toHaveBeenCalled();
  });

  it('resets the local override back to deferring to the profile once the save succeeds', async () => {
    mockUpdateProfileMutate.mockImplementation((_updates, { onSuccess }) => onSuccess());
    const { getByText } = await render(<BodyMetricsScreen />);
    await fireEvent.press(getByText('Male'));
    await fireEvent.press(getByText('Save'));
    expect(mockUpdateProfileMutate).toHaveBeenCalledTimes(1);

    // Pressing Save again with no further edits is a no-op if (and only if)
    // the local "touched" override was actually cleared back to null after
    // the successful save, rather than staying pointed at 'male' forever.
    await fireEvent.press(getByText('Save'));
    expect(mockUpdateProfileMutate).toHaveBeenCalledTimes(1);
  });

  it('still logs a new weight entry the same way as before', async () => {
    mockLogMetricMutateAsync.mockResolvedValue({});
    const { getByText, getByPlaceholderText } = await render(<BodyMetricsScreen />);
    await fireEvent.changeText(getByPlaceholderText('72.5'), '180');
    await fireEvent.press(getByText('Log Weight'));

    await waitFor(() => expect(mockLogMetricMutateAsync).toHaveBeenCalled());
  });
});
