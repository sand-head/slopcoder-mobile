/**
 * A Release build that still claims `aps-environment: development` registers
 * against Apple's sandbox, so every production notification is accepted by APNs
 * and delivered to nobody. Nothing errors. This is the only place that catches
 * it short of shipping.
 */
import fs from 'fs';
import path from 'path';

const IOS = path.join(__dirname, '..', 'ios');
const PBXPROJ = path.join(IOS, 'slopcoder_mobile.xcodeproj', 'project.pbxproj');

function apsEnvironment(file: string): string | undefined {
  const plist = fs.readFileSync(path.join(IOS, file), 'utf8');
  return plist.match(/<key>aps-environment<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
}

describe('push entitlements', () => {
  const project = fs.readFileSync(PBXPROJ, 'utf8');

  it('ships a debug entitlement pointing at the sandbox', () => {
    expect(apsEnvironment('slopcoder_mobile/slopcoder_mobile.entitlements')).toBe('development');
  });

  it('ships a release entitlement pointing at production', () => {
    expect(apsEnvironment('slopcoder_mobile/slopcoder_mobile.release.entitlements')).toBe('production');
  });

  it.each(['slopcoder_mobile.entitlements', 'slopcoder_mobile.release.entitlements'])(
    'references %s from the project',
    file => {
      expect(project).toContain(file);
    },
  );

  it('gives Debug and Release different entitlement files', () => {
    // Both names present is not enough — one configuration pointing at both, or
    // both pointing at one, is the failure this is here for. The extension has
    // one file for both configurations, which is fine: it claims no environment.
    const referenced = [...project.matchAll(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g)]
      .map(m => m[1].trim().replace(/^"|"$/g, ''))
      .filter(f => f.startsWith('slopcoder_mobile/'));

    expect(new Set(referenced).size).toBe(2);
  });
});
