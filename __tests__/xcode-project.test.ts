/**
 * Every Swift file the Xcode target compiles must exist where the project says.
 *
 * There is no Swift toolchain on a Linux dev machine, so the intents are only
 * ever compiled by CI — a ten-minute round trip on a macOS runner. A path that
 * resolves nowhere is the cheapest possible way to spend one, and it is easy to
 * produce: Xcode resolves a file through every ancestor group that carries a
 * path, so a group with a path plus a file repeating that prefix silently
 * doubles it and the build dies on a missing input file. That is exactly what
 * happened while adding these.
 */
import fs from 'fs';
import path from 'path';
const xcode = require('xcode');

const IOS = path.join(__dirname, '..', 'ios');
const PBXPROJ = path.join(IOS, 'slopcoder_mobile.xcodeproj', 'project.pbxproj');

const project = xcode.project(PBXPROJ);
project.parseSync();

const groups = project.hash.project.objects.PBXGroup;
const fileRefs = project.hash.project.objects.PBXFileReference;
const buildFiles = project.hash.project.objects.PBXBuildFile;
const unquote = (s: unknown) => String(s ?? '').replace(/^"|"$/g, '');

const parent = new Map<string, string>();
for (const [key, group] of Object.entries<any>(groups)) {
  if (!group || !Array.isArray(group.children)) continue;
  for (const child of group.children) parent.set(child.value, key);
}

function resolve(refKey: string): string {
  const segments = [unquote(fileRefs[refKey].path)];
  for (let cursor = parent.get(refKey); cursor; cursor = parent.get(cursor)) {
    const segment = unquote(groups[cursor]?.path);
    if (segment) segments.unshift(segment);
  }
  return path.join(IOS, ...segments);
}

const targets = project.hash.project.objects.PBXNativeTarget;
const targetNamed = (name: string) =>
  Object.entries<any>(targets).find(([, t]) => t && t.name === name)![0];

const compiledBy = (target: string): string[] =>
  project
    .pbxSourcesBuildPhaseObj(target)
    .files.map((entry: any) => resolve(buildFiles[entry.value].fileRef));

const compiled: string[] = compiledBy(project.getFirstTarget().uuid);
const extensionCompiled: string[] = compiledBy(targetNamed('NotificationService'));

const cases: [string, string][] = [...compiled, ...extensionCompiled].map(p => [
  path.basename(p),
  p,
]);

describe('the Xcode project', () => {
  it('compiles the intents', () => {
    expect(compiled.map(p => path.basename(p))).toEqual(
      expect.arrayContaining([
        'AppDelegate.swift',
        'Credential.swift',
        'IntentError.swift',
        'SeamClient.swift',
        'StartSessionIntent.swift',
        'RunningSessionsIntent.swift',
        'SlopcoderShortcuts.swift',
      ]),
    );
  });

  it.each(cases)('%s resolves to a file that exists', (_name, resolved) => {
    expect(fs.existsSync(resolved)).toBe(true);
  });

  /**
   * The keys are made by the app and read by the extension, so the one file
   * that knows their Keychain item and their derivation is compiled into both.
   * A second copy would drift; a copy in one target only would leave the other
   * unable to open what the first wrote.
   */
  it('compiles the push keys into the app and the extension alike', () => {
    expect(compiled.map(p => path.basename(p))).toContain('PushKeys.swift');
    expect(extensionCompiled.map(p => path.basename(p))).toEqual(
      expect.arrayContaining(['NotificationService.swift', 'PushKeys.swift']),
    );
    // The extension has no React, no bridge and no seam: it must not pull in
    // anything that imports them.
    expect(extensionCompiled.map(p => path.basename(p))).not.toContain('PushRegistrar.swift');
    expect(extensionCompiled.map(p => path.basename(p))).not.toContain('SeamClient.swift');
  });

  it('leaves no Swift file in Intents/ out of the build', () => {
    const onDisk = fs
      .readdirSync(path.join(IOS, 'slopcoder_mobile', 'Intents'))
      .filter(f => f.endsWith('.swift'))
      .sort();
    const inBuild = compiled
      .filter(p => p.includes(`${path.sep}Intents${path.sep}`))
      .map(p => path.basename(p))
      .sort();

    expect(inBuild).toEqual(onDisk);
  });
});
