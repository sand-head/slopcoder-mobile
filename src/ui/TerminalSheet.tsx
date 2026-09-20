/**
 * The session's terminal, up from the bottom on a shake.
 *
 * Everything else on the session screen is the agent's account of what it did.
 * This is the machine — the same server-held shell the cockpit's drawer
 * attaches to, in the same sandbox, with the same scrollback. It is here for
 * the moment the account stops being enough: a build that says it passed, a
 * file the agent claims it wrote, a process that will not die.
 *
 * Three things shape the layout:
 *
 * - **The cell is measured, not assumed.** Columns come from dividing the
 *   measured width of a run of the mono face by how many characters it was.
 *   Guessing an advance ratio puts the server's idea of the width a column or
 *   two off ours, and every line a program right-aligns lands wrong.
 * - **Rows do not wrap.** The emulator has already decided where lines break,
 *   at the width the PTY was told about. Letting `<Text>` wrap on top of that
 *   double-breaks long lines and puts the grid out of step with the cursor.
 * - **The sheet is dark in both app themes.** A terminal is a terminal.
 * - **The keyboard takes its room out of the grid.** A phone keyboard is half
 *   the screen, and a terminal under one is a terminal you cannot read. The
 *   box shrinks by the keyboard's height instead, so the rows the emulator is
 *   told about are the rows you can see — which is the whole contract the
 *   measured cell above exists to keep.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ScrollViewInstance,
  type TextInputInstance,
  type TextLayoutEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { KEYS } from '../api/terminal';
import { useTerminal, type TerminalStatus } from '../state/terminal';
import { paint, TERMINAL_BACKGROUND, TERMINAL_FOREGROUND } from '../term/palette';
import type { Span } from '../term/emulator';
import { font, radius } from '../theme';

const FONT_SIZE = 11;
const LINE_HEIGHT = 15;

/** The string measured to find one cell's width; long enough to average out rounding. */
const RULER = '0'.repeat(20);

/**
 * How much of the screen the sheet takes, as its only detent.
 *
 * One detent, not a range. A terminal wants every line it can get, and the
 * sheet's other job — getting out of the way — is what the swipe down already
 * does. It is also the height the content is laid out at: TrueSheet hands its
 * child a container whose height depends on the detent, and a percentage height
 * inside that is one more thing to be wrong about on one of two platforms.
 */
const SHEET_FRACTION = 0.85;

/** What the header says, and whether it is worth saying loudly. */
function describe(status: TerminalStatus): { text: string; alarming: boolean } {
  switch (status.kind) {
    case 'connecting':
      return { text: 'connecting…', alarming: false };
    case 'live':
      return { text: 'live', alarming: false };
    case 'exited':
      return { text: 'shell exited', alarming: false };
    case 'closed':
      return { text: 'disconnected', alarming: true };
    case 'error':
      return { text: status.message, alarming: true };
  }
}

