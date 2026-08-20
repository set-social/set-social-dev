import type { UnitPreference } from '../types/database';

/** Exact international avoirdupois pound. */
const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/**
 * Display-only rounding — never applied to what's persisted. kg rounds to
 * 1 decimal; lb rounds to the nearest 0.5, the typical plate/dumbbell
 * increment.
 */
export function roundForDisplay(value: number, pref: UnitPreference): number {
  return pref === 'kg' ? Math.round(value * 10) / 10 : Math.round(value * 2) / 2;
}

/** Smallest weight change a lifter can actually load on a barbell — gym
 * plates come in fixed pairs, not arbitrary fractions. 5 lb (a 2.5 lb plate
 * per side) is the standard minimum jump for lb gyms; 2.5 kg is the
 * equivalent kg-gym convention. */
export const PLATE_INCREMENT_LB = 5;
export const PLATE_INCREMENT_KG = 2.5;

function plateIncrementKg(pref: UnitPreference): number {
  return pref === 'kg' ? PLATE_INCREMENT_KG : lbToKg(PLATE_INCREMENT_LB);
}

/**
 * Rounds a raw weight *change* (e.g. "2.5% of last set's load", not an
 * absolute load) to the nearest realistic plate increment, with a floor of
 * one full increment — a computed delta smaller than one increment (common
 * for small percentage bumps on lighter loads) still recommends a real,
 * loadable change instead of rounding down to "no change".
 */
export function roundDeltaToPlateIncrement(deltaKg: number, pref: UnitPreference): number {
  const increment = plateIncrementKg(pref);
  return Math.max(increment, Math.round(deltaKg / increment) * increment);
}

/** Canonical kg storage -> a display string in the given preference. */
export function formatWeight(kg: number | null | undefined, pref: UnitPreference): string {
  if (kg == null) return '';
  const converted = pref === 'kg' ? kg : kgToLb(kg);
  return String(roundForDisplay(converted, pref));
}

/**
 * User-typed text in the given preference -> kg for storage. Returns null on
 * invalid/empty input. Full precision — only the numeric(6,2) column itself
 * rounds on write, same as today.
 */
export function parseWeightInput(value: string, pref: UnitPreference): number | null {
  if (value.trim() === '') return null;
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return null;
  return pref === 'kg' ? parsed : lbToKg(parsed);
}

export function unitLabel(pref: UnitPreference): string {
  return pref === 'kg' ? 'kg' : 'lb';
}

/** Large aggregate values (e.g. total volume) — whole number with thousands separators. */
export function formatVolume(kg: number, pref: UnitPreference): string {
  const converted = pref === 'kg' ? kg : kgToLb(kg);
  return Math.round(converted).toLocaleString();
}

export function celsiusToFahrenheit(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

/** Canonical Celsius storage -> a display string in the given preference —
 * reuses the weight preference ('kg' = metric-leaning, 'lb' = imperial-
 * leaning) rather than introducing a separate temperature-unit setting for
 * one secondary Whoop metric. */
export function formatSkinTemp(celsius: number | null | undefined, pref: UnitPreference): string {
  if (celsius == null) return '—';
  return pref === 'kg'
    ? `${celsius.toFixed(1)}°C`
    : `${celsiusToFahrenheit(celsius).toFixed(1)}°F`;
}

const CM_PER_INCH = 2.54;

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

/** Canonical cm storage -> whole feet/inches for display (onboarding, profile). */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}
