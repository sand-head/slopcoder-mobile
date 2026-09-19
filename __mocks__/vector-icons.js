// An icon font nothing in this app draws. The markdown display's barrel export
// pulls in its editor half, which imports these icons, so the module has to
// resolve under jest even though the only place it reached the screen — the
// copy button on a fence — is patched to say the word instead (the font is a
// transitive dependency, never autolinked, and never in the app bundle).
const React = require('react');
const { Text } = require('react-native');

const Icon = ({ name, ...rest }) => React.createElement(Text, rest, name ?? '');

module.exports = {
  __esModule: true,
  default: Icon,
  MaterialDesignIcons: Icon,
};
