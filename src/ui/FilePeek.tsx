/**
 * What a file read returned, in the transcript and in a sheet.
 *
 * In the transcript a read stays one line until tapped, as every card does;
 * the tap shows the first {@link PREVIEW_LINES} lines and, when there is more,
 * a row that opens the sheet. The sheet is the whole of what the read
 * returned — exactly the text the model saw, which is all the server keeps —
 * with the path as its title, in monospace, selectable, scrolling both ways.
 *
 * Nothing is fetched: the text is the transcript's own, so the sheet works
 * offline and shows no more of a file than the cockpit does.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { FilePeek } from '../api/toolcard';
import { Sheet } from './Sheet';
import { font, mix, radius, useTheme } from '../theme';

export const PREVIEW_LINES = 12;
/** A preview of very long lines is still a preview: cap its characters too. */
export const PREVIEW_CHARS = 1600;

export function previewOf(text: string): { text: string; cut: boolean } {
  const lines = text.split('\n');
  let shown = lines.slice(0, PREVIEW_LINES).join('\n');
  let cut = lines.length > PREVIEW_LINES;
  if (shown.length > PREVIEW_CHARS) {
    shown = shown.slice(0, PREVIEW_CHARS);
    cut = true;
  }
  return { text: shown, cut };
}

function mono(color: string) {
  return { fontFamily: font.mono, fontSize: 11.5, lineHeight: 17, color } as const;
}

/** The expanded Read card: a capped preview, and the way to the rest. */
export function FilePeekPreview({ peek }: { peek: FilePeek }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => previewOf(peek.text), [peek.text]);
  const lines = useMemo(() => peek.text.split('\n').length, [peek.text]);

  return (
    <View style={{ gap: 4 }}>
      <Pressable
        testID="file-peek-preview"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Preview of ${peek.path}`}
        accessibilityHint="Opens the whole read"
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: pressed ? mix(c.mutedForeground, 10) : mix(c.muted, 30),
          borderRadius: radius.md,
          paddingHorizontal: 8,
          paddingVertical: 6,
          overflow: 'hidden',
        })}>
        {/* One row per source line, clipped at the edge rather than wrapped: a
            wrapped long line ate the whole preview on a phone (seen on device),
            and code reads by its columns. The sheet scrolls sideways for the rest. */}
        {preview.text.split('\n').map((line, index) => (
          <Text key={index} numberOfLines={1} ellipsizeMode="clip" style={mono(c.foreground)}>
            {line.length > 0 ? line : ' '}
          </Text>
        ))}
      </Pressable>
      <Pressable
        testID="file-peek-open"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${peek.path}, ${lines} ${lines === 1 ? 'line' : 'lines'}`}
        hitSlop={8}>
        <Text style={{ ...mono(c.mutedForeground), fontSize: 11 }}>
          {preview.cut ? `open all ${lines} lines >` : 'open >'}
        </Text>
      </Pressable>
      {open ? <FilePeekSheet peek={peek} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** The sheet itself, mounted only while open so a long run carries none of them. */
export function FilePeekSheet({ peek, onClose }: { peek: FilePeek; onClose: () => void }) {
  const { c } = useTheme();
  return (
    <Sheet visible title={peek.path} onClose={onClose}>
      {peek.facets.length > 0 ? (
        <Text style={{ ...mono(c.mutedForeground), fontSize: 11 }}>{peek.facets.join(' · ')}</Text>
      ) : null}
      <View
        style={{
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: mix(c.muted, 30),
          borderRadius: radius.md,
        }}>
        {/* Columns kept: code is not prose, and wrapping it loses indentation. */}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ padding: 10 }}>
          <Text testID="file-peek-text" selectable accessibilityLabel={`Contents of ${peek.path}`} style={mono(c.foreground)}>
            {peek.text}
          </Text>
        </ScrollView>
      </View>
    </Sheet>
  );
}
