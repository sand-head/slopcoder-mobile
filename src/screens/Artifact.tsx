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
import type { ArtifactDetail, ArtifactSummary } from '../api/contracts';
import { useAuth } from '../state/auth';
import { Button, Mono, Prose } from '../ui/kit';
import { Empty, Problem, RowMenuButton, SettingsPage, useFocusLoad } from '../ui/settings';
import { copyText } from '../ui/clipboard';
import { tapConfirm, tapError } from '../ui/haptics';
import { barMenu, useHeaderInset } from '../navigation/headers';
import { font, mix, radius, useTheme } from '../theme';
import { artifactMeta, bytes } from './Artifacts';
import { ZoomableImage } from '../ui/ZoomableImage';

export function ArtifactScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const id: string = route.params.id;
  const [busy, setBusy] = useState(false);
  const detail = useFocusLoad<ArtifactDetail | null>(navigation, seam ? () => seam.artifact(id) : null);
  const headerInset = useHeaderInset();
  const artifact = detail.data?.artifact;
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
        setDetail({ artifact: updated, text: detailText });
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
    [seam, artifact, busy, setDetail, detailText],
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
        loading={detail.data === null && !detail.error}>
        {detail.data === null && !detail.error ? <Problem>No such artifact.</Problem> : null}
      </SettingsPage>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ArtifactBody
        key={`${artifact.id}:${artifact.version}`}
        detail={detail.data!}
        rawUrl={seam ? seam.artifactRawUrl(artifact.id) : null}
        viewUrl={seam ? seam.artifactViewUrl(artifact.id) : null}
        apiKey={seam?.apiKey ?? null}
        refreshing={detail.refreshing}
        onRefresh={detail.refresh}
      />
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
  refreshing,
  onRefresh,
}: {
  detail: ArtifactDetail;
  rawUrl: string | null;
  viewUrl: string | null;
  apiKey: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { c } = useTheme();
  const headerInset = useHeaderInset();
  const artifact: ArtifactSummary = detail.artifact;

  if (artifact.format === 'html' && viewUrl) {
    return <HtmlArtifact artifact={artifact} url={viewUrl} apiKey={apiKey} />;
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
          <Prose>{detail.text}</Prose>
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
