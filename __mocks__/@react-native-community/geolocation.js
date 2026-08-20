/**
 * The real module talks to native GPS hardware, which doesn't exist under
 * Jest — same reasoning as __mocks__/react-native-fs.js. Screens only ever
 * call getCurrentPosition (see getCurrentLocation in
 * src/services/location/currentLocation.ts), so that's the only piece
 * mocked here.
 */
module.exports = {
  getCurrentPosition: jest.fn((success) =>
    success({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: Date.now() }),
  ),
};
