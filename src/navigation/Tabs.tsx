/**
 * The rail, as a phone has one: a tab bar.
 *
 * The cockpit keeps a 56px icon rail down the left of every page. The first
 * cut of this app mirrored it as a drawer behind a hamburger, which is a
 * website's idea of a phone: the drawer had no edge to swipe from, the root
 * pages stacked on top of each other as it switched between them, and a screen
 * with a menu button could still be swiped "back" to a sibling. Four places to
 * switch between is a tab bar on both platforms — `UITabBarController` on iOS,
 * which iOS 26 draws in glass, and Material's navigation bar on Android.
 *
 * This is React Navigation's own native tabs, which run a real
 * `UITabBarController` through `react-native-screens`. It was
 * `react-native-bottom-tabs`, which hands each tab's subtree to a SwiftUI
 * `TabView` instead. Worth knowing why that changed, because the stated reason
 * was wrong: the tab bar was blamed for the large title never collapsing, and
 * swapping it did not fix that — the fault was a view wrapped around each
 * page's scroll view, and it lived in the screens (see {@link rootPageOptions}).
 * The move still earns its keep — a real tab bar controller, one fewer pod, and
 * the build patch that pod needed is gone — but it was not the cure it was sold
 * as, and nothing here should be read as load-bearing for the header.
 *
 * Each tab is a stack of one so the page owns a real navigation bar: the large
 * title that collapses, the search field, the trailing button. Screens that are
 * *entered* — a session, a routine — are pushed on the root stack in
 * `App.tsx`, over the tab bar, because a composer wants the bottom edge to
 * itself.
 *
 * The one thing the rail had that a bar must keep: Routines carried a red pip
 * when a run failed, so "something broke overnight" reached you on whatever
 * page you were on. That is the tab's badge.
 */
import React from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';
import {
  createNativeBottomTabNavigator,
  type NativeBottomTabIcon,
} from '@react-navigation/bottom-tabs/unstable';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SessionsScreen } from '../screens/Sessions';
import { RoutinesScreen } from '../screens/Routines';
import { UsageScreen } from '../screens/Usage';
import { SettingsScreen } from '../screens/Settings';
import { useRoutineAlert } from '../state/routines';
import { useTheme } from '../theme';
import { rootPageOptions, stackOptions } from './headers';

const Tab = createNativeBottomTabNavigator();
const SessionsStack = createNativeStackNavigator();
const RoutinesStack = createNativeStackNavigator();
const UsageStack = createNativeStackNavigator();
const SettingsStack = createNativeStackNavigator();

/**
 * SF Symbols on iOS, where the bar expects them and we name the filled variant
 * for the selected tab ourselves; a bundled bitmap on Android, which Material
 * tints. The Android icon is a PNG rather than the SVG it was: this bar resolves
 * an image icon through `Image.resolveAssetSource` and hands the bitmap to a
 * `Drawable`, and nothing in that path decodes SVG. `assets/icons/*.svg` are
 * still the source the PNGs beside them were rendered from.
 */
function icon(
  sf: string,
  android: ImageSourcePropType,
): (props: { focused: boolean }) => NativeBottomTabIcon {
  return ({ focused }) =>
    Platform.OS === 'ios'
      ? { type: 'sfSymbol', name: (focused ? `${sf}.fill` : sf) as never }
      : { type: 'image', source: android };
}

function SessionsTab() {
  const theme = useTheme();
  return (
    <SessionsStack.Navigator screenOptions={stackOptions(theme)}>
      <SessionsStack.Screen name="Sessions" component={SessionsScreen} options={rootPageOptions} />
    </SessionsStack.Navigator>
  );
}

function RoutinesTab() {
  const theme = useTheme();
  return (
    <RoutinesStack.Navigator screenOptions={stackOptions(theme)}>
      <RoutinesStack.Screen name="Routines" component={RoutinesScreen} />
    </RoutinesStack.Navigator>
  );
}

function UsageTab() {
  const theme = useTheme();
  return (
    <UsageStack.Navigator screenOptions={stackOptions(theme)}>
      <UsageStack.Screen name="Usage" component={UsageScreen} options={rootPageOptions} />
    </UsageStack.Navigator>
  );
}

function SettingsTab() {
  const theme = useTheme();
  return (
    <SettingsStack.Navigator screenOptions={stackOptions(theme)}>
      <SettingsStack.Screen name="Settings" component={SettingsScreen} options={rootPageOptions} />
    </SettingsStack.Navigator>
  );
}

export function Tabs() {
  const { c } = useTheme();
  const anyFailed = useRoutineAlert(s => s.anyFailed);

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.mutedForeground,
        // Android's bar, and iOS 18 and below; iOS 26 draws its own glass and
        // ignores a background colour.
        tabBarStyle: { backgroundColor: c.background },
        tabBarRippleColor: c.accent,
        tabBarActiveIndicatorColor: c.accent,
      }}>
      <Tab.Screen
        name="SessionsTab"
        component={SessionsTab}
        options={{
          title: 'Sessions',
          tabBarIcon: icon('bubble.left.and.bubble.right', require('../../assets/icons/sessions.png')),
        }}
      />
      <Tab.Screen
        name="RoutinesTab"
        component={RoutinesTab}
        options={{
          title: 'Routines',
          tabBarIcon: icon('clock', require('../../assets/icons/routines.png')),
          tabBarBadge: anyFailed ? '!' : undefined,
          tabBarBadgeStyle: { backgroundColor: c.destructive },
        }}
      />
      <Tab.Screen
        name="UsageTab"
        component={UsageTab}
        options={{
          title: 'Usage',
          tabBarIcon: icon('chart.bar', require('../../assets/icons/usage.png')),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsTab}
        options={{
          title: 'Settings',
          tabBarIcon: icon('gearshape', require('../../assets/icons/settings.png')),
        }}
      />
    </Tab.Navigator>
  );
}
