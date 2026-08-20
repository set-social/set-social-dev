import { create } from 'zustand';
import type { TrainingGoal, ExperienceLevel, EquipmentType, Sex } from '../types/database';

type OnboardingState = {
  sex: Sex | null;
  heightFeet: number | null;
  heightInches: number | null;
  weightLb: number | null;
  goal: TrainingGoal | null;
  experienceLevel: ExperienceLevel | null;
  daysPerWeek: number | null;
  equipment: EquipmentType[];
  injuriesNotes: string;

  setSex: (sex: Sex) => void;
  setHeightFeet: (feet: number | null) => void;
  setHeightInches: (inches: number | null) => void;
  setWeightLb: (lb: number | null) => void;
  setGoal: (goal: TrainingGoal) => void;
  setExperienceLevel: (level: ExperienceLevel) => void;
  setDaysPerWeek: (days: number) => void;
  toggleEquipment: (item: EquipmentType) => void;
  setInjuriesNotes: (notes: string) => void;
  reset: () => void;
};

const initialState = {
  sex: null,
  heightFeet: null,
  heightInches: null,
  weightLb: null,
  goal: null,
  experienceLevel: null,
  daysPerWeek: null,
  equipment: [],
  injuriesNotes: '',
} satisfies Partial<OnboardingState>;

export const useOnboardingStore = create<OnboardingState>(set => ({
  ...initialState,

  setSex: sex => set({ sex }),
  setHeightFeet: heightFeet => set({ heightFeet }),
  setHeightInches: heightInches => set({ heightInches }),
  setWeightLb: weightLb => set({ weightLb }),
  setGoal: goal => set({ goal }),
  setExperienceLevel: experienceLevel => set({ experienceLevel }),
  setDaysPerWeek: daysPerWeek => set({ daysPerWeek }),
  toggleEquipment: item =>
    set(state => ({
      equipment: state.equipment.includes(item)
        ? state.equipment.filter(e => e !== item)
        : [...state.equipment, item],
    })),
  setInjuriesNotes: injuriesNotes => set({ injuriesNotes }),
  reset: () => set(initialState),
}));
