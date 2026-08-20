import { renderHook, act } from '@testing-library/react-native';
import { useNumericInputText } from '../useNumericInputText';

describe('useNumericInputText', () => {
  it('reflects typed text directly, with no reformat round-trip mid-typing', async () => {
    let value: number | null = null;
    const onChangeValue = (v: number | null) => {
      value = v;
    };
    const { result, rerender } = await renderHook(({ v }: { v: number | null }) => useNumericInputText(v, onChangeValue), {
      initialProps: { v: value },
    });

    await act(() => result.current.onChangeText('1'));
    await rerender({ v: value });
    expect(result.current.text).toBe('1');

    await act(() => result.current.onChangeText('10'));
    await rerender({ v: value });
    expect(result.current.text).toBe('10');

    await act(() => result.current.onChangeText('100'));
    await rerender({ v: value });
    // The exact bug this hook exists to prevent: the displayed text must
    // stay exactly what was typed, never truncated or reconstructed.
    expect(result.current.text).toBe('100');
    expect(value).toBe(100);
  });

  it('does not clobber in-progress text when the component re-renders for an unrelated reason', async () => {
    let value: number | null = null;
    const onChangeValue = (v: number | null) => {
      value = v;
    };
    const { result, rerender } = await renderHook(({ v }: { v: number | null }) => useNumericInputText(v, onChangeValue), {
      initialProps: { v: value },
    });

    await act(() => result.current.onChangeText('42'));
    // Re-render with the SAME external value (as if some unrelated parent
    // state changed) — must not re-run the resync-from-value effect body
    // in a way that alters what's displayed.
    await rerender({ v: value });
    await rerender({ v: value });
    expect(result.current.text).toBe('42');
  });

  it('resyncs from an external value change (e.g. a sibling row "fill down")', async () => {
    const onChangeValue = jest.fn();
    const { result, rerender } = await renderHook(({ v }: { v: number | null }) => useNumericInputText(v, onChangeValue), {
      initialProps: { v: null as number | null },
    });

    expect(result.current.text).toBe('');
    await rerender({ v: 85 });
    expect(result.current.text).toBe('85');
  });

  it('resyncs via formatKey even when the underlying value is unchanged (unit switch)', async () => {
    const onChangeValue = jest.fn();
    const format = (v: number | null, unit: 'kg' | 'lb') => (v == null ? '' : unit === 'kg' ? `${v}kg` : `${Math.round(v * 2.20462)}lb`);

    const { result, rerender } = await renderHook(
      ({ unit }: { unit: 'kg' | 'lb' }) =>
        useNumericInputText(100, onChangeValue, { format: v => format(v, unit), formatKey: unit }),
      { initialProps: { unit: 'kg' } },
    );

    expect(result.current.text).toBe('100kg');
    await rerender({ unit: 'lb' });
    expect(result.current.text).toBe('220lb');
  });

  it('uses a custom parse function and reports null for empty text', async () => {
    const onChangeValue = jest.fn();
    const parse = (t: string) => (t.trim() === '' ? null : parseInt(t, 10) || null);
    const { result } = await renderHook(() => useNumericInputText(null, onChangeValue, { parse }));

    await act(() => result.current.onChangeText(''));
    expect(onChangeValue).toHaveBeenCalledWith(null);

    await act(() => result.current.onChangeText('7'));
    expect(onChangeValue).toHaveBeenCalledWith(7);
  });
});
