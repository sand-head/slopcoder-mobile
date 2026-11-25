/**
 * Media in the transcript: images, audio and video shown where they occur.
 *
 * Three sources, one set of rules:
 *
 * - **Markdown images** in the agent's prose (`![chart](/artifacts/…/raw)`).
 *   On this server they load with the bearer key; elsewhere, over http(s),
 *   without it, as the web does; small `data:` images inline. Anything else
 *   is the alt text.
 * - **Published artifacts** of an image, audio or video type, under their card.
 * - **Images a prompt carried**, which the scrollback already holds inline.
 * - **Images a tool returned**, which the server keeps beside the transcript,
 *   and 3D scene renders — both under their tool card.
 *
 * Every image sits in a fixed-height box, so a 4000px screenshot costs the
 * same row as a 40px one, and opens full screen with pinch zoom on a tap.
 * At most {@link MAX_DECODING} transcript images load at once: the rest show
 * their placeholder until a slot frees, so opening a long run does not decode
 * every image in it in the same moment. Audio loads only when asked to play.
 *
 * Nothing here caches bytes of its own. Images go through the platform's
 * image loader like every other image in the app; audio is held only while
 * its player is on screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { artifactInfo, knownArtifactInfo, type ArtifactInfo } from '../state/artifactInfo';
import { AudioPlayerView, isAudioContentType, isVideoContentType, loadAudioDocument } from './audio';
import { useRowSeen } from './visibility';
import { ZoomableImage } from './ZoomableImage';
import { font, mix, radius, useTheme } from '../theme';

/** Transcript images loading at once. */
export const MAX_DECODING = 3;
/** Larger image artifacts are not fetched inline; the card still opens them. */
export const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
/** A `data:` image longer than this (≈ 1.5 MB decoded) is not drawn from prose. */
const MAX_DATA_URL_CHARS = 2 * 1024 * 1024;
/** The box every inline image sits in. */
export const INLINE_IMAGE_HEIGHT = 180;

// ------------------------------------------------------------------ sources

export interface MediaSource {
  uri: string;
  /** Needs the bearer key: it is this server's. */
  authed: boolean;
}

function originOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : null;
}

/**
 * Where a markdown image's bytes come from, or null when it should not be
 * fetched at all (an unknown scheme, a huge data URL, nothing).
 */
export function resolveMediaSource(src: string, baseUrl: string | null): MediaSource | null {
  const url = src.trim();
  if (url.length === 0) return null;
  if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url)) {
    return url.length <= MAX_DATA_URL_CHARS ? { uri: url, authed: false } : null;
  }
  const base = baseUrl ? baseUrl.replace(/\/+$/, '') : null;
  if (/^https?:\/\//i.test(url)) {
    const same = base !== null && originOf(url) === originOf(base);
    return { uri: url, authed: same };
  }
  if (url.startsWith('/') && !url.startsWith('//') && base) return { uri: `${base}${url}`, authed: true };
  if (/^artifacts\//i.test(url) && base) return { uri: `${base}/${url}`, authed: true };
  return null;
}

function imageSource(source: MediaSource, apiKey: string | null): ImageSourcePropType {
  return source.authed && apiKey
    ? { uri: source.uri, headers: { Authorization: `Bearer ${apiKey}` } }
    : { uri: source.uri };
}

// ------------------------------------------------------------ decode slots

let decoding = 0;
const queue: (() => void)[] = [];

/** For tests. */
export function decodingNow(): number {
  return decoding;
}

/**
 * A turn to load an image. `want` asks for one; the returned `done` gives it
 * back once the image has loaded or failed, and unmounting gives it back too.
 */
export function useDecodeSlot(want: boolean): { granted: boolean; done: () => void } {
  const [granted, setGranted] = useState(false);
  const holding = useRef(false);
  const waiter = useRef<(() => void) | null>(null);

  const done = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    decoding--;
    queue.shift()?.();
  }, []);

  useEffect(() => {
    if (!want || granted) return;
    let alive = true;
    const take = () => {
      if (!alive) {
        // Woken after unmounting: pass the turn straight on.
        queue.shift()?.();
        return;
      }
      decoding++;
      holding.current = true;
      setGranted(true);
    };
    if (decoding < MAX_DECODING) take();
    else {
      waiter.current = take;
      queue.push(take);
    }
    return () => {
      alive = false;
      if (waiter.current) {
        const at = queue.indexOf(waiter.current);
        if (at >= 0) queue.splice(at, 1);
        waiter.current = null;
      }
    };
  }, [want, granted]);

  useEffect(() => done, [done]);
  return { granted, done };
}

// ------------------------------------------------------------- full screen

