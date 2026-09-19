/**
 * The grammar the settings pages share.
 *
 * Every page under Settings is one of two shapes: a list of rows, each with a
 * switch or a chevron and a long-press menu; or a form, with labelled fields
 * down the page and Save in the bar. These are the pieces both are built from,
 * so ten pages read as one place rather than ten.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Body, Check, Field, Hint, Meta, Mono, Skeleton } from './kit';
import { OverflowMenu, type MenuItem } from './menu';
import { ConnectionBanner } from './ConnectionBanner';
import { font, mix, radius, useTheme } from '../theme';
import { KEYBOARD_GAP } from './keyboard';

/**
 * Load once, again whenever the page is focused (an editor over it may have
 * changed things), and on a pull. The page keeps what it has through a failed
 * reload: the error is a line at the top, not an emptied screen.
 */
export function useFocusLoad<T>(
  navigation: { addListener: (event: 'focus', cb: () => void) => () => void },
  load: (() => Promise<T>) | null,
): {
  data: T | null;
  error: string | null;
  refreshing: boolean;
  reload: () => Promise<void>;
  refresh: () => void;
  /** Replace what is shown without a round trip, for an optimistic flip. */
  set: (next: T | null) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const run = loadRef.current;
    if (!run) return;
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return navigation.addListener('focus', () => void reload());
  }, [navigation, reload]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void reload();
  }, [reload]);

  return { data, error, refreshing, reload, refresh, set: setData };
}

/**
 * A settings page's scroll view. Returned as the screen's root so UIKit finds
 * it (see `rootPageOptions`); the banner and any error come first inside it.
 */
export function SettingsPage({
  children,
  refreshing,
  onRefresh,
  error,
  loading,
  keyboard,
}: {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  error?: string | null;
  /** True until the first answer lands: rows are skeletons, not absent. */
  loading?: boolean;
  /** A page with fields wants taps to land while the keyboard is up. */
  keyboard?: boolean;
}) {
  const { c } = useTheme();
  return (
    <KeyboardAwareScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}
      keyboardShouldPersistTaps={keyboard ? 'handled' : undefined}
      keyboardDismissMode={keyboard ? 'interactive' : undefined}
      // Scrolls the field being typed in clear of the keyboard, and only when
      // the keyboard would actually cover it — see ui/keyboard.ts for what the
      // prop this replaced did instead. Layout mode keeps the scroll view
      // unwrapped, where the large title can find it.
      enabled={keyboard}
      bottomOffset={KEYBOARD_GAP}
      mode="layout"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.mutedForeground} /> : undefined
      }>
      <ConnectionBanner onRetry={onRefresh} />
      {error ? <Problem>{error}</Problem> : null}
      {loading ? <Skeleton rows={3} /> : children}
    </KeyboardAwareScrollView>
  );
}

/** An error, in place, said aloud by a screen reader. */
export function Problem({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
      {children}
    </Body>
  );
}

/**
 * "valid JSON with 3 handlers" under a drawn tick, or "Invalid: …" in red —
 * the web's check-note. The tick is drawn because Geist Mono has none.
 */
export function Note({ children, ok }: { children: string; ok: boolean }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={ok ? `ok: ${children}` : children} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {ok ? <Check color={theme.status.ok} size={12} /> : null}
      <Body
        accessibilityLiveRegion="polite"
        style={{ flex: 1, fontFamily: font.mono, fontSize: 11.5, color: ok ? theme.status.ok : theme.c.destructive }}>
        {children}
      </Body>
    </View>
  );
}

/** A labelled section with hairline rows under it. */
export function Section({
  label,
  count,
  children,
  trailing,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 6 }}>
        <Meta style={{ flex: 1 }}>
          {label}
          {count === undefined ? '' : ` · ${count}`}
        </Meta>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** A small uppercase tag: a transport, a provider, a key's origin. */
export function Tag({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'warn' | 'ok' }) {
  const theme = useTheme();
  const { c } = theme;
  const color = tone === 'warn' ? c.destructive : tone === 'ok' ? theme.status.ok : c.mutedForeground;
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radius.sm,
        backgroundColor: mix(color, 14),
      }}>
      <Meta style={{ color, fontSize: 10 }}>{children}</Meta>
    </View>
  );
}

/**
 * One row of a settings list: a title, a line under it, and on the right a
 * switch, a chevron, or nothing. A long press opens the row's menu, which is
 * where edit and remove live — a phone has no hover, and a row of link
 * buttons is a table's idea of actions.
 */
export function ListRow({
  title,
  subtitle,
  tag,
  tagTone,
  warn,
  onPress,
  menu,
  menuTitle,
  switchValue,
  onSwitch,
  disabled,
  dimmed,
  chevron,
  children,
}: {
  title: string;
  subtitle?: string;
  tag?: string;
  tagTone?: 'muted' | 'warn' | 'ok';
  /** A red line under the subtitle: a last error, a missing credential. */
  warn?: string | null;
  onPress?: () => void;
  menu?: MenuItem[];
  menuTitle?: string;
  switchValue?: boolean;
  onSwitch?: (on: boolean) => void;
  disabled?: boolean;
  /** Painted at half strength: a disabled connection, a paused server. */
  dimmed?: boolean;
  chevron?: boolean;
  children?: React.ReactNode;
}) {
  const { c } = useTheme();
  const body = (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : 'transparent',
        opacity: dimmed ? 0.55 : 1,
      })}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Body numberOfLines={1} style={{ fontSize: 14.5, fontFamily: font.sansMedium, flexShrink: 1 }}>
            {title}
          </Body>
          {tag ? <Tag tone={tagTone}>{tag}</Tag> : null}
        </View>
        {subtitle ? <Mono numberOfLines={2}>{subtitle}</Mono> : null}
        {warn ? (
          <Mono numberOfLines={2} style={{ color: c.destructive }}>
            {warn}
          </Mono>
        ) : null}
        {children}
      </View>
      {onSwitch ? (
        <Switch
          value={!!switchValue}
          disabled={disabled}
          accessibilityLabel={`${title} enabled`}
          onValueChange={onSwitch}
          trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
        />
      ) : null}
      {chevron ? <Mono style={{ fontSize: 15 }}>›</Mono> : null}
    </Pressable>
  );

  if (!menu || menu.length === 0) return body;
  return (
    <OverflowMenu title={menuTitle ?? title} items={menu} longPress style={{ alignSelf: 'stretch' }}>
      {body}
    </OverflowMenu>
  );
}

