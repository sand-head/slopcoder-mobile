/**
 * The glass view is a native component; `TurboModuleRegistry.getEnforcing`
 * throws the moment it is imported in a Node test.
 *
 * Reporting `isLiquidGlassSupported: false` is not a cop-out — that is what
 * Android and every iOS below 26 report, and our deployment target is 16. The
 * fallback is the common path, so it is the right one for tests to walk.
 */
const React = require('react');
const { View } = require('react-native');

module.exports = {
  isLiquidGlassSupported: false,
  LiquidGlassView: View,
  LiquidGlassContainerView: View,
};
