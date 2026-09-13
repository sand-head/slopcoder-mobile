/**
 * The things a build has to get right that only fail on a real device, or in
 * App Review, or on the second upload — never on a simulator and never in a
 * unit test that is about something else.
 *
 * The permission check below exists because it caught one: the app called
 * vision-camera's `requestPermission()` on the login screen while
 * `NSCameraUsageDescription` was absent, and iOS does not prompt in that
 * situation — it terminates the process. QR pairing crashed on the one screen a
 * fresh install starts on, and nothing here or in CI said a word, because the
 * simulator build never runs the code and the JS never throws.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const IOS = path.join(ROOT, 'ios');
const INFO_PLIST = fs.readFileSync(path.join(IOS, 'slopcoder_mobile', 'Info.plist'), 'utf8');
const PROJECT = fs.readFileSync(
  path.join(IOS, 'slopcoder_mobile.xcodeproj', 'project.pbxproj'),
  'utf8',
);

const BUNDLE_ID = 'codes.sand.slopcoder';

function plistString(key: string): string | undefined {
  return INFO_PLIST.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
}

function plistHasBoolean(key: string): boolean {
  return new RegExp(`<key>${key}</key>\\s*<(true|false)/>`).test(INFO_PLIST);
}

/** Every .ts/.tsx under src/, concatenated — what the app actually calls. */
function sourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) parts.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(ROOT, 'src'));
  return parts.join('\n');
}

/**
 * An API that makes iOS ask the user for something, and the Info.plist string
 * it refuses to ask without. Add a row when the app starts using a new one —
 * the cost of forgetting is a crash that only happens on hardware.
 */
const PERMISSIONS: [api: RegExp, key: string][] = [
  [/useCameraPermission|react-native-vision-camera/, 'NSCameraUsageDescription'],
  [/useMicrophonePermission/, 'NSMicrophoneUsageDescription'],
  [/PhotoLibrary|launchImageLibrary/, 'NSPhotoLibraryUsageDescription'],
  [/Geolocation|watchPosition/, 'NSLocationWhenInUseUsageDescription'],
];

describe('permissions the app asks for', () => {
  const source = sourceText();

  it.each(PERMISSIONS)('declares %s as %s when the source uses it', (api, key) => {
    if (!api.test(source)) return; // not used; nothing to declare
    const value = plistString(key);
    expect(value).toBeDefined();
    // A blank or placeholder string is rejected by App Review and tells the user
    // nothing, which is the same failure wearing a different hat.
    expect((value ?? '').trim().length).toBeGreaterThan(20);
  });
});

describe('identity', () => {
  it('is not still the React Native template bundle id', () => {
    expect(PROJECT).not.toMatch(/org\.reactjs\.native\.example/);
  });

  it('uses the same bundle id in every build configuration', () => {
    const ids = [...PROJECT.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(m =>
      m[1].replace(/"/g, '').trim(),
    );
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids)).toEqual(new Set([BUNDLE_ID]));
  });

  /**
   * The App Intents read the device key straight out of the Keychain rather than
   * through the JS bridge, so Siri never boots the runtime. That only works
   * while both sides name the same service — and a mismatch fails as "not signed
   * in" from Siri while the app itself is fine, which is a maddening thing to
   * debug.
   */
  it('names one keychain service across TypeScript and Swift', () => {
    const ts = fs
      .readFileSync(path.join(ROOT, 'src', 'state', 'auth.ts'), 'utf8')
      .match(/const SERVICE = '([^']+)'/)?.[1];
    const swift = fs
      .readFileSync(path.join(IOS, 'slopcoder_mobile', 'Intents', 'Credential.swift'), 'utf8')
      .match(/let service = "([^"]+)"/)?.[1];

    expect(ts).toBe(BUNDLE_ID);
    expect(swift).toBe(ts);
  });

  it('names the bundle id as the URL type, so the deep link is unambiguous', () => {
    expect(INFO_PLIST).toMatch(new RegExp(`<string>${BUNDLE_ID.replace(/\./g, '\\.')}</string>`));
  });
});

