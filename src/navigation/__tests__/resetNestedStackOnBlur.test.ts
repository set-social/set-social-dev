import { resetNestedStackOnBlur } from '../MainTabs';

/** A minimal fake of the bottom-tab navigator's own state — enough shape
 * for resetNestedStackOnBlur to operate on (routes with key/state), not a
 * full NavigationState. */
function fakeTabState(routes: Array<{ key: string; name: string; state?: unknown }>) {
  return { index: 0, routes };
}

describe('resetNestedStackOnBlur', () => {
  it('clears only the blurred route\'s nested state, leaving every other tab untouched', () => {
    const state = fakeTabState([
      { key: 'today-1', name: 'TodayTab', state: { index: 2, routes: [{ name: 'Today' }, { name: 'DayDetail' }] } },
      { key: 'programs-1', name: 'ProgramsTab', state: { index: 3, routes: [{ name: 'Calendar' }, { name: 'DayDetail' }, { name: 'Library' }] } },
    ]);

    let dispatchedAction: unknown;
    const navigation = {
      dispatch: (action: (s: typeof state) => unknown) => {
        dispatchedAction = action(state);
      },
    };

    resetNestedStackOnBlur('programs-1', navigation);

    expect(dispatchedAction).toEqual({
      type: 'RESET',
      payload: {
        index: 0,
        routes: [
          { key: 'today-1', name: 'TodayTab', state: { index: 2, routes: [{ name: 'Today' }, { name: 'DayDetail' }] } },
          { key: 'programs-1', name: 'ProgramsTab', state: undefined },
        ],
      },
    });
  });

  it('is a no-op shape-wise when the given key matches nothing (defensive — should never happen in practice)', () => {
    const state = fakeTabState([{ key: 'today-1', name: 'TodayTab', state: { index: 0, routes: [{ name: 'Today' }] } }]);

    let dispatchedAction: unknown;
    const navigation = {
      dispatch: (action: (s: typeof state) => unknown) => {
        dispatchedAction = action(state);
      },
    };

    resetNestedStackOnBlur('nonexistent-key', navigation);

    expect(dispatchedAction).toEqual({
      type: 'RESET',
      payload: state,
    });
  });
});
