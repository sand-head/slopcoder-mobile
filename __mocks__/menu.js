// A native menu under jest is just its child; the actions are props a test
// can read off the tree.
const React = require('react');
module.exports = {
  MenuView: ({ children, ...props }) => React.createElement('MenuView', props, children),
};
