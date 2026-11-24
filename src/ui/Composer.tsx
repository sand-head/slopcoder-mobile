/**
 * The prompt line, shared by the launcher and the cockpit — as on the web,
 * where one `PromptLine` serves both.
 *
 * Structure follows `Ui/PromptLine.razor`: a card holding the glyph and the
 * input, then a line underneath carrying the turn's options on the left and the
 * action on the right. The web hides every dial that is at its default and puts
 * the rest behind a sliders menu; on a phone the model is worth showing always,
 * because it is the one a person changes and there is no hover to discover it
 * with.
 *
 * Stop is its own control. It used to be what the send button became when the
 * box was empty during a turn, on the grounds that Enter could then never
 * reach it by accident — a keyboard's problem, and there is no Enter on a
 * phone. Here a running turn shows a square beside the arrow, whatever is in
 * the box, so stopping never means clearing a steer you were about to send.
 *
 * Images ride the next prompt as inline attachments, as they do on the web,
 * where they are pasted; here they come from the photo library or the camera
 * through the `+` menu, which is the platform's own menu rather than a sheet.
 *
 * A slash in an empty box opens the session's commands over the card. The web
 * puts the same list in a popover under the input; the phone has the keyboard
 * where that popover would go, so it grows upward instead — see `SlashMenu`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  ApprovalMode,
  GitServiceKind,
  type ThinkingLevel,
  type FacetOption,
  type ModelCandidate,
  type ModelSelection,
  type SlashCommandInfo,
} from '../api/contracts';
import { Body, GlassSurface, GitMark, Meta, Mono, SendButton, Sliders } from './kit';
import { OverflowMenu, type MenuItem } from './menu';
import { Sheet, SheetGroup, SheetMultiGroup, SheetSegments } from './Sheet';
import { MAX_IMAGES, type ImageSource, type PendingImage } from './images';
import { useConnection } from '../state/connection';
import { Field } from './kit';
import { kindFromUrl, offer, shouldSearch } from '../api/repoPicker';
import { commandPrefix, matchCommands } from '../api/slash';
import { findCandidate, levelKey, levelLabel, offeredLevels, orderModels, runsAs } from '../api/models';
import { tapSelect } from './haptics';
import { font, mix, radius, useTheme } from '../theme';

/** A repository or a node the next turn should have. */
export interface AttachOption {
  key: string;
  label: string;
  description?: string;
  /** Which forge a repository row came from; picks the mark beside the name. */
  kind?: GitServiceKind | null;
}

/**
 * What the web's `+ add` chip offers. Owned by the composer rather than each
 * screen, so the launcher and the create screen behave identically.
 */
export interface Attachments {
  repos: string[];
  nodes: string[];
  recentRepos: AttachOption[];
  /** The caller's own repositories, across every connected forge. */
  ownedRepos: AttachOption[];
  /** False until they have arrived, which is not the same as having none. */
  ownedLoaded: boolean;
  /** What could not be listed. A half-failed fan-out must not read as a short list. */
  ownedError?: string | null;
  availableNodes: AttachOption[];
  searchRepos: (query: string) => Promise<AttachOption[]>;
  onChange: (next: { repos: string[]; nodes: string[] }) => void;
}

/**
 * The images waiting on the next prompt, and the two ways to add one. The
 * composer draws them and asks; the screen owns the list, because what
 * happens to it on send differs — the launcher clears it, the cockpit keeps
 * it back when the text went out as a steer.
 */
export interface ComposerImages {
  pending: PendingImage[];
  onPick: (source: ImageSource) => void;
  onRemove: (key: string) => void;
  /** Why the last pick fell short, or null. Cleared by the screen on the next pick. */
  error: string | null;
}

/**
 * The session's slash commands, and how to get them.
 *
 * Only the cockpit has these: a command runs against a session, and the
 * launcher has none yet. The list arrives from the server rather than being
 * hard-coded, because each attached repository may define its own templates in
 * `.slopcoder/commands/*.md` — so what `/` offers differs session to session.
 */
export interface ComposerCommands {
  /** Every command on offer; empty until they have been fetched. */
  list: SlashCommandInfo[];
  /**
   * Called when a slash opens the menu, so the screen can refresh the list —
   * once per opening, not once per keystroke. What the sandbox can list grows
   * as the session's repositories land, so the answer at open is not the
   * answer half an hour later.
   */
  onNeeded: () => void;
}

