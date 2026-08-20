import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { GenerateProgramScreen } from '../GenerateProgramScreen';

const mockReplace = jest.fn();
let mockRouteParams: { daysPerWeek: number; weeksCount: number; focusNotes?: string; emphasisMuscleGroups?: string[] };

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ replace: mockReplace, canGoBack: () => true }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

const mockGenerateProgram = jest.fn();

jest.mock('../../../services/api/edgeFunctions', () => ({
  generateProgram: (...args: unknown[]) => mockGenerateProgram(...args),
}));

const PROFILE = {
  goal: 'strength',
  experience_level: 'intermediate',
  days_per_week: 4,
  equipment_access: ['barbell'],
  injuries_notes: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProfile.mockReturnValue({ data: PROFILE });
  mockRouteParams = { daysPerWeek: 4, weeksCount: 6 };
});

describe('GenerateProgramScreen', () => {
  it('generates using the days/weeks answered in the Ask Arnold sheet (not the profile) and navigates to the new program', async () => {
    mockGenerateProgram.mockResolvedValue({ program_id: 'program-1' });

    await render(<GenerateProgramScreen />);

    await waitFor(() =>
      expect(mockGenerateProgram).toHaveBeenCalledWith({
        goal: 'strength',
        experience_level: 'intermediate',
        days_per_week: 4,
        weeks_count: 6,
        equipment: ['barbell'],
        injuries_notes: '',
        focus_notes: '',
        emphasis_muscle_groups: [],
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('ProgramDetail', { programId: 'program-1' }));
  });

  it('forwards the focus notes and muscle groups captured by the Ask Arnold sheet, and shows a recap while building', async () => {
    mockRouteParams = {
      daysPerWeek: 5,
      weeksCount: 8,
      focusNotes: 'Get stronger for climbing season',
      emphasisMuscleGroups: ['chest', 'shoulders'],
    };
    mockGenerateProgram.mockResolvedValue({ program_id: 'program-1' });

    const { getByText } = await render(<GenerateProgramScreen />);

    expect(getByText(/5-day\/week, 8-week block/)).toBeTruthy();
    expect(getByText('Focusing on Chest, Shoulders')).toBeTruthy();
    await waitFor(() =>
      expect(mockGenerateProgram).toHaveBeenCalledWith({
        goal: 'strength',
        experience_level: 'intermediate',
        days_per_week: 5,
        weeks_count: 8,
        equipment: ['barbell'],
        injuries_notes: '',
        focus_notes: 'Get stronger for climbing season',
        emphasis_muscle_groups: ['chest', 'shoulders'],
      }),
    );
  });

  it('shows an error with a retry button when generation fails', async () => {
    mockGenerateProgram.mockRejectedValue(new Error('You already have an active program.'));

    const { getByText } = await render(<GenerateProgramScreen />);

    await waitFor(() => expect(getByText('You already have an active program.')).toBeTruthy());
    expect(getByText('Try Again')).toBeTruthy();
  });

  it('shows a guard error when required profile fields are missing, without calling generateProgram', async () => {
    mockUseProfile.mockReturnValue({ data: { ...PROFILE, goal: null } });

    const { getByText } = await render(<GenerateProgramScreen />);

    await waitFor(() => expect(getByText(/set your goal and experience level/i)).toBeTruthy());
    expect(mockGenerateProgram).not.toHaveBeenCalled();
  });
});