/** A `…` at the end of a row that opens the same menu a long press does. */
export function RowMenuButton({ title, items }: { title: string; items: MenuItem[] }) {
  const { c } = useTheme();
  return (
    <OverflowMenu title={title} items={items}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${title}`}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <Mono style={{ fontSize: 16, color: c.foreground }}>…</Mono>
      </View>
    </OverflowMenu>
  );
}

/** The row a hub list is made of: a name, a count on the right, a chevron. */
export function HubRow({ label, count, onPress }: { label: string; count?: string | null; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : 'transparent',
      })}>
      <Body style={{ flex: 1, fontSize: 15 }}>{label}</Body>
      {count ? <Mono>{count}</Mono> : null}
      <Mono style={{ fontSize: 15 }}>›</Mono>
    </Pressable>
  );
}

/** A labelled text field with an optional line of help under it. */
export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  secure,
  mono,
  keyboardType,
  autoCapitalize = 'none',
  editable = true,
  accessibilityLabel,
  returnKeyType,
  onSubmitEditing,
  autoFocus,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  secure?: boolean;
  /** Hosts, tokens, topics: read as typed, in mono. */
  mono?: boolean;
  keyboardType?: 'default' | 'url' | 'email-address' | 'numbers-and-punctuation';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  accessibilityLabel?: string;
  returnKeyType?: 'done' | 'next' | 'go';
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 6 }, style]}>
      <Meta>{label}</Meta>
      <Field
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secure={secure}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={accessibilityLabel ?? label}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        autoFocus={autoFocus}
        style={[mono ? { fontFamily: font.mono, fontSize: 14 } : null, !editable ? { opacity: 0.55 } : null]}
      />
      {hint ? typeof hint === 'string' ? <Hint>{hint}</Hint> : hint : null}
    </View>
  );
}

/** A multi-line box in mono: a document, a key, a list of arguments. */
export function CodeBox({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  minHeight = 160,
  editable = true,
  accessibilityLabel,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  minHeight?: number;
  editable?: boolean;
  accessibilityLabel?: string;
  autoFocus?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Meta>{label}</Meta> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        multiline
        textAlignVertical="top"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        editable={editable}
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel ?? label}
        style={{
          minHeight,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: radius.md,
          padding: 12,
          fontFamily: font.mono,
          // 16px or iOS zooms on focus; mono at 13 reads as a document.
          fontSize: 13,
          lineHeight: 19,
          color: c.foreground,
          backgroundColor: c.background,
          opacity: editable ? 1 : 0.55,
        }}
      />
      {hint ? typeof hint === 'string' ? <Hint>{hint}</Hint> : hint : null}
    </View>
  );
}

/** A label, the current choice, and a chevron: a row that opens a sheet. */
export function ChoiceRow({
  label,
  value,
  onPress,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: c.input,
          borderRadius: radius.md,
          backgroundColor: pressed ? mix(c.mutedForeground, 8) : c.background,
          opacity: disabled ? 0.6 : 1,
        })}>
        <Meta>{label}</Meta>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 15, textAlign: 'right' }}>
          {value}
        </Body>
        <Mono style={{ fontSize: 13 }}>›</Mono>
      </Pressable>
      {hint ? <Hint>{hint}</Hint> : null}
    </View>
  );
}

/** A switch with its sentence beside it. */
export function SwitchRow({
  label,
  detail,
  value,
  onChange,
  disabled,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Body style={{ fontSize: 14 }}>{label}</Body>
        {detail ? <Mono>{detail}</Mono> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        accessibilityLabel={label}
        onValueChange={onChange}
        trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
      />
    </View>
  );
}

/** A line of mono the reader may want to take off the phone, boxed. */
export function CopyBox({ label, value }: { label?: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Meta>{label}</Meta> : null}
      <View
        style={{
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: radius.md,
          backgroundColor: mix(c.muted, 40),
          padding: 12,
        }}>
        <Mono selectable style={{ color: c.foreground, fontSize: 12.5, lineHeight: 18 }}>
          {value}
        </Mono>
      </View>
    </View>
  );
}

/** A small spinner beside a label while a row's command is in flight. */
export function Busy({ on }: { on: boolean }) {
  const { c } = useTheme();
  return on ? <ActivityIndicator size="small" color={c.mutedForeground} /> : null;
}

/** The page's foot when the server has nothing to list. */
export function Empty({ children }: { children: string }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <Hint>{children}</Hint>
    </View>
  );
}

/** The bar's Save/Add on Android, where there is no native bar item to use. */
export function BarText({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
      <Body style={{ color: c.primary, fontSize: 15, fontFamily: font.sansMedium, opacity: disabled ? 0.4 : 1 }}>{label}</Body>
    </Pressable>
  );
}
