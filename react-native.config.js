/**
 * `npx react-native-asset` reads this to copy the fonts into
 * `android/app/src/main/assets/fonts/` and register them in the Xcode project
 * and Info.plist. Re-run it after adding a font.
 */
module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./assets/fonts'],
};
