import { renderHook, act } from '@testing-library/react-native';
import { useCompleteOnboarding } from '../useCompleteOnboarding';
import { useOnboardingStore } from '../../../store/onboardingStore';

const mockSetSession = jest.fn();

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null; setSession: (...args: unknown[]) => void }) => unknown) =>
    selector({ userId: 'user-1', setSession: mockSetSession }),
}));

const mockUpdateProfileMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useUpdateProfile: jest.fn(() => ({ mutateAsync: mockUpdateProfileMutateAsync, isPending: false })),
}));

const mockLogBodyMetricMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useLogBodyMetric: jest.fn(() => ({ mutateAsync: mockLogBodyMetricMutateAsync, isPending: false })),
}));

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

describe('useCompleteOnboarding', () => {
  it('saves the profile, logs starting weight, and flips onboarding_completed', async () => {
    mockUpdateProfileMutateAsync.mockResolvedValue(undefined);
    mockLogBodyMetricMutateAsync.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useCompleteOnboarding());
    await act(async () => {
      await result.current.complete();
    });

    expect(mockUpdateProfileMutateAsync).toHaveBeenCalledWith({
      goal: 'strength',
      experience_level: 'intermediate',
      days_per_week: 4,
      equipment_access: ['barbell', 'dumbbell'],
      injuries_notes: null,
      sex: 'female',
      height_cm: 167.6,
      onboarding_completed: true,
    });
    expect(mockLogBodyMetricMutateAsync).toHaveBeenCalledWith({ weightKg: expect.closeTo(63.5, 1) });
    expect(mockSetSession).toHaveBeenCalledWith({ userId: 'user-1', onboardingCompleted: true });
  });

  it('sets an inline error and does not save when answers are missing', async () => {
    useOnboardingStore.setState({ daysPerWeek: null });

    const { result } = await renderHook(() => useCompleteOnboarding());
    await act(async () => {
      await result.current.complete();
    });

    expect(result.current.error).toMatch(/please go back and complete every step/i);
    expect(mockUpdateProfileMutateAsync).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});
