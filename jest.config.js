module.exports = {
  preset: '@react-native/jest-preset',
  // These ship untransformed ESM. @react-navigation because the deep-link test
  // parses a URL with its real router; @callstack because the kit imports the
  // glass view, so every suite that touches a component pulls it in;
  // react-native-url-polyfill because its own suite proves it does the thing
  // React Native's URL cannot.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-url-polyfill|@lodev09)/)',
  ],
  moduleNameMapper: {
    '^@callstack/liquid-glass$': '<rootDir>/__mocks__/liquid-glass.js',
    // The sheet is a Fabric component; the package ships its own stand-in.
    '^@lodev09/react-native-true-sheet$':
      '<rootDir>/node_modules/@lodev09/react-native-true-sheet/lib/module/mocks/index.js',
    // Native views and modules with nothing to render or fire under jest.
    '^react-native-inappbrowser-reborn$': '<rootDir>/__mocks__/inappbrowser.js',
    '^react-native-haptic-feedback$': '<rootDir>/__mocks__/haptics.js',
    '^@react-native-menu/menu$': '<rootDir>/__mocks__/menu.js',
    '^@bottom-tabs/react-navigation$': '<rootDir>/__mocks__/bottom-tabs.js',
    // Tab icons: Metro would hand back an asset id; a number is enough here.
    '\\.svg$': '<rootDir>/__mocks__/asset.js',
  },
};
