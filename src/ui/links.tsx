/**
 * Opening a link from a transcript.
 *
 * `resolveLink` decides; this does. App routes are pushed onto the stack so
 * back returns to the transcript the link was in; other web links go to the
 * system browser; anything that cannot be opened says so instead of doing
 * nothing, which is what a tap on `/artifacts/…` used to do.
 */
import { useCallback, useContext } from 'react';
import { Alert, Linking } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { resolveLink, type LinkTarget } from '../api/links';
import { useAuth } from '../state/auth';
import { tapError } from './haptics';

/** Tell the reader a link could not be opened — once, plainly. */
function refuse(url: string, why: string) {
  tapError();
  Alert.alert('Could not open link', `${why}\n\n${url}`);
}

/** Navigate to, or open, one resolved target. Exported for tests. */
export function openTarget(target: LinkTarget, navigation: any): void {
  if (!navigation && target.kind !== 'external' && target.kind !== 'unsupported') {
    refuse(describe(target), 'This screen cannot open it.');
    return;
  }
  switch (target.kind) {
    case 'artifact':
      navigation.push('Artifact', { id: target.id, ...(target.version ? { version: target.version } : null) });
      return;
    case 'session':
      navigation.push('Session', { id: target.id });
      return;
    case 'routine':
      navigation.push('Routine', { id: target.id });
      return;
    case 'external':
      Linking.openURL(target.url).catch(() => refuse(target.url, 'No app on this device can open it.'));
      return;
    case 'unsupported':
      refuse(target.url, 'It is not a web address or a page of this app.');
      return;
  }
}

function describe(target: LinkTarget): string {
  return 'url' in target ? target.url : `${target.kind} ${target.id}`;
}

/**
 * The handler for a tapped link. Returns false so the markdown renderer does
 * not also hand the URL to `Linking` itself.
 */
export function useOpenLink(): (url: string) => boolean {
  // The context, not `useNavigation`: prose also renders outside a navigator
  // (tests, previews), and a link there should refuse rather than throw.
  const navigation = useContext(NavigationContext);
  const baseUrl = useAuth(s => s.seam?.baseUrl ?? null);
  return useCallback(
    (url: string) => {
      openTarget(resolveLink(url, baseUrl), navigation);
      return false;
    },
    [navigation, baseUrl],
  );
}