export interface TurnOptions {
  selection: ModelSelection;
  thinking: ThinkingLevel | null;
  approval: ApprovalMode;
  facet: string | null;
}

const APPROVALS: { key: string; label: string; description: string; value: ApprovalMode }[] = [
  {
    key: 'dangerous',
    label: 'Dangerous only',
    description: 'Asks only for what the classifier escalates',
    value: ApprovalMode.Dangerous,
  },
  { key: 'auto', label: 'Never ask', description: 'Nothing will block waiting for you', value: ApprovalMode.Auto },
  { key: 'always', label: 'Always ask', description: 'Every tool call waits', value: ApprovalMode.Always },
];

export function Composer({
  value,
  onChangeValue,
  placeholder,
  action,
  onAction,
  busy,
  disabled,
  running,
  onStop,
  stopping,
  options,
  onChangeOptions,
  models,
  routed,
  facets,
  attachments,
  images,
  commands,
  sessionStatus,
  onJumpLatest,
  onJumpStatus,
  launcher = false,
}: {
  launcher?: boolean;
  value: string;
  onChangeValue: (next: string) => void;
  placeholder: string;
  /** Send, Steer, Stop or Start — the label is the meaning. */
  action: string;
  onAction: () => void;
  busy?: boolean;
  disabled?: boolean;
  running?: boolean;
  /** Offered while a turn runs; the square beside the arrow. */
  onStop?: () => void;
  /** The stop has been asked for and the harness has not yet answered. */
  stopping?: boolean;
  options: TurnOptions;
  onChangeOptions: (next: TurnOptions) => void;
  models: ModelCandidate[];
  /**
   * The model an Auto session last routed to. The picker still says Auto, but
   * the thinking dial is about a real model, and this is it. Omitted by the
   * launcher, where Auto has not routed anything yet.
   */
  routed?: { connectionId?: string | null; modelId?: string | null } | null;
  facets: FacetOption[];
  /** Omitted by the cockpit: a running session's workspace is already set. */
  attachments?: Attachments;
  /** Omitted where a prompt cannot carry an image. */
  images?: ComposerImages;
  /** Omitted by the launcher: a command needs a session to run against. */
  commands?: ComposerCommands;
  /** Real live status supplied by the session, absent on the launcher. */
  sessionStatus?: string;
  onJumpLatest?: () => void;
  onJumpStatus?: () => void;
}) {
  const { c } = useTheme();
  const reachable = useConnection(s => s.reachable);
  const [sheet, setSheet] = useState<'model' | 'turn' | 'attach' | null>(null);

  const current = options.selection.auto
    ? null
    : findCandidate(models, options.selection.connectionId, options.selection.modelId);
  const modelLabel = options.selection.auto ? 'Auto' : current?.modelDisplayName ?? 'Model';
  // Provider, then tier, then newest first — the web picker's order.
  const ordered = useMemo(() => orderModels(models), [models]);

  // The dial offers what the model offers. A pick the model doesn't take is
  // shown as what it runs as (Off on a model that always thinks is Low), the
  // way the providers will send it. Unknown — Auto before it has routed —
  // offers everything.
  const caps = options.selection.auto
    ? findCandidate(models, routed?.connectionId, routed?.modelId)
    : current;
  const offered = offeredLevels(caps);
  const shownThinking = options.thinking === null ? null : runsAs(options.thinking, caps);
  const thinkingLabel = shownThinking === null ? 'Auto' : levelLabel(shownThinking, caps);
  const approvalLabel = APPROVALS.find(a => a.value === options.approval)?.label ?? '';

  // The `+` is one button whatever it offers: the platform's menu when images
  // are on the table, the attach sheet straight away when only the workspace is.
  const addItems: MenuItem[] = images
    ? [
        {
          key: 'library',
          title: 'Photo Library',
          symbol: 'photo.on.rectangle',
          onPress: () => images.onPick('library'),
        },
        { key: 'camera', title: 'Take Photo', symbol: 'camera', onPress: () => images.onPick('camera') },
        ...(attachments
          ? [
              {
                key: 'workspace',
                title: 'Repositories & nodes',
                symbol: 'folder',
                onPress: () => setSheet('attach'),
              },
            ]
          : []),
      ]
    : [];

  const addButton =
    attachments || images ? (
      <IconButton
        onPress={() => (images ? undefined : setSheet('attach'))}
        accessibilityLabel="Attach">
        <Body
          style={{
            fontFamily: font.mono,
            fontSize: 17,
            lineHeight: 17,
            color: c.mutedForeground,
          }}>
          +
        </Body>
      </IconButton>
    ) : null;

  return (
    <View style={{ gap: 8 }}>
      {commands ? (
        <SlashMenu
          commands={commands}
          draft={value}
          onPick={name => {
            tapSelect();
            onChangeValue(`/${name} `);
          }}
        />
      ) : null}
      <GlassSurface
        cornerRadius={radius.xl}
        style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 8 }}>
        {sessionStatus ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {onJumpStatus ? (
              <Pressable onPress={onJumpStatus} accessibilityRole="button"
                accessibilityLabel={`${sessionStatus}. Jump to current request`} style={{ flex: 1 }}>
                <Mono style={{ color: c.mutedForeground }}>{sessionStatus}</Mono>
              </Pressable>
            ) : <Mono style={{ flex: 1, color: c.mutedForeground }}>{sessionStatus}</Mono>}
            {onJumpLatest ? (
              <IconButton onPress={onJumpLatest} accessibilityLabel="Jump to the latest">
                <Body style={{ color: c.foreground, fontSize: 17 }}>↓</Body>
              </IconButton>
            ) : null}
          </View>
        ) : null}
        {(attachments && (attachments.repos.length > 0 || attachments.nodes.length > 0)) || (images && images.pending.length > 0) ? (
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}
            accessibilityLabel="Selected context" contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {attachments ? <AttachChips attachments={attachments} /> : null}
            {images ? <ImageChips images={{ ...images, error: null }} /> : null}
          </ScrollView>
        ) : null}
        {images?.error ? <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 12 }}>{images.error}</Body> : null}
        <TextInput
          value={value}
          onChangeText={onChangeValue}
          placeholder={reachable ? placeholder : 'Offline'}
          placeholderTextColor={c.mutedForeground}
          multiline
          autoCapitalize="sentences"
          accessibilityLabel={placeholder}
          style={{ minHeight: launcher ? 72 : 42, maxHeight: launcher ? undefined : 192, paddingTop: 4, paddingBottom: 4,
            fontSize: 16, lineHeight: 22, fontFamily: font.sans, color: c.foreground,
            backgroundColor: 'transparent' }}
        />

        {/* One line, never wrapped: icons on the left, the action on the
            right, and between them the dials that are off their defaults.
            Those scroll sideways when they will not fit, rather than pushing
            the send button onto a second row. */}
        <View testID="composer-toolbar" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {images && addButton ? (
            <OverflowMenu title="Attach" items={addItems}>
              {addButton}
            </OverflowMenu>
          ) : (
            addButton
          )}
          <IconButton onPress={() => setSheet('turn')} accessibilityLabel="Turn settings">
            <Sliders color={c.mutedForeground} />
          </IconButton>
          <ScrollView
            testID="composer-dials"
            horizontal
            style={{ flex: 1 }}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
            {/* The launcher's model starts at Auto and says so only once it is not. */}
            {!launcher || !options.selection.auto ? (
              <Pill label={modelLabel} onPress={() => setSheet('model')} muted={launcher} />
            ) : null}
            {/* Dials appear only when off default, as on the web. */}
            {options.thinking !== null ? <Pill label={thinkingLabel} onPress={() => setSheet('turn')} muted /> : null}
            {options.approval !== ApprovalMode.Dangerous ? (
              <Pill label={approvalLabel} onPress={() => setSheet('turn')} muted />
            ) : null}
          </ScrollView>
          {running && onStop ? (
            <SendButton
              mode="stop"
              onPress={onStop}
              busy={stopping}
              disabled={!reachable}
              accessibilityLabel={stopping ? 'Stopping' : 'Stop'}
            />
          ) : null}
          <SendButton
            mode="send"
            onPress={onAction}
            busy={busy}
            // Nothing to send into a server that is not answering, and a queued
            // send that silently fails is worse than a button that says no.
            disabled={disabled || !reachable}
            accessibilityLabel={action}
          />
        </View>
      </GlassSurface>

      <Sheet visible={sheet === 'model'} title="Select model" onClose={() => setSheet(null)}>
        <SheetGroup
          options={[
            { key: 'auto', label: 'Auto', description: 'Let the router pick per turn' },
            // Keyed by connection as well as id: the same model listed by two
            // connections is two rows, and picking one must not pick the other.
            ...ordered.map(m => ({
              key: modelKey(m.connectionId, m.modelId),
              label: m.modelDisplayName || m.modelId,
              description: m.connectionName,
            })),
          ]}
          selected={
            options.selection.auto
              ? 'auto'
              : current
                ? modelKey(current.connectionId, current.modelId)
                : 'auto'
          }
          onSelect={key => {
            const picked = models.find(m => modelKey(m.connectionId, m.modelId) === key);
            onChangeOptions({
              ...options,
              selection: picked
                ? { auto: false, connectionId: picked.connectionId, modelId: picked.modelId }
                : { auto: true, connectionId: null, modelId: null },
            });
            setSheet(null);
          }}
        />
        {models.length === 0 ? <Mono>No providers connected yet.</Mono> : null}
      </Sheet>

      <Sheet visible={sheet === 'turn'} title="Turn settings" onClose={() => setSheet(null)}>
        {launcher ? <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${modelLabel}`}
          onPress={() => setSheet('model')} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Body>Model: {modelLabel} ›</Body>
        </Pressable> : null}
        <SheetSegments
          label="thinking"
          options={[
            { key: 'auto', label: 'Auto' },
            ...offered.map(level => ({ key: levelKey(level), label: levelLabel(level, caps) })),
          ]}
          selected={shownThinking === null ? 'auto' : levelKey(shownThinking)}
          onSelect={key =>
            onChangeOptions({
              ...options,
              thinking: offered.find(level => levelKey(level) === key) ?? null,
            })
          }
        />
        <SheetGroup
          label="approvals"
          options={APPROVALS.map(a => ({ key: a.key, label: a.label, description: a.description }))}
          selected={APPROVALS.find(a => a.value === options.approval)?.key ?? 'dangerous'}
          onSelect={key =>
            onChangeOptions({
              ...options,
              approval: APPROVALS.find(a => a.key === key)?.value ?? ApprovalMode.Dangerous,
            })
          }
        />
        {facets.length > 0 ? (
          <SheetGroup
            label="facet"
            options={[
              { key: '', label: 'Default' },
              ...facets.map(f => ({ key: f.name, label: f.name, description: f.description ?? undefined })),
            ]}
            selected={options.facet ?? ''}
            onSelect={key => onChangeOptions({ ...options, facet: key === '' ? null : key })}
          />
        ) : null}
      </Sheet>

      {attachments ? (
        <AttachSheet visible={sheet === 'attach'} onClose={() => setSheet(null)} attachments={attachments} />
      ) : null}
    </View>
  );
}

/**
 * The commands on offer, over the composer, while a slash is being typed.
 *
 * A menu rather than the web's popover: on a phone the composer already sits
 * on the keyboard, so the only room is upward, and a list that grows off the
 * top of the card is what every native picker does there. It is its own
 * surface, not a lid on the composer — the composer is glass and a taller
 * glass card would refract the transcript differently as it grew.
 *
 * The keyboard stays up through a tap (`keyboardShouldPersistTaps`), which is
 * not a nicety: without it the first tap only dismisses the keyboard and the
 * command is never picked.
 */
function SlashMenu({
  commands,
  draft,
  onPick,
}: {
  commands: ComposerCommands;
  draft: string;
  onPick: (name: string) => void;
}) {
  const { c } = useTheme();
  const prefix = commandPrefix(draft);
  const wanted = prefix !== null;

  // Once per opening: the effect runs on the edge where the menu appears, not
  // on every keystroke inside it.
  const ask = commands.onNeeded;
  useEffect(() => {
    if (wanted) ask();
  }, [wanted, ask]);

  if (prefix === null) return null;

  const matches = matchCommands(commands.list, prefix);
  // Nothing matched: the prefix is a typo, or the list has not arrived yet.
  // Either way an empty card would only be in the way of the transcript.
  if (matches.length === 0) return null;

  return (
    <GlassSurface cornerRadius={radius.xl} style={{ maxHeight: 240, overflow: 'hidden' }}>
      <ScrollView
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        contentContainerStyle={{ paddingVertical: 6 }}
      >
        {matches.map(command => (
          <Pressable
            key={command.name}
            onPress={() => onPick(command.name)}
            accessibilityRole="button"
            accessibilityLabel={`/${command.name}`}
            accessibilityHint={command.help}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 9,
              gap: 2,
              backgroundColor: pressed ? mix(c.mutedForeground, 14) : 'transparent',
            })}
          >
            <Mono style={{ fontSize: 14, color: c.primary }}>/{command.name}</Mono>
            {command.help ? (
              <Body numberOfLines={1} style={{ fontSize: 12.5, color: c.mutedForeground }}>
                {command.help}
              </Body>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </GlassSurface>
  );
}

/**
 * The `+ add` sheet: repositories to clone into the workspace, nodes the
 * turn may shell into. The launcher's, and the routine editor's — a routine
 * grants exactly what a session attaches, so it is the same picker with the
 * same search and the same wording.
 */
export function AttachSheet({
  visible,
  onClose,
  attachments,
  nodeDescription,
}: {
  visible: boolean;
  onClose: () => void;
  attachments: Attachments;
  /** What granting a node means here; the editor's runs are unattended. */
  nodeDescription?: string;
}) {
  const { c } = useTheme();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<AttachOption[]>([]);
  const [searching, setSearching] = useState(false);

  const owned = attachments.ownedRepos;
  const willSearch = shouldSearch(owned, query, attachments.ownedLoaded);

  // The one call here that leaves the device, and the only one worth waiting
  // for the typing to stop. It runs when nothing of yours matched — see
  // `repoPicker.ts` for why that is the condition rather than the query alone.
  useEffect(() => {
    setFound([]);
    if (!willSearch) {
      setSearching(false);
      return;
    }

    setSearching(true);
    let live = true;
    const timer = setTimeout(() => {
      void attachments
        .searchRepos(query.trim())
        .then(rows => live && setFound(rows))
        .finally(() => live && setSearching(false));
    }, 300);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [attachments, query, willSearch]);

  const offered = offer({
    query,
    recent: attachments.recentRepos,
    owned,
    found,
    searching,
  });

  return (
    <Sheet visible={visible} title="Attach" onClose={onClose}>
      <Field value={query} onChangeText={setQuery} placeholder="Search repositories…" />
      {/* A forge that failed to answer would otherwise look like a forge
          with nothing on it. */}
      {attachments.ownedError ? (
        <Mono style={{ color: c.destructive }}>{attachments.ownedError}</Mono>
      ) : null}
      <SheetMultiGroup
        label={offered.label}
        options={offered.options}
        selected={attachments.repos}
        onToggle={key =>
          attachments.onChange({
            repos: attachments.repos.includes(key)
              ? attachments.repos.filter(r => r !== key)
              : [...attachments.repos, key],
            nodes: attachments.nodes,
          })
        }
        empty={offered.empty}
      />
      <SheetMultiGroup
        label="remote nodes"
        options={
          nodeDescription
            ? attachments.availableNodes.map(n => ({ ...n, description: nodeDescription }))
            : attachments.availableNodes
        }
        selected={attachments.nodes}
        onToggle={key =>
          attachments.onChange({
            repos: attachments.repos,
            nodes: attachments.nodes.includes(key)
              ? attachments.nodes.filter(n => n !== key)
              : [...attachments.nodes, key],
          })
        }
      />
    </Sheet>
  );
}

/**
 * What is attached, and nothing else — adding is the `+` inside the card.
 * Absent entirely when there is nothing, so an empty composer stays empty
 * rather than carrying a row that only ever said "add".
 */
export function AttachChips({ attachments }: { attachments: Attachments }) {
  const { c } = useTheme();

  const picked = [
    ...attachments.repos.map(url => ({
      key: url,
      label: attachments.recentRepos.find(r => r.key === url)?.label ?? shortRepo(url),
      kind: attachments.recentRepos.find(r => r.key === url)?.kind ?? kindFromUrl(url),
      drop: () =>
        attachments.onChange({
          repos: attachments.repos.filter(r => r !== url),
          nodes: attachments.nodes,
        }),
    })),
    ...attachments.nodes.map(id => ({
      key: id,
      label: attachments.availableNodes.find(n => n.key === id)?.label ?? 'node',
      kind: undefined,
      drop: () =>
        attachments.onChange({
          repos: attachments.repos,
          nodes: attachments.nodes.filter(n => n !== id),
        }),
    })),
  ];

  if (picked.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {picked.map(chip => (
        <Pressable
          key={chip.key}
          onPress={chip.drop}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${chip.label}`}
          style={{
            height: 28,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            borderRadius: 9999,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.card,
          }}>
          {chip.kind !== undefined ? (
            <GitMark
              kind={chip.kind}
              color={chip.kind == null ? c.mutedForeground : c.foreground}
              size={12}
            />
          ) : null}
          <Mono numberOfLines={1} style={{ fontSize: 11.5, color: c.foreground, maxWidth: 160 }}>
            {chip.label}
          </Mono>
          <Mono style={{ fontSize: 12 }}>×</Mono>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The images going with the next prompt, as thumbnails; a tap drops one, as
 * with the workspace chips. Under them, in one line, what the last pick
 * refused and why — the cap, the size, a file that was not an image.
 */