export function TerminalSheet({
  visible,
  onClose,
  baseUrl,
  apiKey,
  sessionId,
}: {
  visible: boolean;
  onClose: () => void;
  baseUrl: string | null;
  apiKey: string | null;
  sessionId: string;
}) {
  const sheet = useRef<TrueSheet>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const input = useRef<TextInputInstance>(null);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // The keyboard's height, taken at the start of its rise and the end of its
  // fall rather than every frame: this drives a *layout*, and a layout change
  // here resizes the PTY. Riding the keyboard frame by frame would send the
  // server sixty resizes and reflow the grid on each of them, which is a
  // different and much worse bug than arriving a beat early.
  //
  // Zero unless the sheet is up. The hook is global, so the composer on the
  // session screen behind us would otherwise shrink a terminal nobody has
  // open.
  const rising = useKeyboardState(state => state.height);
  const keyboard = visible ? rising : 0;

  const [cellWidth, setCellWidth] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [pinned, setPinned] = useState(true);

  // The grid, once the face has been measured and the box laid out — and null
  // until then, which is what keeps the socket shut. Attaching before the size
  // is known means the server replays its scrollback broken at the wrong
  // column, and nothing reflows it afterwards.
  const grid = useMemo(
    () =>
      cellWidth > 0 && box.width > 0 && box.height > 0
        ? {
            cols: Math.max(20, Math.floor(box.width / cellWidth)),
            rows: Math.max(6, Math.floor(box.height / LINE_HEIGHT)),
          }
        : null,
    [cellWidth, box.width, box.height],
  );

  const term = useTerminal(baseUrl, apiKey, sessionId, visible, grid);

  useEffect(() => {
    if (visible) void sheet.current?.present().catch(() => {});
    else void sheet.current?.dismiss().catch(() => {});
  }, [visible]);

  const onRuler = useCallback((event: TextLayoutEvent) => {
    const width = event.nativeEvent.lines[0]?.width ?? 0;
    if (width > 0) setCellWidth(width / RULER.length);
  }, []);

  const onBox = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox(current =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, []);

  // Follow the output unless the reader has scrolled back to look at something.
  const onContentSize = useCallback(() => {
    if (pinned) scroll.current?.scrollToEnd({ animated: false });
  }, [pinned]);

  const status = describe(term.status);

  return (
    <TrueSheet
      ref={sheet}
      detents={[SHEET_FRACTION]}
      backgroundColor={TERMINAL_BACKGROUND}
      onDidDismiss={onClose}>
      <View
        style={{
          height: Math.round(window.height * SHEET_FRACTION) - keyboard,
          backgroundColor: TERMINAL_BACKGROUND,
        }}>
        {/* Measured off-screen rather than drawn: this is the ruler, and it
            must use exactly the style the grid uses. */}
        <Text
          onTextLayout={onRuler}
          allowFontScaling={false}
          style={{
            position: 'absolute',
            opacity: 0,
            fontFamily: font.mono,
            fontSize: FONT_SIZE,
          }}>
          {RULER}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: 8,
          }}>
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: font.mono, fontSize: 12, color: TERMINAL_FOREGROUND }}>
            {term.title || 'terminal'}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: status.alarming ? '#fca5a5' : '#8a8178',
            }}>
            {status.text}
          </Text>
        </View>

        {/* A tap on the output raises the keyboard. The `abc` key does the
            same, but nobody goes looking for a key to type with: on a phone you
            tap the thing you mean to type into, and in a terminal that is the
            screen. Not accessible itself — the key row carries the label. */}
        <Pressable accessible={false} style={{ flex: 1 }} onPress={() => input.current?.focus()}>
          <ScrollView
            ref={scroll}
            style={{ flex: 1 }}
            onLayout={onBox}
            onContentSizeChange={onContentSize}
            onScroll={event => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              setPinned(
                contentOffset.y + layoutMeasurement.height >= contentSize.height - LINE_HEIGHT,
              );
            }}
            scrollEventThrottle={32}
            // A tap on the output should not dismiss the keyboard mid-command.
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ paddingHorizontal: 10 }}>
            <Grid
              rows={term.rows}
              cursor={term.cursor}
              cellWidth={cellWidth}
              version={term.version}
            />
          </ScrollView>
        </Pressable>

        <KeyRow
          onKey={term.send}
          onFocusInput={() => input.current?.focus()}
          // With the keyboard up the home indicator is behind it, and the row
          // belongs against the keys.
          bottomInset={keyboard > 0 ? 0 : insets.bottom}
        />

        <HiddenInput ref={input} onText={term.send} />
      </View>
    </TrueSheet>
  );
}

/**
 * The grid.
 *
 * Memoized on the version the emulator bumps: the rows are the same arrays
 * mutated in place, so React has no other way to know whether anything moved.
 */
const Grid = React.memo(
  function TerminalGrid({
    rows,
    cursor,
    cellWidth,
  }: {
    rows: Span[][];
    cursor: { x: number; y: number } | null;
    cellWidth: number;
    /** Only here to drive the memo; the rows themselves never change identity. */
    version: number;
  }) {
    return (
      <View>
        {rows.map((spans, y) => (
          <Line
            key={y}
            spans={spans}
            cursorX={cursor && cursor.y === y ? cursor.x : null}
            cellWidth={cellWidth}
          />
        ))}
      </View>
    );
  },
  (a, b) => a.version === b.version && a.cellWidth === b.cellWidth,
);

/**
 * One row.
 *
 * Memoized by content, which is what makes a repaint cheap: a screenful of
 * output usually changes one line, and the other two hundred should not
 * reconcile because the version number moved. The comparison can be by
 * reference — the emulator reuses one `Style` object for every cell written
 * under the same attributes, so an untouched row flattens to the same strings
 * and the same style objects every time.
 */
const Line = React.memo(LineBody, (a, b) => {
  if (a.cursorX !== b.cursorX || a.cellWidth !== b.cellWidth) return false;
  if (a.spans.length !== b.spans.length) return false;
  return a.spans.every(
    (span, i) => span.text === b.spans[i].text && span.style === b.spans[i].style,
  );
});

