/**
 * One artifact, as the thing itself rather than a page about it.
 *
 * The native bar carries the title and an overflow menu for metadata, sharing
 * and deletion. Everything below it belongs to the artifact: prose and data
 * scroll, HTML runs in its server-sandboxed page, and a photograph fills the
 * screen with native zoom and pan gestures. In particular, none of these need
 * an unlisted link merely to be viewed by their owner.
 */
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { Seam } from '../api/seam';
import type { ArtifactAppStatus, ArtifactDetail, ArtifactSummary } from '../api/contracts';
import { useAuth } from '../state/auth';
import { Button, Mono, Prose } from '../ui/kit';
import { Empty, Problem, RowMenuButton, SettingsPage, useFocusLoad } from '../ui/settings';
import { copyText } from '../ui/clipboard';
import { tapConfirm, tapError } from '../ui/haptics';
import { barMenu, useHeaderInset } from '../navigation/headers';
import { font, mix, radius, useTheme } from '../theme';
import { artifactMeta, bytes } from './Artifacts';
import { ZoomableImage } from '../ui/ZoomableImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioPlayerView, isAudioContentType, loadAudioDocument } from '../ui/audio';

/**
 * An artifact as loaded for this screen: the latest, or — when a link named
 * one with `?v=N` — that kept edition laid over the latest's identity, so
 * sharing and deleting still act on the artifact itself.
 */
export interface LoadedArtifact extends ArtifactDetail {
  /** The edition shown, when it is not the latest. */
  pinned?: number;
  /** A requested edition that is no longer kept; the latest is shown instead. */
  missingVersion?: number;
}

