module.exports = {
  preset: '@react-native/jest-preset',
  // @react-navigation ships untransformed ESM; the deep-link test parses a URL
  // with its real router rather than reimplementing the match.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation)/)',
  ],
};
