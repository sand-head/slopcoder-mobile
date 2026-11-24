/**
 * `slopcoder://…` — the URL scheme `OpenSessionIntent` opens.
 *
 * Its own module, not part of `App.tsx`, so the deep-link test can import the
 * config without pulling the whole app (and every native module in it) into a
 * Node process.
 *
 * React Navigation handles both the cold launch (initial URL, which the scene's
 * connectionOptions carry) and the warm case (scene URL events and notification
 * posts), so there is no listener to wire up by hand.
 *
 * `initialRouteName` is what puts the tabs *under* a session opened from a
 * notification or from Siri. Without it the cockpit is the only route, its
 * back button goes nowhere, and Android's back button leaves the app.
 */
import type { LinkingOptions, NavigatorScreenParams } from '@react-navigation/native';

/** A different artifact is a different route, even during warm-link navigation. */
export function artifactRouteId({ params }: { params?: object }): string | undefined {
  const { id, version: given, v } = (params ?? {}) as { id?: string; version?: number | string; v?: string };
  const version = given ?? v;
  // An edition is a route of its own, so a link to v2 does not replace the latest's screen.
  return id && version !== undefined && version !== null && version !== '' ? `${id}@${version}` : id;
}

type SettingsLinks = {
  Settings: undefined;
  Connections: undefined;
  McpServers: undefined;
  RemoteNodes: undefined;
  Terminal: undefined;
  GitIdentity: undefined;
  Facets: undefined;
  Hooks: undefined;
  Memory: undefined;
  Skills: undefined;
  Channels: undefined;
  ApiKeys: undefined;
};

type TabLinks = {
  SessionsTab: NavigatorScreenParams<{ Sessions: undefined }>;
  RoutinesTab: NavigatorScreenParams<{ Routines: undefined }>;
  ArtifactsTab: NavigatorScreenParams<{ Artifacts: undefined }>;
  UsageTab: NavigatorScreenParams<{ Usage: undefined }>;
  SettingsTab: NavigatorScreenParams<SettingsLinks>;
};

type RootLinks = {
  Tabs: NavigatorScreenParams<TabLinks>;
  Session: { id: string };
  Artifact: { id: string; version?: number; v?: string };
  Routine: { id: string; run?: string };
};

export const linking: LinkingOptions<RootLinks> = {
  prefixes: ['slopcoder://'],
  config: {
    initialRouteName: 'Tabs',
    screens: {
      Tabs: {
        screens: {
          SessionsTab: { screens: { Sessions: 'sessions' } },
          RoutinesTab: { screens: { Routines: 'routines' } },
          ArtifactsTab: { screens: { Artifacts: 'artifacts' } },
          UsageTab: { screens: { Usage: 'usage' } },
          SettingsTab: {
            screens: {
              Settings: 'settings',
              // The web's paths, so a link to a settings page lands on its screen.
              Connections: 'settings/connections',
              McpServers: 'settings/mcp',
              RemoteNodes: 'settings/nodes',
              Terminal: 'settings/terminal',
              GitIdentity: 'settings/git-identity',
              Facets: 'settings/facets',
              Hooks: 'settings/hooks',
              Memory: 'settings/memory',
              Skills: 'settings/skills',
              Channels: 'settings/channels',
              ApiKeys: 'settings/api-keys',
            },
          },
        },
      },
      Session: 'session/:id',
      // `?v=N`, the web's spelling of an edition, arrives as `params.v`; the
      // screen reads it alongside the `version` an in-app tap passes.
      Artifact: 'artifacts/:id',
      Routine: 'routines/:id',
    },
  },
};