/** `version` arrives as a number from a tap and as a string from a deep link. */
export function routeVersion(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function loadArtifact(seam: Seam, id: string, version: number | null): Promise<LoadedArtifact | null> {
  const latest = await seam.artifact(id);
  if (!latest || version === null || version === latest.artifact.version) return latest;
  const edition = await seam.artifactVersion(id, version);
  if (!edition) return { ...latest, missingVersion: version };
  return {
    artifact: {
      ...latest.artifact,
      title: edition.version.title,
      format: edition.version.format,
      contentType: edition.version.contentType,
      size: edition.version.size,
      version: edition.version.version,
      description: edition.description,
    },
    text: edition.text,
    pinned: edition.version.version,
  };
}

export function ArtifactScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const id: string = route.params.id;
  const version = routeVersion(route.params.version ?? route.params.v);
  const [busy, setBusy] = useState(false);
  // Whether a load has answered at all: a gone artifact answers null, which is
  // otherwise indistinguishable from "not loaded yet" and left a skeleton up forever.
  const [answered, setAnswered] = useState(false);
  const insets = useSafeAreaInsets();
  const detail = useFocusLoad<LoadedArtifact | null>(
    navigation,
    seam
      ? () =>
          loadArtifact(seam, id, version).finally(() => setAnswered(true))
      : null,
  );
  const headerInset = useHeaderInset();
  const artifact = detail.data?.artifact;
  const pinned = detail.data?.pinned ?? null;
  const missingVersion = detail.data?.missingVersion ?? null;
  const detailText = detail.data?.text ?? null;
  const setDetail = detail.set;
  const shareLink = artifact?.sharePath && seam ? seam.shareUrl(artifact.sharePath) : null;

  /** Mint or revoke while preserving the loaded body and running HTML state. */
  const setShared = useCallback(
    async (on: boolean, presentSheet = false) => {
      if (!seam || !artifact || busy) return;
      setBusy(true);
      try {
        const updated = await seam.shareArtifact(artifact.id, on);
        if (!updated) {
          tapError();
          return;
        }
        // Only the link changed. Merging just that keeps a pinned edition's
        // own title and body in place of the latest's.
        setDetail(
          detail.data
            ? { ...detail.data, artifact: { ...detail.data.artifact, shareToken: updated.shareToken, shared: updated.shared, sharePath: updated.sharePath } }
            : { artifact: updated, text: detailText },
        );
        tapConfirm();
        if (presentSheet && updated.sharePath) {
          const url = seam.shareUrl(updated.sharePath);
          await Share.share({ message: url, url });
        }
      } catch {
        tapError();
      } finally {
        setBusy(false);
      }
    },
    [seam, artifact, busy, setDetail, detailText, detail.data],
  );

  const share = useCallback(async () => {
    if (busy) return;
    if (!shareLink) {
      await setShared(true, true);
      return;
    }
    try {
      await Share.share({ message: shareLink, url: shareLink });
    } catch {
      tapError();
    }
  }, [busy, shareLink, setShared]);

  const showDetails = useCallback(() => {
    if (!artifact) return;
    const lines = [
      artifact.description,
      `${artifact.format} · ${artifact.slug} · ${artifactMeta(artifact)}`,
      artifact.sessionTitle ? `from ${artifact.sessionTitle}` : '',
      artifact.routineName ? `from the ${artifact.routineName} routine` : '',
    ].filter(line => line.length > 0);
    Alert.alert(artifact.title, lines.join('\n\n'));
  }, [artifact]);

  const remove = useCallback(() => {
    if (!artifact) return;
    Alert.alert(`Delete ‘${artifact.title}’?`, 'The artifact and its share link, if it has one, are gone for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!seam) return;
          seam
            .deleteArtifact(artifact.id)
            .then(() => {
              tapConfirm();
              navigation.goBack();
            })
            .catch(() => tapError());
        },
      },
    ]);
  }, [artifact, seam, navigation]);

  useLayoutEffect(() => {
    if (!artifact) {
      navigation.setOptions({ title: route.params.title ?? 'Artifact' });
      return;
    }

    const items = [
      { key: 'share', label: 'Share…', symbol: 'square.and.arrow.up', onPress: () => share() },
      ...(shareLink
        ? [
            { key: 'copy', label: 'Copy link', symbol: 'doc.on.doc', onPress: () => copyText(shareLink) },
            {
              key: 'open',
              label: 'Open in browser',
              symbol: 'safari',
              onPress: () => void Linking.openURL(shareLink).catch(() => tapError()),
            },
            {
              key: 'unshare',
              label: 'Stop sharing',
              symbol: 'lock',
              onPress: () => setShared(false),
            },
          ]
        : []),
      { key: 'details', label: 'Details', symbol: 'info.circle', onPress: showDetails },
      { key: 'delete', label: 'Delete', symbol: 'trash', destructive: true, onPress: remove },
    ];
    navigation.setOptions({
      title: artifact.title,
      ...barMenu(
        items,
        () => (
          <RowMenuButton
            title={artifact.title}
            items={items.map(item => ({ ...item, title: item.label }))}
          />
        ),
      ),
    });
  }, [navigation, artifact, route.params.title, shareLink, share, setShared, showDetails, remove]);

  if (!artifact) {
    return (
      <SettingsPage
        refreshing={detail.refreshing}
        onRefresh={detail.refresh}
        error={detail.error}
        loading={!answered && !detail.error}>
        {answered && detail.data === null && !detail.error ? (
          <Problem>This artifact no longer exists, or is not yours.</Problem>
        ) : null}
      </SettingsPage>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ArtifactBody
        key={`${artifact.id}:${artifact.version}:${pinned ?? 'latest'}`}
        detail={detail.data!}
        rawUrl={seam ? (pinned ? seam.artifactVersionRawUrl(artifact.id, pinned) : seam.artifactRawUrl(artifact.id)) : null}
        viewUrl={seam ? (pinned ? seam.artifactVersionViewUrl(artifact.id, pinned) : seam.artifactViewUrl(artifact.id)) : null}
        apiKey={seam?.apiKey ?? null}
        seam={seam}
        refreshing={detail.refreshing}
        onRefresh={detail.refresh}
      />
      {pinned || missingVersion ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            // Above the system navigation bar, not under it.
            bottom: insets.bottom + 16,
            right: 16,
            left: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius.md,
            backgroundColor: c.card,
            padding: 12,
          }}>
          <Mono style={{ flex: 1 }}>
            {pinned
              ? `Version ${pinned}, an earlier edition.`
              : `Version ${missingVersion} is no longer kept; this is the latest (v${artifact.version}).`}
          </Mono>
          {pinned ? <Button label="Latest" onPress={() => navigation.replace('Artifact', { id, title: artifact.title })} /> : null}
        </View>
      ) : null}
      {detail.error ? (
        <View
          style={{
            position: 'absolute',
            top: headerInset + 8,
            right: 16,
            left: 16,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius.md,
            backgroundColor: c.card,
            padding: 12,
          }}>
          <Problem>{detail.error}</Problem>
        </View>
      ) : null}
    </View>
  );
}

