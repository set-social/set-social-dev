import { feetInchesToCm, cmToFeetInches, roundDeltaToPlateIncrement, lbToKg, kgToLb } from '../units';

describe('feetInchesToCm / cmToFeetInches', () => {
  it('converts feet+inches to cm', () => {
    expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8, 1);
    expect(feetInchesToCm(6, 0)).toBeCloseTo(182.88, 1);
  });

  it('round-trips back to the original feet/inches', () => {
    expect(cmToFeetInches(feetInchesToCm(5, 10))).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(feetInchesToCm(6, 0))).toEqual({ feet: 6, inches: 0 });
  });

  it('rolls 11.5+ inches over into the next foot instead of reporting 12 inches', () => {
    expect(cmToFeetInches(feetInchesToCm(5, 11.6))).toEqual({ feet: 6, inches: 0 });
  });
});

describe('roundDeltaToPlateIncrement', () => {
  it('rounds a kg delta to the nearest 2.5kg, flooring up to one full increment', () => {
    expect(roundDeltaToPlateIncrement(1.5, 'kg')).toBe(2.5);
    expect(roundDeltaToPlateIncrement(6, 'kg')).toBe(5);
    expect(roundDeltaToPlateIncrement(0, 'kg')).toBe(2.5);
  });

  it('rounds an lb delta to the nearest real 5lb plate increment, never a fractional pound', () => {
    // 1.625lb (2.5% of 65lb) can't be loaded on any bar — it must floor up to a full 5lb jump.
    expect(Math.round(kgToLb(roundDeltaToPlateIncrement(lbToKg(1.625), 'lb')))).toBe(5);
    // A bigger raw delta (6.5lb, 10% of 65lb) still rounds to the nearest 5lb multiple.
    expect(Math.round(kgToLb(roundDeltaToPlateIncrement(lbToKg(6.5), 'lb')))).toBe(5);
    // A large enough delta rounds up to more than one increment.
    expect(Math.round(kgToLb(roundDeltaToPlateIncrement(lbToKg(8), 'lb')))).toBe(10);
  });
});
