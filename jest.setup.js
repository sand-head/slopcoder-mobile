/* eslint-env jest */
/**
 * The keyboard tracker is a native view with a display link behind it, so
 * importing the package with no native module under it throws before a single
 * test runs. The package ships its own stand-in, in which `KeyboardStickyView`
 * is a plain `View` — a screen that hangs its composer on the keyboard still
 * mounts and lays out here, it simply never moves.
 */
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);