export function ImageChips({ images }: { images: ComposerImages }) {
  const { c } = useTheme();

  if (images.pending.length === 0 && !images.error) return null;

  return (
    <View style={{ gap: 6 }}>
      {images.pending.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {images.pending.map((image, index) => (
            <Pressable
              key={image.key}
              onPress={() => images.onRemove(image.key)}
              accessibilityRole="button"
              accessibilityLabel={`Remove image ${index + 1} of ${images.pending.length}`}
              style={({ pressed }) => ({
                width: 56,
                height: 56,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                overflow: 'hidden',
                opacity: pressed ? 0.6 : 1,
              })}>
              <Image
                source={{ uri: `data:${image.mediaType};base64,${image.base64Data}` }}
                resizeMode="cover"
                style={{ width: '100%', height: '100%' }}
              />
              <View
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: mix(c.foreground, 70),
                }}>
                <Mono style={{ fontSize: 11, lineHeight: 13, color: c.background }}>×</Mono>
              </View>
            </Pressable>
          ))}
          {images.pending.length >= MAX_IMAGES ? (
            <Mono style={{ fontSize: 11, color: c.mutedForeground, alignSelf: 'center' }}>
              {MAX_IMAGES} of {MAX_IMAGES}
            </Mono>
          ) : null}
        </View>
      ) : null}
      {images.error ? (
        <View accessibilityLiveRegion="polite">
          <Mono style={{ fontSize: 12, color: c.destructive }}>{images.error}</Mono>
        </View>
      ) : null}
    </View>
  );
}

