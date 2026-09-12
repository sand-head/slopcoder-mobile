module.exports = {
  root: true,
  extends: '@react-native',
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
};