describe('Siri', () => {
  /**
   * App Intents needs no entitlement: the compiler writes the shortcut metadata
   * into the binary and the system reads it from there. SiriKit is the one that
   * wants `com.apple.developer.siri`, and drifting to it would fail only on a
   * signed device build, with an entitlement error that names neither framework.
   */
  it('uses App Intents, so no Siri capability is ever required', () => {
    const dir = path.join(IOS, 'slopcoder_mobile', 'Intents');
    const swift = fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.swift'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));

    expect(swift.length).toBeGreaterThan(0);
    expect(swift.some(f => /import AppIntents/.test(f))).toBe(true);
    expect(swift.some(f => /^import Intents$|INExtension|INIntent\b/m.test(f))).toBe(false);
  });

  /**
   * Every entitlement the app claims has to be a capability ticked on the App ID
   * in Apple's portal, which nothing here can check. Keeping the claimed set to
   * exactly one makes the portal side a single decision rather than a list to
   * reconcile — so a new key here is a deliberate trip to developer.apple.com.
   */
  it.each(['slopcoder_mobile.entitlements', 'slopcoder_mobile.release.entitlements'])(
    '%s claims aps-environment and nothing else',
    file => {
      const keys = [
        ...fs
          .readFileSync(path.join(IOS, 'slopcoder_mobile', file), 'utf8')
          .matchAll(/<key>([^<]+)<\/key>/g),
      ].map(m => m[1]);
      expect(keys).toEqual(['aps-environment']);
    },
  );
});

describe('release signing', () => {
  /** The block of build settings for one configuration of the app target. */
  function config(name: 'Debug' | 'Release'): string {
    const blocks = [...PROJECT.matchAll(/buildSettings = \{([\s\S]*?)\};\s*name = (Debug|Release);/g)];
    const match = blocks.find(b => b[2] === name && b[1].includes('PRODUCT_BUNDLE_IDENTIFIER'));
    expect(match).toBeDefined();
    return match![1];
  }

  /**
   * `iPhone Developer` cannot sign an App Store archive, and Xcode's automatic
   * signing would pick whatever it liked rather than the one profile CI installs.
   */
  it('signs Release for distribution, with the profile CI installs', () => {
    const release = config('Release');
    expect(release).toMatch(/CODE_SIGN_STYLE = Manual/);
    expect(release).toMatch(/"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]" = "Apple Distribution"/);
    expect(release).toMatch(/PROVISIONING_PROFILE_SPECIFIER/);
    expect(release).toMatch(/DEVELOPMENT_TEAM/);
  });

  it('leaves Debug on automatic signing, so a laptop build needs no profile', () => {
    expect(config('Debug')).toMatch(/CODE_SIGN_STYLE = Automatic/);
  });

  it('never uses the retired iPhone Developer identity', () => {
    expect(PROJECT).not.toMatch(/iPhone Developer|iPhone Distribution/);
  });
});

