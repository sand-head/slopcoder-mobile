/**
 * The version, from the binary rather than from `package.json`.
 *
 * `package.json` says 0.0.1 and always will: the release workflow stamps
 * `MARKETING_VERSION` and the build number into the app at build time and
 * never touches the repo. The only copy that is true is the one iOS and
 * Android carry in the bundle, which `AppInfo` (Swift, Kotlin) reads out.
 */
import { NativeModules } from 'react-native';

interface AppInfoModule {
  getConstants(): { version: string; build: string };
}

const native: AppInfoModule | undefined = NativeModules.AppInfo;

export function appVersion(): string {
  const constants = native?.getConstants?.();
  if (!constants) return 'development';
  return constants.build ? `${constants.version} (${constants.build})` : constants.version;
}
