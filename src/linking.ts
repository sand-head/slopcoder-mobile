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
 */
import type { LinkingOptions } from '@react-navigation/native';

export const linking: LinkingOptions<Record<string, object | undefined>> = {
  prefixes: ['slopcoder://'],
  config: {
    screens: {
      Sessions: 'sessions',
      Session: 'session/:id',
      NewSession: 'new',
      Settings: 'settings',
    },
  },
};
