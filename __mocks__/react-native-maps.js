/**
 * react-native-maps renders through native MapKit/Google Maps view managers
 * that don't exist under Jest — same reasoning as
 * __mocks__/react-native-reanimated.js. Screens only ever render MapView
 * with a Polyline/Marker children and imperatively call
 * animateToRegion/takeSnapshot on a ref, so that's the only surface mocked
 * here: plain Views standing in for the native components (so a route's
 * Marker/Polyline count is still assertable via testID), plus no-op stubs
 * for the imperative ref methods LiveCardioTrackingScreen/
 * CardioRunSummaryScreen call.
 */
const React = require('react');
const { View } = require('react-native');

const MapView = React.forwardRef((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    animateToRegion: jest.fn(),
    takeSnapshot: jest.fn(() => Promise.resolve('file://mock-map-snapshot.png')),
  }));
  return React.createElement(View, { ...props, testID: props.testID ?? 'map-view' }, props.children);
});

const Marker = props => React.createElement(View, { ...props, testID: props.testID ?? 'map-marker' });
const Polyline = props => React.createElement(View, { ...props, testID: props.testID ?? 'map-polyline' });

module.exports = {
  __esModule: true,
  default: MapView,
  Marker,
  Polyline,
  PROVIDER_GOOGLE: 'google',
  PROVIDER_DEFAULT: 'default',
};
