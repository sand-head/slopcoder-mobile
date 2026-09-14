// The in-app browser is native; under jest nothing opens, and `isAvailable`
// answering false is what makes `openInApp` fall through to Linking.
module.exports = {
  InAppBrowser: { isAvailable: async () => false, open: async () => ({ type: 'dismiss' }), close: () => {} },
};