/** `https://host/owner/repo.git` reads better as `owner/repo` on a phone. */
export function shortRepo(url: string): string {
  const parts = url.replace(/\.git$/, '').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || url;
}

/**
 * A dial, drawn at 30 and touched at 44: at full height three of them made the
 * composer's toolbar taller than its text.
 */
function Pill({ label, onPress, muted }: { label: string; onPress?: () => void; muted?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      hitSlop={{ top: 7, bottom: 7 }}
      style={({ pressed }) => ({
        height: 30,
        maxWidth: muted ? 120 : 160,
        justifyContent: 'center',
        paddingHorizontal: 11,
        borderRadius: 9999,
        backgroundColor: mix(c.mutedForeground, pressed ? 22 : 12),
      })}>
      <Body numberOfLines={1} style={{ fontSize: 12, color: muted ? c.mutedForeground : c.foreground }}>
        {label}
      </Body>
    </Pressable>
  );
}

function IconButton({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? mix(c.mutedForeground, 12) : 'transparent',
      })}>
      {children}
    </Pressable>
  );
}

/** A label for the section above a composer, matching the web's "What's next?". */
export function ComposerLabel({ children }: { children: React.ReactNode }) {
  return <Meta>{children}</Meta>;
}

/** A model row's key in the picker: the connection and the id, never the id alone. */
function modelKey(connectionId: string, modelId: string): string {
  return `${connectionId}/${modelId}`;
}
