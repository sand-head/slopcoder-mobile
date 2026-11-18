const { fixupConfigRules } = require('@eslint/compat');
const comments = require('@eslint-community/eslint-plugin-eslint-comments');
const espree = require('espree');
const reactNative = fixupConfigRules(
  require('@react-native/eslint-config/flat').map(config => {
    const withComments = config.plugins?.['eslint-comments']
      ? {
          ...config,
          plugins: { ...config.plugins, 'eslint-comments': comments },
        }
      : config;
    // The app's JavaScript is plain config/mock code, not Flow. RN's Babel 7
    // ESLint parser supplies an obsolete scope manager under ESLint 10.
    return config.files?.includes('**/*.js') && config.languageOptions?.parser
      ? { ...withComments, languageOptions: { ...withComments.languageOptions, parser: espree } }
      : withComments;
  }),
);

module.exports = [
  ...reactNative,
  {
    files: ['jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
  {
    rules: {
      // Colours come from useTheme(), so nearly every style depends on render-time
      // values and cannot live in a module-level StyleSheet. Extracting the static
      // halves would split each component's styling across two places for no gain.
      'react-native/no-inline-styles': 'off',
      // `void somePromise` is how this codebase says "deliberately not awaited" —
      // a fire-and-forget presence ping or refresh. Flagging it hides the cases
      // where a missing await is actually a bug.
      'no-void': 'off',
    },
  },
];
