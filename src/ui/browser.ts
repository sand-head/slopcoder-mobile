/**
 * The cockpit's own pages, opened without leaving the app.
 *
 * Authoring a routine, or editing one, is a form the web has and a phone has
 * no business rebuilding. Opening it in Safari or Chrome was the first cut,
 * and it handed the person off to another app with no way back but the app
 * switcher. `SFSafariViewController` and a Chrome Custom Tab are the platform's
 * answer: the page comes up over this one, in the browser's own cookie jar,
 * and Done brings you straight back.
 */
import { Linking } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';

export async function openInApp(url: string, tint?: string): Promise<void> {
  try {
    if (await InAppBrowser.isAvailable()) {
      await InAppBrowser.open(url, {
        // iOS
        dismissButtonStyle: 'done',
        preferredControlTintColor: tint,
        modalPresentationStyle: 'pageSheet',
        animated: true,
        // Android
        showTitle: true,
        enableDefaultShare: false,
        enableUrlBarHiding: true,
        showInRecents: false,
      });
      return;
    }
  } catch {
    // Fall through to the system browser.
  }
  await Linking.openURL(url);
}

/** `https://slop.example.com/` + `routines/new` → one URL, one slash. */
export function cockpitUrl(server: string, path: string): string {
  return `${server.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
