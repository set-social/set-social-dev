/**
 * The real module is a Nitro/TurboModule bridge to native HealthKit, which
 * doesn't exist under Jest — same reasoning as react-native-fs.js and
 * @react-native-community/geolocation.js in this same directory. Every
 * screen/query-layer test that touches src/services/api/queries/
 * appleHealth.ts mocks that file directly instead of relying on this stub
 * doing anything meaningful; this exists only so importing the real
 * package (transitively, via IntegrationsScreen -> appleHealth.ts) doesn't
 * crash the whole test file trying to load native Nitro bindings.
 */
const CategoryValueSleepAnalysis = {
  inBed: 0,
  asleepUnspecified: 1,
  asleep: 1,
  awake: 2,
  asleepCore: 3,
  asleepDeep: 4,
  asleepREM: 5,
};

const HealthKit = {
  isHealthDataAvailable: jest.fn(() => false),
  isHealthDataAvailableAsync: jest.fn(async () => false),
  requestAuthorization: jest.fn(async () => false),
  getMostRecentQuantitySample: jest.fn(async () => undefined),
  queryCategorySamples: jest.fn(async () => []),
  queryQuantitySamples: jest.fn(async () => []),
  queryStatisticsForQuantity: jest.fn(async () => ({})),
};

module.exports = {
  __esModule: true,
  default: HealthKit,
  CategoryValueSleepAnalysis,
};
