/**
 * react-native-fs's real module instantiates a NativeEventEmitter at import
 * time, which throws under Jest (no native module registered). Screens only
 * ever call `readFile` here (avatar/post photo uploads), so that's the only
 * piece worth mocking.
 */
module.exports = {
  readFile: jest.fn().mockResolvedValue(''),
};