/** The body, in whatever shape it actually is. No provenance or action rows. */
function ArtifactBody({
  detail,
  rawUrl,
  viewUrl,
  apiKey,
  seam,
  refreshing,
  onRefresh,
}: {
  detail: ArtifactDetail;
  rawUrl: string | null;
  viewUrl: string | null;
  apiKey: string | null;
  seam: Seam | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { c } = useTheme();
  const headerInset = useHeaderInset();
  const artifact: ArtifactSummary = detail.artifact;

  if (artifact.format === 'html' && viewUrl) {
    return <HostedHtmlArtifact artifact={artifact} url={viewUrl} apiKey={apiKey} seam={seam} />;
  }

  if (rawUrl && artifact.contentType.startsWith('image/')) {
    return (
      <ZoomableImage
        testID="artifact-photo"
        accessibilityLabel={artifact.title}
        source={{ uri: rawUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }}
      />
    );
  }

  // Fetch the bytes with the bearer before handing them to WebView. Media
  // subrequests do not inherit WebView source headers, and injecting the key
  // into an HTML audio element would widen the artifact trust boundary. The
  // server's content type is authoritative for playable media.
  if (rawUrl && isAudioContentType(artifact.contentType)) {
    return <AudioArtifact artifact={artifact} url={rawUrl} apiKey={apiKey} />;
  }

  if (detail.text !== null) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.mutedForeground} />}
        contentContainerStyle={
          artifact.format === 'markdown'
            ? { padding: 20, paddingBottom: 48 }
            : { flexGrow: 1, paddingTop: 12, paddingBottom: 24 }
        }>
        {artifact.format === 'markdown' ? (
          <Prose size="document">{detail.text}</Prose>
        ) : (
          <View
            style={{
              minHeight: '100%',
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: c.border,
              backgroundColor: mix(c.muted, 40),
              padding: 16,
            }}>
            <Mono selectable style={{ fontFamily: font.mono, fontSize: 12.5, lineHeight: 19, color: c.foreground }}>
              {detail.text}
            </Mono>
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, paddingTop: headerInset + 24 }}>
      <Empty>{`This one is a ${artifact.contentType} file of ${bytes(artifact.size)}. Share it to open it elsewhere.`}</Empty>
    </View>
  );
}

/** Kept as an export of this screen for its existing callers; the rule lives in `ui/audio`. */
export { isAudioContentType };

function AudioArtifact({ artifact, url, apiKey }: {
  artifact: ArtifactSummary; url: string; apiKey: string | null;
}) {
  const { c } = useTheme();
  const [document, setDocument] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setDocument(null);
    setFailed(false);
    loadAudioDocument(url, apiKey, artifact.contentType, controller.signal).then(
      html => { if (active) setDocument(html); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; controller.abort(); };
  }, [url, apiKey, artifact.contentType]);

  if (failed) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.background }}>
        <Empty>{`This audio file could not be played on this device (${artifact.contentType}).`}</Empty>
      </View>
    );
  }
  if (!document) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}><ActivityIndicator color={c.primary} /></View>;
  }

  return (
    <AudioPlayerView
      playerID="artifact-audio"
      label={`Audio artifact: ${artifact.title}`}
      document={document}
      style={{ flex: 1, backgroundColor: c.background }}
      onError={() => setFailed(true)}
    />
  );
}

