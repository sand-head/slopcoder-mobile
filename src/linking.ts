/**
 * `slopcoder://…` — the URL scheme `OpenSessionIntent` opens.
 *
 * Its own module, not part of `App.tsx`, so the deep-link test can import the
 * config without pulling the whole app (and every native module in it) into a
 * Node process.
 *
 * React Navigation handles both the cold launch (initial URL, which iOS puts in
 * launchOptions) and the warm case (the `url` event the AppDelegate posts), so
 * there is no listener to wire up by hand.
 *
 * `initialRouteName` is what puts the tabs *under* a session opened from a
 * notification or from Siri. Without it the cockpit is the only route, its
 * back button goes nowhere, and Android's back button leaves the app.
 */
import type { LinkingOptions } from '@react-navigation/native';

export const linking: LinkingOptions<Record<string, any>> = {
  prefixes: ['slopcoder://'],
  config: {
    initialRouteName: 'Tabs',
    screens: {
      Tabs: {
        screens: {
          SessionsTab: { screens: { Sessions: 'sessions' } },
          RoutinesTab: { screens: { Routines: 'routines' } },
          UsageTab: { screens: { Usage: 'usage' } },
          SettingsTab: { screens: { Settings: 'settings' } },
        },
      },
      Session: 'session/:id',
      Routine: 'routines/:id',
    },
  },
};
