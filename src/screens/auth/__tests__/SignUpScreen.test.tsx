import React from 'react';
import { act } from 'react-test-renderer';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SignUpScreen } from '../SignUpScreen';

type GetByPlaceholderText = Awaited<ReturnType<typeof render>>['getByPlaceholderText'];

const mockNavigate = jest.fn();
const mockSignUp = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ canGoBack: () => false }) };
});

jest.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ loading: false, signUp: mockSignUp }),
}));

const mockRpc = jest.fn();
const mockEq = jest.fn();
const mockUpdate = jest.fn((..._args: unknown[]) => ({ eq: mockEq }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ update: mockUpdate }));

// Wrapped rather than assigned directly (`rpc: mockRpc`) — jest's hoisting of
// this factory above the mock* const declarations above means a direct
// reference would capture them before they're assigned (reads as undefined
// at runtime, TS can't catch it). Wrapping defers the read to actual call
// time, once the module has fully initialized — same pattern this repo's
// other test files use for hook mocks (e.g. ActiveExerciseScreen.test.tsx's
// `useLogSet: jest.fn(() => ({ mutateAsync: mockLogSetMutateAsync }))`).
jest.mock('../../../services/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// Captures the real component's onChange so tests can report an arbitrary
// picked date, then confirm it via the screen's own "Confirm" button — the
// same two-step flow (pick, then confirm) the real DateTimePicker drives.
let mockDatePickerOnChange: ((event: unknown, date?: Date) => void) | null = null;

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: { onChange: (event: unknown, date?: Date) => void }) => {
    mockDatePickerOnChange = props.onChange;
    return null;
  },
}));

const navigation = { navigate: mockNavigate } as never;

function adultBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 25);
  return d;
}

function under13BirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  return d;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: false, error: null });
  mockEq.mockResolvedValue({ error: null });
  mockDatePickerOnChange = null;
});

async function fillForm(
  getByPlaceholderText: GetByPlaceholderText,
  {
    fullName = 'Jamie Smith',
    handle = 'jsmith',
    email = 'new@example.com',
    password = 'password1',
    confirmPassword = 'password1',
  }: {
    fullName?: string;
    handle?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  } = {},
) {
  await fireEvent.changeText(getByPlaceholderText('Your name'), fullName);
  await fireEvent.changeText(getByPlaceholderText('e.g. jsmith92'), handle);
  await fireEvent.changeText(getByPlaceholderText('you@example.com'), email);
  await fireEvent.changeText(getByPlaceholderText('At least 6 characters'), password);
  await fireEvent.changeText(getByPlaceholderText('••••••••'), confirmPassword);
}

async function pickBirthDate(
  getByPlaceholderText: GetByPlaceholderText,
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

describe('SignUpScreen', () => {
  it('keeps Create Account disabled (a press has no effect) until every required field is filled', async () => {
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText, { fullName: '' });
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('rejects an invalid handle format', async () => {
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText, { handle: 'ab' }); // too short once normalized
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    expect(getByText('Choose a handle: 3-20 characters, letters, numbers, or underscore.')).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('rejects a birth date under the minimum age', async () => {
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText);
    await pickBirthDate(getByPlaceholderText, getByText, under13BirthDate());

    await fireEvent.press(getByText('Create Account'));

    expect(getByText('You must be at least 13 years old to use SetSocial.')).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a too-short password without calling signUp', async () => {
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText, { password: 'abc', confirmPassword: 'abc' });
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    expect(getByText('Password must be at least 6 characters.')).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords without calling signUp', async () => {
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText, { password: 'password1', confirmPassword: 'password2' });
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    expect(getByText('Passwords do not match.')).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('rejects an already-taken handle before ever calling signUp', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText);
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    await waitFor(() => expect(getByText('That handle is already taken.')).toBeTruthy());
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('surfaces an error instead of spinning forever if the handle check throws unexpectedly', async () => {
    // Regression test: supabase.rpc was previously extracted as a standalone
    // reference before calling it, dropping its `this` binding and throwing
    // a TypeError at runtime — invisible to the mock here (a plain arrow
    // function, `this`-agnostic) but very real against the actual
    // supabase-js client. Simulating any throw from the handle check is
    // what verifies the fix: onSubmit must not leave checkingHandle (and so
    // the Create Account button) stuck loading forever.
    mockRpc.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'headers')"));
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText);
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    await waitFor(() => expect(getByText("Cannot read properties of undefined (reading 'headers')")).toBeTruthy());
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('signs up and saves name/handle/birth date once everything checks out', async () => {
    mockSignUp.mockResolvedValue({ error: null, hasSession: true, userId: 'user-1' });
    const { getByText, queryByText, getByPlaceholderText } = await render(
      <SignUpScreen navigation={navigation} route={{} as never} />,
    );
    await fillForm(getByPlaceholderText, { fullName: 'Jamie Smith', handle: 'JSmith_92' });
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('is_handle_taken', { p_handle: 'jsmith_92' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith('new@example.com', 'password1'));
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('profiles'));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Jamie Smith', handle: 'jsmith_92' }),
    );
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
    expect(queryByText(/check your email/i)).toBeNull();
    // Still on the sign-up form — AuthProvider (outside this screen) is what
    // actually swaps the navigator over once the session lands.
    expect(getByText('Create your account')).toBeTruthy();
  });

  it('surfaces a diagnostic message instead of saving a profile when no session comes back', async () => {
    mockSignUp.mockResolvedValue({ error: null, hasSession: false, userId: null });
    const { getByText, getByPlaceholderText } = await render(
      <SignUpScreen navigation={navigation} route={{} as never} />,
    );
    await fillForm(getByPlaceholderText);
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    await waitFor(() => expect(getByText(/email confirmation needs to be disabled/i)).toBeTruthy());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('shows the error returned by signUp', async () => {
    mockSignUp.mockResolvedValue({ error: 'Email already registered', hasSession: false, userId: null });
    const { getByText, getByPlaceholderText } = await render(<SignUpScreen navigation={navigation} route={{} as never} />);
    await fillForm(getByPlaceholderText);
    await pickBirthDate(getByPlaceholderText, getByText, adultBirthDate());

    await fireEvent.press(getByText('Create Account'));

    await waitFor(() => expect(getByText('Email already registered')).toBeTruthy());
  });
});