describe('signing material', () => {
  const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

  /**
   * The reason the decoded certificate and profile live in RUNNER_TEMP is that
   * one day somebody adds an upload-artifact to debug a build, points it at the
   * workspace, and ships the distribution certificate to whoever can read the
   * run. That is not a mistake anyone catches reading the diff that made it.
   */
  it('never decodes a secret into the checkout', () => {
    const writes = [...WORKFLOW.matchAll(/base64 -d > (\S+)/g)].map(m => m[1].replace(/"/g, ''));
    expect(writes.length).toBeGreaterThan(0);
    for (const target of writes)
      expect(target.startsWith('$RUNNER_TEMP/') || target.startsWith('~/')).toBe(true);
  });

  /** Masking is exact-match, so the only safe amount of secret on stdout is none. */
  it('redirects every decoded secret to a file rather than printing it', () => {
    const printed = WORKFLOW.split('\n').filter(
      line => /echo\s+"\$[A-Z_]*(CERTIFICATE|KEY|PROFILE|PASSWORD)[A-Z_]*"/.test(line) && !line.includes('>'),
    );
    expect(printed).toEqual([]);
  });

  /** xtrace would echo `security import -P "<password>"` verbatim. */
  it('turns on no shell tracing', () => {
    expect(WORKFLOW).not.toMatch(/set -x|bash -x/);
  });

  /**
   * The template signs release with `signingConfigs.debug`, i.e. with the
   * keystore committed at android/app/debug.keystore. An APK signed with it is
   * installable by anyone who cloned the repo, and the four ANDROID_* secrets
   * the workflow passes would go unread while everything looked green.
   */
  it('signs an Android release with the CI keystore, never the committed debug one', () => {
    const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
    // Only the release build type. The debug one signs with signingConfigs.debug
    // and should — that is what makes a laptop build installable.
    const types = gradle.slice(gradle.indexOf('buildTypes'));
    const release = types.slice(types.indexOf('release {'));

    expect(release).toMatch(/signingConfigs\.release/);
    expect(release).not.toMatch(/signingConfig\s+signingConfigs\.debug\s*$/m);
    expect(gradle).toMatch(/SLOPCODER_STORE_FILE/);
  });

  /**
   * The Android job is off until its keystore exists, and the gate is a secret
   * rather than a flag so it comes back by itself. Two ways this goes wrong: the
   * gate outlives the reason for it and nobody notices Android never builds, or
   * a copied `if:` takes the iOS job down with it — which would be a release
   * that quietly shipped nothing at all.
   */
  it('gates Android on its signing key and gates iOS on nothing', () => {
    const jobs = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:'));
    const job = (name: string) => {
      const start = jobs.indexOf(`\n  ${name}:\n`);
      const rest = jobs.slice(start + 1);
      const next = rest.search(/\n  \w[\w-]*:\n/);
      return next === -1 ? rest : rest.slice(0, next);
    };

    expect(job('android')).toMatch(/if: needs\.android-signing\.outputs\.configured == 'true'/);
    // Reading the secret is the whole point of the gate job; a gate that checks
    // nothing is one that stays shut.
    expect(job('android-signing')).toMatch(/secrets\.ANDROID_KEYSTORE_BASE64/);
    expect(job('ios')).not.toMatch(/^\s{4}if:/m);
  });

  /** Secrets on a pull_request_target run are readable by any fork. */
  it('runs only on tags pushed to this repository', () => {
    const on = WORKFLOW.match(/^on:\n([\s\S]*?)\njobs:/m)?.[1] ?? '';
    expect(on).toMatch(/tags/);
    expect(on).not.toMatch(/pull_request/);
  });
});

describe('app icon', () => {
  const SET = path.join(IOS, 'slopcoder_mobile', 'Images.xcassets', 'AppIcon.appiconset');

  /** Width, height and whether the PNG carries an alpha channel, from the IHDR chunk. */
  function png(file: string): { width: number; height: number; alpha: boolean } {
    const b = fs.readFileSync(file);
    const colourType = b[25];
    return {
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
      // 4 = grey + alpha, 6 = RGBA. Apple rejects either outright.
      alpha: colourType === 4 || colourType === 6,
    };
  }

  /**
   * The React Native template ships this catalog with a Contents.json listing
   * every size and not one image file. The build succeeds, the archive
   * succeeds, and altool rejects the upload with four errors — three missing
   * sizes and a missing CFBundleIconName, which Xcode only writes when the
   * catalog actually compiled an icon. Twenty-five minutes of CI to find out.
   */
  it('has an icon, and Contents.json points at it', () => {
    const contents = JSON.parse(fs.readFileSync(path.join(SET, 'Contents.json'), 'utf8'));
    expect(contents.images.length).toBeGreaterThan(0);

    for (const image of contents.images) {
      expect(image.filename).toBeDefined();
      expect(fs.existsSync(path.join(SET, image.filename))).toBe(true);
    }
  });

  it('is 1024 square, so Xcode can generate every size iPhone and iPad need', () => {
    const { width, height } = png(path.join(SET, 'AppIcon.png'));
    expect([width, height]).toEqual([1024, 1024]);
  });

  /** An app icon with transparency is rejected by App Store Connect, not softened. */
  it('carries no alpha channel', () => {
    expect(png(path.join(SET, 'AppIcon.png')).alpha).toBe(false);
  });

  it('is the icon the target builds', () => {
    expect(PROJECT).toMatch(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/);
  });
});

describe('App Store Connect chores', () => {
  /**
   * Without this, every single upload sits in "Missing Compliance" until someone
   * clicks through the encryption questionnaire by hand. The app speaks HTTPS
   * and nothing else, which is exempt.
   */
  it('answers the export compliance question in advance', () => {
    expect(plistHasBoolean('ITSAppUsesNonExemptEncryption')).toBe(true);
  });

  /**
   * App Store Connect rejects a build number it has already accepted, so a
   * literal in the project file means the second upload of any version fails.
   * The workflow passes the run number on the xcodebuild command line.
   */
  it('takes the version and build number from the release workflow', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(workflow).toMatch(/MARKETING_VERSION="\$VERSION"/);
    expect(workflow).toMatch(/CURRENT_PROJECT_VERSION="\$GITHUB_RUN_NUMBER"/);
  });

  it('exports with the bundle id the project actually builds', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(workflow).toContain(`<key>${BUNDLE_ID}</key>`);
  });
});