function HostedHtmlArtifact({ artifact, url, apiKey, seam }: {
  artifact: ArtifactSummary; url: string; apiKey: string | null; seam: Seam | null;
}) {
  const { c } = useTheme();
  const [app, setApp] = useState<ArtifactAppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (!artifact.hasApp || !seam) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      try {
        const status = await seam.artifactApp(artifact.id, true);
        if (!active) return;
        setApp(status);
        if (status?.state === 'starting') {
          timer = setTimeout(async () => {
            const next = await seam.artifactApp(artifact.id).catch(() => null);
            if (active) setApp(next);
          }, 2500);
        }
      } catch { if (active) tapError(); }
    };
    void start();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [artifact.id, artifact.hasApp, seam]);

  const toggle = async () => {
    if (!seam || busy) return;
    setBusy(true);
    try {
      const next = await seam.artifactApp(artifact.id, app?.state !== 'running' && app?.state !== 'starting');
      setApp(next);
      tapConfirm();
    } catch { tapError(); } finally { setBusy(false); }
  };

  if (!artifact.hasApp) return <HtmlArtifact artifact={artifact} url={url} apiKey={apiKey} />;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: 8, alignItems: 'flex-end', backgroundColor: c.background }}>
        <Button label={busy ? 'Working…' : app?.state === 'running' || app?.state === 'starting' ? 'Stop' : 'Play'}
          disabled={busy} onPress={() => void toggle()} />
      </View>
      {app?.state === 'running' || app?.state === 'starting' ? (
        <HtmlArtifact artifact={artifact} url={`${seam?.baseUrl}${app.previewUrl}${app.landingPath}`} apiKey={apiKey} />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <Empty>{app?.error ?? 'Opening this artifact starts its app container. Idle apps stop automatically.'}</Empty>
        </View>
      )}
    </View>
  );
}

/**
 * Agent-authored HTML, fetched from the response that carries its sandbox CSP.
 * The bearer key authenticates the initial owner request only: it is never
 * injected into the document, no app bridge is installed, cookies and caches
 * stay out of the view, and a navigation away opens externally without it.
 */
function HtmlArtifact({ artifact, url, apiKey }: { artifact: ArtifactSummary; url: string; apiKey: string | null }) {
  const { c } = useTheme();
  const headerInset = useHeaderInset();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(
    () => ({ uri: url, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }),
    [url, apiKey],
  );
  const openExternal = useCallback((target: string) => {
    if (target === url || target.startsWith(`${url}#`) || !/^https?:\/\//.test(target)) return;
    void Linking.openURL(target).catch(() => tapError());
  }, [url]);

  if (failed) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', gap: 14, padding: 24, paddingTop: headerInset + 24 }}>
        <Problem>This page could not be opened.</Problem>
        <Button label="Try again" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: headerInset, backgroundColor: c.background }}>
      <WebView
        key={attempt}
        testID="artifact-webview"
        accessibilityLabel={`Interactive artifact: ${artifact.title}`}
        source={source}
        style={{ flex: 1, backgroundColor: c.background }}
        originWhitelist={['*']}
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        allowsBackForwardNavigationGestures={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        cacheEnabled={false}
        incognito
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        setSupportMultipleWindows
        mediaPlaybackRequiresUserAction
        webviewDebuggingEnabled={false}
        startInLoadingState
        renderLoading={() => (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}>
            <ActivityIndicator color={c.primary} />
          </View>
        )}
        onError={() => setFailed(true)}
        onOpenWindow={({ nativeEvent }) => openExternal(nativeEvent.targetUrl)}
        onShouldStartLoadWithRequest={request => {
          // iOS reports subframes here too. An iframe is content, not a user
          // asking to leave the app, and must never launch the system browser.
          if (!request.isTopFrame) return false;
          if (request.url === url || request.url.startsWith(`${url}#`)) return true;
          // iOS preserves clicks directly. Android always reports "other", so
          // our patch forwards WebResourceRequest.hasGesture(); missing legacy
          // evidence fails closed rather than letting a redirect open a browser.
          const hasGesture = Platform.OS === 'android'
            ? request.hasGesture === true
            : request.navigationType === 'click';
          if (hasGesture) openExternal(request.url);
          return false;
        }}
      />
    </View>
  );
}
