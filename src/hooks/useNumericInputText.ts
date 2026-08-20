import { useEffect, useRef, useState } from 'react';

function defaultFormat(value: number | null): string {
  return value != null ? String(value) : '';
}

function defaultParse(text: string): number | null {
  if (text.trim() === '') return null;
  const parsed = Number(text);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Android-safe controlled binding for a numeric TextField. The naive
 * `value={String(n)}` + `onChangeText={t => setN(parse(t))}` pattern
 * reconstructs the displayed string from the parsed number on every
 * keystroke — on Samsung's keyboard (and some other non-Gboard IMEs) that
 * round-trip can desync from the native EditText's own buffer under fast
 * typing, visibly dropping leading characters (reported: typing "100"
 * rendered as "00") even though the underlying numeric value the app holds
 * is correct. Stock Pixel/Gboard doesn't reproduce it, which is why this
 * can pass on a Pixel and still ship broken for Samsung users.
 *
 * The fix: the displayed text is its own local state, fed directly by
 * keystrokes with no reconstruction in the common case — it's only
 * resynced from `value` when `value` changes for a reason other than this
 * same input's own last edit (an external reset, a prefill, another row's
 * "fill down" onto this one).
 */
export function useNumericInputText(
  value: number | null,
  onChangeValue: (value: number | null) => void,
  options?: {
    format?: (value: number | null) => string;
    parse?: (text: string) => number | null;
    /** Extra trigger to resync `text` from `format(value)` even when
     * `value` itself hasn't changed — e.g. the unit a weight is displayed
     * in (see WorkoutSetRow), when the same underlying kg value needs
     * reformatting after the athlete switches lb/kg mid-workout. Compared
     * by value (===), so pass a primitive (a metric/unit string), not a
     * freshly-constructed object, or this would resync every render. */
    formatKey?: unknown;
  },
) {
  const format = options?.format ?? defaultFormat;
  const parse = options?.parse ?? defaultParse;
  const formatKey = options?.formatKey;

  const [text, setText] = useState(() => format(value));
  // True immediately after this hook's own onChangeText fires, so the
  // effect below can tell "value changed because the athlete just typed
  // into THIS field" apart from "value (or formatKey) changed for some
  // external reason" (a sibling row's Fill Down, a unit switch, a form
  // reset) — only the latter should overwrite what's currently displayed.
  const editedLocallyRef = useRef(false);

  useEffect(() => {
    if (editedLocallyRef.current) {
      editedLocallyRef.current = false;
      return;
    }
    setText(format(value));
    // Deliberately excludes `format`/`parse` — callers may pass a fresh
    // closure every render (e.g. one capturing the current unit), and
    // since those aren't primitives, including them would resync on every
    // render instead of only when `value`/`formatKey` actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, formatKey]);

  const onChangeText = (raw: string) => {
    editedLocallyRef.current = true;
    setText(raw);
    onChangeValue(parse(raw));
  };

  return { text, onChangeText };
}
