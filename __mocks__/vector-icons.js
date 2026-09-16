// The copy glyph on a fence's header, which is a font the markdown display
// pulls in. Under jest there is no font to load and nothing to draw, but the
// button around it is what the copy tests look for, so it has to render.
const React = require('react');
const { Text } = require('react-native');

const Icon = ({ name, ...rest }) => React.createElement(Text, rest, name ?? '');

module.exports = {
  __esModule: true,
  default: Icon,
  MaterialDesignIcons: Icon,
};
