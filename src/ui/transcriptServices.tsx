/**
 * What the transcript's building blocks need from the app, handed down rather
 * than imported.
 *
 * Prose, tool cards and the session screen render media and open links, and
 * doing either needs the signed-in server, its key, the navigator and a few
 * native views (a zoomable image, a WebView for audio). Importing those into
 * `kit` would make every screen — and every test that renders a paragraph —
 * load the keychain and three native modules. So the pieces are provided once,
 * by the app root (`transcriptMedia.ts`), and anything rendered without that
 * provider keeps its plain behaviour: text without media, links without the
 * app's routing.
 *
 * The value is fixed for the life of the app, so `useOpenLink` is always the
 * same hook in the same position, as the rules of hooks require.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { Text, type ImageSourcePropType } from 'react-native';
import { linkSegments } from '../api/links';
import { useTheme } from '../theme';

export interface TranscriptServices {
  /** The handler for a tapped link; returns false so nothing else opens it. */
  useOpenLink: () => ((url: string) => boolean) | undefined;
  ProseImage: React.ComponentType<{ src: string; alt: string }> | null;
  ArtifactMedia: React.ComponentType<{ artifactId: string; name: string; kind: string }> | null;
  ImageViewer: React.ComponentType<{ source: ImageSourcePropType | null; label: string; onClose: () => void }> | null;
  /**
   * A picture the server kept for a tool card — what a tool returned, or a 3D
   * scene's render — inline, opening full screen on a tap.
   */
  KeptImage: React.ComponentType<{ kind: 'tool' | 'scene'; id: string; label: string }> | null;
}

const none: TranscriptServices = {
  useOpenLink: () => undefined,
  ProseImage: null,
  ArtifactMedia: null,
  ImageViewer: null,
  KeptImage: null,
};

const Context = createContext<TranscriptServices>(none);

export const TranscriptServicesProvider = Context.Provider;

export function useTranscriptServices(): TranscriptServices {
  return useContext(Context);
}

/**
 * Plain text with its links tappable — for tool results, which are text
 * rather than markdown. Renders spans inside the caller's own text node, so
 * selection and the caller's typography stay as they were.
 */
export function LinkedText({ text }: { text: string }) {
  const { c } = useTheme();
  const open = useTranscriptServices().useOpenLink();
  const segments = useMemo(() => linkSegments(text), [text]);
  if (!open || (segments.length === 1 && segments[0].href === null)) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.href === null ? (
          segment.text
        ) : (
          <Text
            key={index}
            accessibilityRole="link"
            onPress={() => open(segment.href!)}
            style={{ color: c.primary, textDecorationLine: 'underline' }}>
            {segment.text}
          </Text>
        ),
      )}
    </>
  );
}
