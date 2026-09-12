/**
 * The URL `OpenSessionIntent` builds must be a URL this app can route.
 *
 * That contract spans Swift and TypeScript with nothing in between to check it:
 * the intent hardcodes `slopcoder://session/<id>`, React Navigation's config
 * hardcodes `session/:id`, and the cockpit reads `route.params.id`. Change any
 * one and Siri opens the app to the wrong screen, silently.
 *
 * The Swift side is read off disk rather than restated here, so this fails if
 * the intent's URL changes without the route changing with it.
 */
import fs from 'fs';
import path from 'path';
import { getStateFromPath } from '@react-navigation/native';
import { linking } from '../src/linking';

const INTENT = path.join(
  __dirname,
  '..',
  'ios',
  'slopcoder_mobile',
  'Intents',
  'OpenSessionIntent.swift',
);

describe('the session deep link', () => {
  /** e.g. `slopcoder://session/\(target.id)` */
  const swiftUrl = fs
    .readFileSync(INTENT, 'utf8')
    .match(/URL\(string:\s*"([^"]+)"\)/)?.[1];

  it('is built by the intent in the scheme the app registers', () => {
    expect(swiftUrl).toBeDefined();
    expect(linking.prefixes.some(p => swiftUrl!.startsWith(p))).toBe(true);
  });

  it('routes to the cockpit with the session id as a param', () => {
    // Substitute a real id for the Swift interpolation.
    const id = '01a09313-3900-7f10-bff7-e2c02724d9eb';
    const url = swiftUrl!.replace(/\\\(target\.id\)/, id);
    const p = url.replace(/^slopcoder:\/\//, '');

    const state = getStateFromPath(p, linking.config as never);
    const route = state?.routes.at(-1);

    expect(route?.name).toBe('Session');
    expect((route?.params as { id?: string })?.id).toBe(id);
  });

  it('registers the scheme in Info.plist, or iOS never delivers it', () => {
    const plist = fs.readFileSync(
      path.join(__dirname, '..', 'ios', 'slopcoder_mobile', 'Info.plist'),
      'utf8',
    );
    const scheme = linking.prefixes[0].replace('://', '');

    expect(plist).toContain('CFBundleURLSchemes');
    expect(plist).toContain(`<string>${scheme}</string>`);
  });
});