function LineBody({
  spans,
  cursorX,
  cellWidth,
}: {
  spans: Span[];
  cursorX: number | null;
  cellWidth: number;
}) {
  const content = useMemo(
    () =>
      spans.map((span, i) => {
        const style = paint(span.style);
        return (
          <Text
            key={i}
            style={{
              color: style.color,
              backgroundColor: style.backgroundColor,
              fontStyle: style.fontStyle,
              textDecorationLine: style.textDecorationLine,
              // Geist Mono ships as static cuts per weight; `fontWeight` does
              // nothing, so bold is a family (see theme.ts).
              fontFamily: style.bold ? font.monoSemiBold : font.mono,
              opacity: style.dim ? 0.65 : 1,
            }}>
            {span.text}
          </Text>
        );
      }),
    [spans],
  );

  return (
    <View>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{
          fontFamily: font.mono,
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
          color: TERMINAL_FOREGROUND,
        }}>
        {content.length > 0 ? content : ' '}
      </Text>
      {cursorX !== null && cellWidth > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: cursorX * cellWidth,
            top: 2,
            width: Math.max(2, cellWidth),
            height: LINE_HEIGHT - 4,
            backgroundColor: TERMINAL_FOREGROUND,
            opacity: 0.55,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The keys a phone keyboard does not have.
 *
 * Ctrl-C is the reason this row exists — interrupting something is most of what
 * anyone wants a terminal on a phone for — and a shell without tab or arrows is
 * a text box, so those come too.
 */
function KeyRow({
  onKey,
  onFocusInput,
  bottomInset,
}: {
  onKey: (text: string) => void;
  onFocusInput: () => void;
  /** The home indicator is inside the sheet, so this row clears it itself. */
  bottomInset: number;
}) {
  const keys: { label: string; send: string }[] = [
    { label: '^C', send: KEYS.ctrlC },
    { label: '^D', send: KEYS.ctrlD },
    { label: 'esc', send: KEYS.escape },
    { label: 'tab', send: KEYS.tab },
    { label: '↑', send: KEYS.up },
    { label: '↓', send: KEYS.down },
    { label: '←', send: KEYS.left },
    { label: '→', send: KEYS.right },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 8 + bottomInset,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
      }}>
      {keys.map(key => (
        <Pressable
          key={key.label}
          onPress={() => onKey(key.send)}
          accessibilityRole="button"
          accessibilityLabel={key.label}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.sm,
            backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
          })}>
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: TERMINAL_FOREGROUND }}>
            {key.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        onPress={onFocusInput}
        accessibilityRole="button"
        accessibilityLabel="Type a command"
        style={({ pressed }) => ({
          minHeight: 34,
          paddingHorizontal: 12,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.sm,
          backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
        })}>
        <Text style={{ fontFamily: font.mono, fontSize: 12, color: TERMINAL_FOREGROUND }}>abc</Text>
      </Pressable>
    </View>
  );
}

/**
 * Where typing comes from.
 *
 * A PTY wants keystrokes, and a phone has no keystrokes — it has an edit
 * buffer, and reports what changed in it. The field is therefore kept holding
 * one character the user cannot delete past: the value grew, so those
 * characters were typed; the value shrank, so that many backspaces were
 * pressed. Without the sentinel, backspace in an empty field is not a change at
 * all and never arrives — and `onKeyPress` does not fill the gap, because
 * Android's soft keyboards mostly do not send it.
 *
 * A plain space, not a zero-width one: the field is a pixel across and
 * invisible, so there is nothing for it to look wrong in, and the bundled mono
 * face has no U+200B — a glyph the font lacks is drawn as nothing, which is
 * fine until the day someone makes this field visible.
 *
 * **It is not fully transparent, and must not be.** A view at zero alpha is not
 * there as far as UIKit is concerned: it cannot become first responder, and
 * since 0.76 React Native's own hit test rejects anything under 0.01 alpha too.
 * `opacity: 0` on a one-pixel field is therefore a keyboard that never comes
 * up, which is what this sheet shipped with. The transparent text colour and
 * hidden caret are what actually make it invisible; the alpha only has to be
 * small enough that a pixel of background does not show through.
 */
const SENTINEL = ' ';

const HiddenInput = React.forwardRef<TextInputInstance, { onText: (text: string) => void }>(
  function TerminalInput({ onText }, ref) {
    const [value, setValue] = useState(SENTINEL);

    const onChangeText = useCallback(
      (next: string) => {
        if (next.length > SENTINEL.length) onText(next.slice(SENTINEL.length));
        else if (next.length < SENTINEL.length) onText('\x7f'.repeat(SENTINEL.length - next.length));
        // Back to the sentinel, so the next edit is measured from the same place.
        setValue(SENTINEL);
      },
      [onText],
    );

    return (
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => onText(KEYS.enter)}
        submitBehavior="submit"
        returnKeyType="send"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        keyboardAppearance="dark"
        accessibilityLabel="Terminal input"
        caretHidden
        // Present but out of the way: it has to be a real, focusable field for
        // the keyboard to come up, and it must never look like the input,
        // because the line the reader is typing on is the one in the grid.
        // One pixel rather than none — a zero-sized view is not focusable on
        // Android, and an invisible field that cannot take focus is a terminal
        // that cannot be typed into. See the note above about the alpha.
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0.02,
          color: 'transparent',
          padding: 0,
        }}
      />
    );
  },
);
