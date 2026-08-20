import { useFocusModeStore } from '../focusModeStore';

beforeEach(() => {
  useFocusModeStore.setState({ focusModeEnabled: false });
});

describe('focusModeStore', () => {
  it('defaults to off', () => {
    expect(useFocusModeStore.getState().focusModeEnabled).toBe(false);
  });

  it('flips on and back off via setFocusModeEnabled', () => {
    useFocusModeStore.getState().setFocusModeEnabled(true);
    expect(useFocusModeStore.getState().focusModeEnabled).toBe(true);

    useFocusModeStore.getState().setFocusModeEnabled(false);
    expect(useFocusModeStore.getState().focusModeEnabled).toBe(false);
  });
});
