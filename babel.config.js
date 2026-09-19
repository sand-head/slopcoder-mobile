module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Worklets compiles the functions that run on the UI thread, which is where
  // the keyboard's position is read and the composer is moved. Reanimated
  // ships it as its own package now, and its plugin must stay last.
  plugins: ['react-native-worklets/plugin'],
};
