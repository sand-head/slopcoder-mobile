/**
 * Where the device key lives, and the one `Seam` everything else uses.
 *
 * The key goes in the iOS Keychain / Android Keystore via `react-native-keychain`,
 * never AsyncStorage: it is a bearer credential that reaches everything its owner
 * can reach, and it does not expire — only revocation at `/settings/api-keys`
 * ends it.
 */
import * as Keychain from 'react-native-keychain';
import { create } from 'zustand';
import { Seam, loginWithPassword, redeemPairingCode } from '../api/seam';
import type { LoginFailure } from '../api/contracts';
import { enablePush } from '../push';

const SERVICE = 'town.sand.slopcoder';

export interface Credential {
  server: string;
  apiKey: string;
  userName: string;
}

interface AuthState {
  credential: Credential | null;
  seam: Seam | null;
  /** False until the keychain has been read once, so the UI can hold its shell. */
  ready: boolean;
  restore: () => Promise<void>;
  signInWithPassword: (server: string, userName: string, password: string) => Promise<void>;
  signInWithPairingCode: (server: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** What the device calls itself in the key list, so there is something to revoke. */
function deviceName(): string {
  const { Platform } = require('react-native') as typeof import('react-native');
  return Platform.OS === 'ios' ? 'iPhone (slopcoder)' : 'Android (slopcoder)';
}

export const useAuth = create<AuthState>((set, get) => ({
  credential: null,
  seam: null,
  ready: false,

  async restore() {
    try {
      const stored = await Keychain.getGenericPassword({ service: SERVICE });
      if (stored) {
        const credential = JSON.parse(stored.password) as Credential;
        set({ credential, seam: build(credential, get), ready: true });
        return;
      }
    } catch {
      // A keychain that will not open is the same as an empty one: sign in again.
    }
    set({ ready: true });
  },

  async signInWithPassword(server, userName, password) {
    const key = await loginWithPassword(server, { userName, password, deviceName: deviceName() });
    await persist({ server, apiKey: key.fullKey, userName: key.userName }, set, get);
  },

  async signInWithPairingCode(server, code) {
    const key = await redeemPairingCode(server, { code, deviceName: deviceName() });
    await persist({ server, apiKey: key.fullKey, userName: key.userName }, set, get);
  },

  async signOut() {
    await Keychain.resetGenericPassword({ service: SERVICE });
    set({ credential: null, seam: null });
  },
}));

type Setter = (partial: Partial<AuthState>) => void;

async function persist(credential: Credential, set: Setter, get: () => AuthState) {
  await Keychain.setGenericPassword('slopcoder', JSON.stringify(credential), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  set({ credential, seam: build(credential, get) });

  // Asked here and nowhere else: the key is in the keychain, so the native side
  // can post the token the moment iOS hands it over, and the prompt lands when
  // the reason for it is obvious.
  enablePush();
}

function build(credential: Credential, get: () => AuthState): Seam {
  return new Seam({
    baseUrl: credential.server,
    apiKey: credential.apiKey,
    // A 401 means the key was revoked or the account deactivated. There is no
    // refresh to attempt; drop it and show the login screen.
    onSignedOut: () => void get().signOut(),
  });
}

/** Turns a thrown `SeamError` from the auth routes into something to show a person. */
export function loginMessage(error: unknown): string {
  const code = (error as { message?: string })?.message as LoginFailure | undefined;
  switch (code) {
    case 'invalid':
      return 'That username and password did not match.';
    case 'inactive':
      return 'That account is deactivated.';
    case 'twofactor':
      return 'This account uses two-factor sign-in. Pair with a QR code from Settings → API keys instead.';
    case 'too-many-attempts':
      return 'Too many attempts. Wait a minute and try again.';
    default:
      return 'Could not reach that server.';
  }
}
