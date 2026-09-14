/**
 * Turning on notifications, at the one moment it is worth asking.
 *
 * iOS gives an app a single chance: refuse the permission prompt once and it
 * never appears again without a trip to Settings. So this is called right after
 * a successful sign-in, when the reason is self-evident — never at cold launch,
 * before anyone knows what the app is.
 *
 * Everything after the prompt is native. iOS delivers the APNs token to the
 * AppDelegate, which trades it for a Web Push endpoint at the push relay and
 * subscribes on the server itself, using the same keychain credential the
 * intents use — there is nothing for JavaScript to carry.
 */
import { NativeModules, Platform } from 'react-native';

interface PushRegistrarModule {
  enablePush(): void;
  refreshIfAlreadyAllowed(): void;
  disablePush(): Promise<void>;
}

const registrar: PushRegistrarModule | undefined = NativeModules.PushRegistrar;

/** Ask for permission and register. Safe to call more than once. */
export function enablePush(): void {
  // Android push is not wired up yet; there is no FCM token to fetch.
  if (Platform.OS !== 'ios') return;
  registrar?.enablePush();
}

/**
 * Remove this phone's subscription from the server. Awaited by sign-out before
 * the credential goes, since the credential is what authorises the call.
 */
export async function disablePush(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await registrar?.disablePush();
  } catch {
    // Unreachable server: the row dies on its own once the token does.
  }
}
