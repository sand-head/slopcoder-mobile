/**
 * A published artifact, as a card that shows the document.
 *
 * A list of titles makes you remember which report was which; the opening of
 * each one, drawn small, does not — you recognise the thing you wanted the way
 * you recognise a page you have already read. So the card is a picture of the
 * artifact with a name under it, which is the shape the cockpit uses too.
 *
 * The name line is the transcript's file card, unchanged on purpose: the tinted
 * tile, the name, the line of what it is. The same object should not wear two
 * faces depending on which screen it is standing on.
 */
import React from 'react';
import { Image, Pressable, View } from 'react-native';
import type { ArtifactSummary } from '../api/contracts';
import { Body, Meta, Mono, Prose } from './kit';
import { Tag } from './settings';
import { OverflowMenu, type MenuItem } from './menu';
import { mix, radius, font, useTheme } from '../theme';

/** How tall a preview is. Enough for a heading and the paragraph under it. */
const PREVIEW_HEIGHT = 148;

/** "12.4 KB" — the same wording the cockpit and `slop` use. */
export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${trim(size / 1024)} KB`;
  return `${trim(size / (1024 * 1024))} MB`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * "12.4 KB · v3 · 17 Sep" — the tail both places share. The head differs: a
 * card leads with the format, and the artifact's own screen has room for the
 * slug as well, which is the name the agent republishes against.
 */
export function artifactMeta(artifact: ArtifactSummary): string {
  const parts = [bytes(artifact.size)];
  if (artifact.version > 1) parts.push(`v${artifact.version}`);
  parts.push(
    new Date(artifact.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  );
  return parts.join(' · ');
}

/** "markdown · 12.4 KB · v3 · 17 Sep" — the line under a card's name. */
function cardMeta(artifact: ArtifactSummary): string {
  return `${artifact.format} · ${artifactMeta(artifact)}`;
}

export function ArtifactCard({
  artifact,
  onPress,
  menu,
}: {
  artifact: ArtifactSummary;
  onPress: () => void;
  menu?: MenuItem[];
}) {
  const { c } = useTheme();

  const card = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${artifact.title}, ${cardMeta(artifact)}`}
      style={({ pressed }) => ({
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.lg,
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : c.card,
      })}
    >
      <Preview artifact={artifact} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.sm,
            backgroundColor: mix(c.primary, 16),
          }}
        >
          {/* The tab bar's own icon, tinted — a glyph the bundled font lacks
              fails silently, and this bitmap is already in the app. */}
          <Image
            source={require('../../assets/icons/artifacts.png')}
            resizeMode="contain"
            style={{ width: 15, height: 15, tintColor: c.primary }}
          />
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: font.sansMedium }}>
            {artifact.title}
          </Body>
          <Mono numberOfLines={1}>{cardMeta(artifact)}</Mono>
        </View>

        {artifact.shared ? <Tag tone="ok">shared</Tag> : null}
        <Mono style={{ fontSize: 15 }}>›</Mono>
      </View>
    </Pressable>
  );

  if (!menu || menu.length === 0) return card;
  return (
    <OverflowMenu title={artifact.title} items={menu} longPress style={{ alignSelf: 'stretch' }}>
      {card}
    </OverflowMenu>
  );
}

/**
 * The document, small and clipped.
 *
 * `pointerEvents` none for the whole panel: prose is selectable everywhere in
 * this app, and a long press that starts a selection inside a card is a long
 * press that does not open the card or its menu.
 */
function Preview({ artifact }: { artifact: ArtifactSummary }) {
  const { c } = useTheme();
  // A server older than this field sends no preview at all, and a phone on the
  // App Store outlives the server it was built against. An artifact with
  // nothing to show is a case this already has an answer for.
  const preview = artifact.preview ?? '';
  const empty = preview.length === 0;

  return (
    <View
      pointerEvents="none"
      style={{
        height: PREVIEW_HEIGHT,
        overflow: 'hidden',
        justifyContent: empty ? 'center' : 'flex-start',
        alignItems: empty ? 'center' : 'stretch',
        paddingHorizontal: 12,
        paddingTop: empty ? 0 : 10,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: mix(c.muted, 35),
      }}
    >
      {empty ? (
        // Nothing to read: say what it is rather than showing an empty page.
        <Meta>{artifact.format}</Meta>
      ) : artifact.format === 'markdown' ? (
        <Prose>{preview}</Prose>
      ) : (
        <Mono style={{ fontSize: 10.5, lineHeight: 15, color: c.mutedForeground }}>
          {preview}
        </Mono>
      )}
    </View>
  );
}
