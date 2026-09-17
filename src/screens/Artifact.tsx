/**
 * One artifact, read on the phone.
 *
 * Markdown renders as prose, the way a transcript's reply does; text, JSON and
 * CSV keep their own shape in mono; an image is the image. HTML is the odd one
 * out: this app has no web view, so what it shows is the source, and the honest
 * way to *see* such an artifact from a phone is the unlisted link in a real
 * browser — which the share row is right there to make.
 *
 * The share switch is the only control on this screen that changes who can see
 * this, so it says what it does in both states rather than only when it is on.
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, Image, Linking, Share, View } from 'react-native';
import type { ArtifactDetail, ArtifactSummary } from '../api/contracts';
import { useAuth } from '../state/auth';
import { Body, Button, Hint, Meta, Mono, Prose } from '../ui/kit';
import { CopyBox, Empty, Problem, SettingsPage, SwitchRow, useFocusLoad } from '../ui/settings';
import { copyText } from '../ui/clipboard';
import { tapConfirm, tapError } from '../ui/haptics';
import { mix, font, radius, useTheme } from '../theme';
import { artifactMeta, bytes } from './Artifacts';

export function ArtifactScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const id: string = route.params.id;
  const [busy, setBusy] = useState(false);
  const detail = useFocusLoad<ArtifactDetail | null>(navigation, seam ? () => seam.artifact(id) : null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: detail.data?.artifact.title ?? route.params.title ?? 'Artifact' });
  }, [navigation, detail.data, route.params.title]);

  const artifact = detail.data?.artifact;

  /** Mint or revoke, optimistically enough that the switch answers the finger. */
  const setShared = useCallback(
    (on: boolean) => {
      if (!seam || !artifact) return;
      setBusy(true);
      seam
        .shareArtifact(artifact.id, on)
        .then(updated => {
          if (updated) {
            detail.set({ artifact: updated, text: detail.data?.text ?? null });
            tapConfirm();
          } else {
            tapError();
          }
        })
        .catch(() => tapError())
        .finally(() => setBusy(false));
    },
    [seam, artifact, detail],
  );

  const shareLink = artifact?.sharePath && seam ? seam.shareUrl(artifact.sharePath) : null;

  const remove = () =>
    Alert.alert(`Delete ‘${artifact?.title}’?`, 'The artifact and its share link, if it has one, are gone for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!seam || !artifact) return;
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

  return (
    <SettingsPage
      refreshing={detail.refreshing}
      onRefresh={detail.refresh}
      error={detail.error}
      loading={detail.data === undefined || (detail.data === null && !detail.error)}>
      {detail.data === null && !detail.error ? <Problem>No such artifact.</Problem> : null}
      {artifact ? (
        <>
          <View style={{ gap: 4 }}>
            {artifact.description.length > 0 ? <Body style={{ fontSize: 14 }}>{artifact.description}</Body> : null}
            <Mono>{`${artifact.format} · ${artifactMeta(artifact)}`}</Mono>
            {artifact.routineName ? <Mono>{`from the ${artifact.routineName} routine`}</Mono> : null}
          </View>

          <View style={{ gap: 10, borderWidth: 1, borderColor: artifact.shared ? c.primary : c.border, borderRadius: radius.md, padding: 12, backgroundColor: artifact.shared ? mix(c.primary, 6) : 'transparent' }}>
            <SwitchRow
              label="Unlisted link"
              detail={
                artifact.shared
                  ? 'anyone with the link can read it, without signing in'
                  : 'off — the artifact is visible only to you'
              }
              value={artifact.shared}
              disabled={busy}
              onChange={setShared}
            />
            {shareLink ? (
              <>
                <CopyBox value={shareLink} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button label="Share" onPress={() => void Share.share({ message: shareLink, url: shareLink })} />
                  <Button label="Copy" variant="ghost" onPress={() => copyText(shareLink)} />
                  <Button label="Open" variant="ghost" onPress={() => void Linking.openURL(shareLink)} />
                </View>
              </>
            ) : null}
          </View>

          <ArtifactBody detail={detail.data!} rawUrl={seam ? seam.artifactRawUrl(artifact.id) : null} apiKey={seam?.apiKey ?? null} />

          <Button label="Delete" variant="destructive" onPress={remove} />
        </>
      ) : null}
    </SettingsPage>
  );
}

/** The body, in whatever shape it actually is. */
function ArtifactBody({
  detail,
  rawUrl,
  apiKey,
}: {
  detail: ArtifactDetail;
  rawUrl: string | null;
  apiKey: string | null;
}) {
  const { c } = useTheme();
  const artifact: ArtifactSummary = detail.artifact;

  if (artifact.format === 'markdown' && detail.text !== null) return <Prose>{detail.text}</Prose>;

  if (detail.text !== null) {
    return (
      <View style={{ gap: 6 }}>
        {artifact.format === 'html' ? (
          <Hint>
            This one is a page. The phone has no browser of its own here, so what follows is its source — share it and
            open the link to see it rendered.
          </Hint>
        ) : null}
        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, backgroundColor: mix(c.muted, 40), padding: 12 }}>
          <Mono selectable style={{ fontFamily: font.mono, fontSize: 12.5, lineHeight: 18, color: c.foreground }}>
            {detail.text}
          </Mono>
        </View>
      </View>
    );
  }

  // Binary. An image is worth showing; anything else is a file, and says so.
  if (rawUrl && artifact.contentType.startsWith('image/')) {
    return (
      <View style={{ gap: 6 }}>
        <Meta>{`${artifact.contentType} · ${bytes(artifact.size)}`}</Meta>
        <Image
          accessibilityLabel={artifact.title}
          // The raw route is the owner's, so the key rides with the request —
          // an <Image> without it would silently paint nothing.
          source={{ uri: rawUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }}
          resizeMode="contain"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, borderWidth: 1, borderColor: c.border }}
        />
      </View>
    );
  }

  return <Empty>{`This one is a ${artifact.contentType} file of ${bytes(artifact.size)} — share it to open it elsewhere.`}</Empty>;
}
