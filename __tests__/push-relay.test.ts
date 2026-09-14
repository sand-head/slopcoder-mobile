/**
 * The notification service extension and what has to line up for it to open a
 * message: the shared Keychain group, the relay envelope's key, the derivation
 * constants, and the release signing for a second bundle. None of it compiles
 * on Linux and all of it fails only on a phone — a wrong access group is a
 * placeholder notification with no error anywhere.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const IOS = path.join(ROOT, 'ios');
const read = (...segments: string[]) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');

const PROJECT = read('ios', 'slopcoder_mobile.xcodeproj', 'project.pbxproj');
const KEYS = read('ios', 'slopcoder_mobile', 'Push', 'PushKeys.swift');
const SERVICE = read('ios', 'NotificationService', 'NotificationService.swift');
const WORKFLOW = read('.github', 'workflows', 'release.yml');

const KEYCHAIN_GROUP = '$(AppIdentifierPrefix)codes.sand.slopcoder';

function accessGroups(file: string): string[] {
  const plist = fs.readFileSync(path.join(IOS, file), 'utf8');
  const block = plist.match(/<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  return [...block.matchAll(/<string>([^<]+)<\/string>/g)].map(m => m[1]);
}

describe('the notification service extension', () => {
  it('is a notification service, with the class the project compiles', () => {
    const plist = read('ios', 'NotificationService', 'Info.plist');
    expect(plist).toContain('<string>com.apple.usernotifications.service</string>');
    expect(plist).toContain('<string>$(PRODUCT_MODULE_NAME).NotificationService</string>');
    expect(SERVICE).toMatch(/final class NotificationService: UNNotificationServiceExtension/);
  });

  it('takes its version from the same settings as the app, as App Store Connect requires', () => {
    const plist = read('ios', 'NotificationService', 'Info.plist');
    expect(plist).toContain('<string>$(MARKETING_VERSION)</string>');
    expect(plist).toContain('<string>$(CURRENT_PROJECT_VERSION)</string>');
  });

  it('is embedded in the app, and built before it', () => {
    expect(PROJECT).toMatch(/dstSubfolderSpec = 13;/);
    expect(PROJECT).toMatch(/NotificationService\.appex in Embed Foundation Extensions/);
    expect(PROJECT).toMatch(/isa = PBXTargetDependency;\s*target = \w+ \/\* NotificationService \*\//);
  });

  /**
   * The app writes the keys, the extension reads them, and the only thing that
   * makes that one Keychain rather than two is the same group named in all
   * three entitlement files.
   */
  it.each([
    'slopcoder_mobile/slopcoder_mobile.entitlements',
    'slopcoder_mobile/slopcoder_mobile.release.entitlements',
    'NotificationService/NotificationService.entitlements',
  ])('%s names the shared keychain group', file => {
    expect(accessGroups(file)).toEqual([KEYCHAIN_GROUP]);
  });

  it('keeps the keys readable while the phone is locked', () => {
    // WhenUnlocked — what the credential uses — would leave every notification
    // that arrives in a pocket showing the relay's placeholder.
    expect(KEYS).toMatch(/kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
    expect(KEYS).not.toMatch(/kSecAttrAccessibleWhenUnlocked/);
  });
});

describe('the wire, as the relay defines it', () => {
  /** docs/push-relay.md in the slopcoder repo; PushRelay.CiphertextKey. */
  it('reads the ciphertext from the key the relay writes', () => {
    expect(SERVICE).toMatch(/userInfo\["wp"\]/);
  });

  /** RFC 8291 §3.3 and RFC 8188 §2.2, byte for byte; a typo here is silent. */
  it('derives with the RFC 8291 info strings', () => {
    expect(KEYS).toContain('"WebPush: info\\u{0}"');
    expect(KEYS).toContain('"Content-Encoding: aes128gcm\\u{0}"');
    expect(KEYS).toContain('"Content-Encoding: nonce\\u{0}"');
  });

  it('puts the deep link where the tap handler already looks', () => {
    expect(SERVICE).toMatch(/info\["url"\] = url/);
  });

  it('subscribes on the seam with a Web Push subscription, not a device token', () => {
    const seam = read('ios', 'slopcoder_mobile', 'Intents', 'SeamClient.swift');
    expect(seam).toContain('"api/seam/push/subscribe"');
    expect(seam).toContain('"api/seam/push/unsubscribe"');
    expect(seam).not.toContain('api/seam/devices');
  });
});

describe('the relay address', () => {
  it('reaches the app through Info.plist from a build setting', () => {
    const plist = read('ios', 'slopcoder_mobile', 'Info.plist');
    expect(plist).toMatch(/<key>SlopcoderPushRelay<\/key>\s*<string>\$\(SLOPCODER_PUSH_RELAY\)<\/string>/);
    expect(PROJECT).toMatch(/SLOPCODER_PUSH_RELAY = /);
  });

  /**
   * The relay is whichever deployment holds this app's Apple key — the
   * publisher's, which is a fact about who ships the build and not about the
   * code. CI reads it from a repository variable; the project file carries no
   * address that a fork would have to remember to change.
   */
  it('comes from a repository variable at release, not from the project file', () => {
    expect(WORKFLOW).toMatch(/SLOPCODER_PUSH_RELAY: \$\{\{ vars\.SLOPCODER_PUSH_RELAY \}\}/);
    expect(WORKFLOW).toMatch(/SLOPCODER_PUSH_RELAY="\$SLOPCODER_PUSH_RELAY"/);
    const settings = [...PROJECT.matchAll(/SLOPCODER_PUSH_RELAY = ([^;]+);/g)].map(m => m[1]);
    expect(settings).toEqual(['""', '""']);
  });

  it('refuses a relay that is not https', () => {
    const client = read('ios', 'slopcoder_mobile', 'Push', 'PushRelayClient.swift');
    expect(client).toMatch(/url\.scheme == "https"/);
  });
});

describe('release signing for two bundles', () => {
  it('installs a profile for the extension and signs it for distribution', () => {
    expect(WORKFLOW).toMatch(/secrets\.IOS_EXTENSION_PROVISIONING_PROFILE_BASE64/);
    expect(WORKFLOW).toMatch(/SLOPCODER_EXTENSION_PROFILE=/);
    const release = PROJECT.match(
      /PRODUCT_BUNDLE_IDENTIFIER = codes\.sand\.slopcoder\.NotificationService;[\s\S]*?PROVISIONING_PROFILE_SPECIFIER = "\$\(SLOPCODER_EXTENSION_PROFILE\)";/,
    );
    expect(release).not.toBeNull();
  });
});
