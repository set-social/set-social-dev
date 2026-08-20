module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    // The RN resolver honors lucide-react-native's "react-native" export
    // condition, which points at an .mjs build the default RN jest-preset
    // transform (js|ts|tsx only) doesn't cover. Force the CJS build instead.
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  // The RN ecosystem now ships a mix of CJS/ESM across dependencies (Reanimated,
  // date-fns, lucide-react-native, async-storage, image-picker, ...) — rather than
  // hand-maintaining an allowlist of which node_modules packages need transforming,
  // transform everything. Slower, but avoids new deps silently breaking tests.
  transformIgnorePatterns: [],
};