/** One image, full screen, with pinch and double-tap zoom. */
export function ImageViewer({
  source,
  label,
  onClose,
}: {
  source: ImageSourcePropType | null;
  label: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={source !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {source ? <ZoomableImage testID="image-viewer" source={source} accessibilityLabel={label} /> : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close image"
          hitSlop={12}
          style={({ pressed }) => ({
            position: 'absolute',
            top: 52,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.18)',
            opacity: pressed ? 0.6 : 1,
          })}>
          <Text style={{ color: '#fff', fontSize: 18 }}>×</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ----------------------------------------------------------- inline image

/**
 * One inline image in its box. Waits for its row to have been seen and for a
 * load slot; says so if it fails rather than leaving an empty frame.
 */
export function InlineImage({
  source,
  label,
  onPress,
  testID,
  bare = false,
}: {
  source: ImageSourcePropType;
  label: string;
  /** Defaults to opening the full-screen viewer. */
  onPress?: () => void;
  testID?: string;
  /**
   * An image in prose, as the web draws one: the column's full width at the
   * image's own proportions, with no frame once it has loaded. The frame and
   * fixed height stay for the wait and for a failure, so there is something to
   * see and to tap.
   */
  bare?: boolean;
}) {
  const { c } = useTheme();
  const seen = useRowSeen();
  const { granted, done } = useDecodeSlot(seen);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);

  const framed = {
    width: '100%' as const,
    height: INLINE_IMAGE_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: mix(c.muted, 35),
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  const box =
    bare && aspect
      ? { width: '100%' as const, aspectRatio: aspect, overflow: 'hidden' as const }
      : framed;

  if (failed) {
    return (
      <Pressable
        testID={testID}
        onPress={() => {
          setFailed(false);
          setAttempt(a => a + 1);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Could not load. Tap to try again.`}
        style={framed}>
        <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: c.mutedForeground, textAlign: 'center', padding: 12 }}>
          {'Could not load this image.\nTap to try again.'}
        </Text>
      </Pressable>
    );
  }

  return (
    <>
      <Pressable
        testID={testID}
        onPress={onPress ?? (() => setViewing(true))}
        disabled={!granted}
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
        accessibilityHint="Opens full screen"
        style={box}>
        {granted ? (
          <Image
            key={attempt}
            source={source}
            resizeMode="contain"
            // Android decodes to the box rather than the file's own size.
            resizeMethod="resize"
            onLoad={bare ? event => {
              const { width, height } = event.nativeEvent.source;
              if (width > 0 && height > 0) setAspect(width / height);
            } : undefined}
            onLoadEnd={done}
            onError={() => {
              done();
              setFailed(true);
            }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <ActivityIndicator color={c.mutedForeground} />
        )}
      </Pressable>
      {/* Mounted only while open: a transcript of images carries no modals. */}
      {!onPress && viewing ? <ImageViewer source={source} label={label} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

/** A markdown image in prose. */
export function ProseImage({ src, alt }: { src: string; alt: string }) {
  const { c } = useTheme();
  const apiKey = useAuth(s => s.seam?.apiKey ?? null);
  const baseUrl = useAuth(s => s.seam?.baseUrl ?? null);
  const source = resolveMediaSource(src, baseUrl);
  const label = alt.trim().length > 0 ? alt : 'Image';
  if (!source) {
    // Not something to fetch: say what it was, as the alt text would.
    return (
      <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.mutedForeground }}>
        {`[image: ${label}]`}
      </Text>
    );
  }
  return (
    <View style={{ width: '100%', marginVertical: 6 }}>
      <InlineImage testID="prose-image" bare source={imageSource(source, apiKey)} label={label} />
    </View>
  );
}

// ------------------------------------------------------------ kept images

/**
 * A picture the server kept for a tool card: an image a tool returned, or the
 * render a 3D scene tool handed the agent. Loads with the device key, like an
 * artifact, and opens full screen with pinch zoom on a tap.
 */
export function KeptImage({ kind, id, label }: { kind: 'tool' | 'scene'; id: string; label: string }) {
  const seam = useAuth(s => s.seam);
  if (!seam) return null;
  const uri = kind === 'tool' ? seam.toolImageUrl(id) : seam.sceneRenderUrl(id);
  return (
    <InlineImage
      testID={kind === 'tool' ? 'tool-image' : 'scene-render'}
      source={{ uri, headers: { Authorization: `Bearer ${seam.apiKey}` } }}
      label={label}
    />
  );
}

// ------------------------------------------------------- artifact media

type Lookup =
  | { state: 'waiting' }
  | { state: 'ready'; info: ArtifactInfo }
  | { state: 'failed' };

/**
 * The artifact's summary, asked for only once this row has been seen, and
 * only for a kind that could be media at all.
 */
function useArtifactLookup(id: string, wanted: boolean): { lookup: Lookup; retry: () => void } {
  const seam = useAuth(s => s.seam);
  const seen = useRowSeen();
  const known = seam ? knownArtifactInfo(seam, id) : undefined;
  const [lookup, setLookup] = useState<Lookup>(known !== undefined ? { state: 'ready', info: known } : { state: 'waiting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wanted || !seen || !seam || lookup.state === 'ready') return;
    let alive = true;
    artifactInfo(seam, id).then(
      info => alive && setLookup({ state: 'ready', info }),
      () => alive && setLookup({ state: 'failed' }),
    );
    return () => {
      alive = false;
    };
    // `lookup` is read only to skip a finished lookup; a retry bumps `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, seen, seam, id, attempt]);

  const retry = useCallback(() => {
    setLookup({ state: 'waiting' });
    setAttempt(a => a + 1);
  }, []);
  return { lookup, retry };
}

/** The kinds whose card cannot say what it is: binary, or a format the card does not name. */
export function mightBeMedia(kind: string): boolean {
  return !['Markdown', 'Text', 'HTML', 'JSON', 'CSV'].includes(kind);
}

function MediaNote({ children, onPress, label }: { children: string; onPress?: () => void; label?: string }) {
  const { c } = useTheme();
  const text = <Text style={{ fontFamily: font.mono, fontSize: 11, color: c.mutedForeground }}>{children}</Text>;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? children} hitSlop={6}>
      {text}
    </Pressable>
  ) : (
    text
  );
}

/**
 * What goes under an artifact card when the artifact is media: a thumbnail
 * that opens the artifact's own full-screen viewer, an audio player, or for
 * video a line saying where it plays. Nothing for documents.
 */
export function ArtifactMedia({ artifactId, name, kind }: { artifactId: string; name: string; kind: string }) {
  const seam = useAuth(s => s.seam);
  const navigation = useNavigation<any>();
  const wanted = mightBeMedia(kind);
  const { lookup, retry } = useArtifactLookup(artifactId, wanted);

  if (!wanted || !seam) return null;
  if (lookup.state === 'waiting') return null;
  if (lookup.state === 'failed') {
    return <MediaNote onPress={retry}>Could not check this artifact. Tap to try again.</MediaNote>;
  }
  const info = lookup.info;
  if (info === null) return <MediaNote>This artifact no longer exists.</MediaNote>;

  const open = () => navigation.navigate('Artifact', { id: artifactId, title: info.title });
  const raw = seam.artifactRawUrl(artifactId);

  if (info.contentType.startsWith('image/')) {
    if (info.size > MAX_INLINE_IMAGE_BYTES) {
      return <MediaNote onPress={open}>{`Image, ${megabytes(info.size)} - too large to preview here. Open it to view.`}</MediaNote>;
    }
    return (
      <InlineImage
        testID="artifact-thumbnail"
        source={{ uri: raw, headers: { Authorization: `Bearer ${seam.apiKey}` } }}
        label={`Image artifact: ${info.title || name}. Opens full screen.`}
        onPress={open}
      />
    );
  }
  if (isAudioContentType(info.contentType)) {
    return <InlineAudio url={raw} apiKey={seam.apiKey} contentType={info.contentType} title={info.title || name} />;
  }
  if (isVideoContentType(info.contentType)) {
    return <MediaNote onPress={open}>{`Video, ${megabytes(info.size)} - opens on the artifact's page.`}</MediaNote>;
  }
  return null;
}

function megabytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * A private audio file, played in place. Nothing is fetched until Play: a
 * transcript of voice notes should not download all of them on open.
 */
export function InlineAudio({
  url,
  apiKey,
  contentType,
  title,
}: {
  url: string;
  apiKey: string | null;
  contentType: string;
  title: string;
}) {
  const { c } = useTheme();
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'ready'>('idle');
  const [document, setDocument] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const play = () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState('loading');
    loadAudioDocument(url, apiKey, contentType, controller.signal).then(
      html => {
        if (controller.signal.aborted) return;
        setDocument(html);
        setState('ready');
      },
      () => {
        if (!controller.signal.aborted) setState('failed');
      },
    );
  };

  if (state === 'ready' && document) {
    return (
      <AudioPlayerView
        playerID="inline-audio"
        label={`Audio: ${title}`}
        document={document}
        style={{ height: 56, backgroundColor: 'transparent' }}
        onError={() => setState('failed')}
      />
    );
  }

  return (
    <Pressable
      testID="inline-audio-play"
      onPress={state === 'loading' ? undefined : play}
      accessibilityRole="button"
      accessibilityLabel={state === 'failed' ? `Audio ${title} could not be loaded. Try again.` : `Play audio ${title}`}
      accessibilityState={{ busy: state === 'loading' }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 40,
        paddingHorizontal: 10,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? mix(c.mutedForeground, 10) : mix(c.muted, 35),
      })}>
      {state === 'loading' ? <ActivityIndicator color={c.mutedForeground} /> : null}
      <Text style={{ fontFamily: font.mono, fontSize: 12, color: state === 'failed' ? c.destructive : c.foreground }}>
        {state === 'failed' ? 'Could not load this audio. Tap to try again.' : state === 'loading' ? 'Loading audio' : 'Play audio'}
      </Text>
    </Pressable>
  );
}
