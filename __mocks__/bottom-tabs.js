// Stands in for `@react-navigation/bottom-tabs/unstable`. Under jest the tab
// bar is the JS navigator's shape with nothing native underneath: a navigator
// whose only job is to render the focused route.
const React = require('react');
const { createNavigatorFactory, TabRouter, useNavigationBuilder } = require('@react-navigation/native');

function NativeBottomTabNavigator({ initialRouteName, children, screenOptions, ...rest }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    initialRouteName,
    children,
    screenOptions,
  });
  void rest;
  return React.createElement(NavigationContent, null, descriptors[state.routes[state.index].key].render());
}

module.exports = {
  createNativeBottomTabNavigator: createNavigatorFactory(NativeBottomTabNavigator),
};
