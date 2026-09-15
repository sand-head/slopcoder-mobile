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
 */
import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import {
  ApprovalMode,
  ThinkingLevel,
  type FacetOption,
  type ModelCandidate,
  type ModelSelection,
} from '../api/contracts';
import { Body, Dot, GlassSurface, Meta, Mono, SendButton, Sliders } from './kit';
import { Sheet, SheetGroup, SheetMultiGroup, SheetSegments } from './Sheet';
import { useConnection } from '../state/connection';
import { Field } from './kit';
import { offer, shouldSearch } from '../api/repoPicker';
import { font, mix, radius, useTheme } from '../theme';

/** A repository or a node the next turn should have. */
export interface AttachOption {
  key: string;
  label: string;
  description?: string;
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

export interface TurnOptions {
  selection: ModelSelection;
  thinking: ThinkingLevel | null;
  approval: ApprovalMode;
  facet: string | null;
}

const THINKING: { key: string; label: string; value: ThinkingLevel | null }[] = [
  { key: 'auto', label: 'Auto', value: null },
  { key: 'off', label: 'Off', value: ThinkingLevel.Off },
  { key: 'low', label: 'Low', value: ThinkingLevel.Low },
  { key: 'medium', label: 'Medium', value: ThinkingLevel.Medium },
  { key: 'high', label: 'High', value: ThinkingLevel.High },
  { key: 'max', label: 'Max', value: ThinkingLevel.Max },
];

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
  facets,
  attachments,
}: {
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
  facets: FacetOption[];
  /** Omitted by the cockpit: a running session's workspace is already set. */
  attachments?: Attachments;
}) {
  const { c, status } = useTheme();
  const reachable = useConnection(s => s.reachable);
  const [sheet, setSheet] = useState<'model' | 'turn' | 'attach' | null>(null);

  const current = models.find(
    m => !options.selection.auto && m.modelId === options.selection.modelId,
  );
  const modelLabel = options.selection.auto ? 'Auto' : current?.modelDisplayName ?? 'Model';

  const thinkingLabel = THINKING.find(t => t.value === options.thinking)?.label ?? 'Auto';
  const approvalLabel = APPROVALS.find(a => a.value === options.approval)?.label ?? '';

  return (
    <View style={{ gap: 8 }}>
      {attachments ? <AttachChips attachments={attachments} /> : null}

      <GlassSurface
        cornerRadius={radius.xl}
        style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          {/* The web's ›, which becomes a running dot mid-turn. A fixed box the
              height of the input's first line, centring whatever sits in it —
              a glyph and a circle do not share a baseline. */}
          <View style={{ width: 18, height: 30, alignItems: 'center', justifyContent: 'center' }}>
            {running ? (
              <Dot color={status.running} size={9} />
            ) : (
              <Body
                style={{
                  fontFamily: font.mono,
                  fontSize: 17,
                  lineHeight: 17,
                  color: c.primary,
                }}>
                ›
              </Body>
            )}
          </View>
          <TextInput
            value={value}
            onChangeText={onChangeValue}
            placeholder={reachable ? placeholder : 'Offline'}
            placeholderTextColor={c.mutedForeground}
            multiline
            autoCapitalize="sentences"
            accessibilityLabel={placeholder}
            style={{
              flex: 1,
              minHeight: 30,
              maxHeight: 192,
              paddingTop: 4,
              paddingBottom: 4,
              fontSize: 16,
              lineHeight: 22,
              fontFamily: font.sans,
              color: c.foreground,
            }}
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {attachments ? (
            <IconButton onPress={() => setSheet('attach')} accessibilityLabel="Attach">
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
          ) : null}
          <IconButton onPress={() => setSheet('turn')} accessibilityLabel="Turn settings">
            <Sliders color={c.mutedForeground} />
          </IconButton>
          <Pill label={modelLabel} onPress={() => setSheet('model')} />
          {/* Dials appear only when off default, as on the web. */}
          {options.thinking !== null ? <Pill label={thinkingLabel} muted /> : null}
          {options.approval !== ApprovalMode.Dangerous ? <Pill label={approvalLabel} muted /> : null}

          <View style={{ flex: 1 }} />
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
            ...models.map(m => ({
              key: m.modelId,
              label: m.modelDisplayName || m.modelId,
              description: m.connectionName,
            })),
          ]}
          selected={options.selection.auto ? 'auto' : options.selection.modelId ?? 'auto'}
          onSelect={key => {
            const picked = models.find(m => m.modelId === key);
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
        <SheetSegments
          label="thinking"
          options={THINKING.map(t => ({ key: t.key, label: t.label }))}
          selected={THINKING.find(t => t.value === options.thinking)?.key ?? 'auto'}
          onSelect={key =>
            onChangeOptions({
              ...options,
              thinking: THINKING.find(t => t.key === key)?.value ?? null,
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
      drop: () =>
        attachments.onChange({
          repos: attachments.repos.filter(r => r !== url),
          nodes: attachments.nodes,
        }),
    })),
    ...attachments.nodes.map(id => ({
      key: id,
      label: attachments.availableNodes.find(n => n.key === id)?.label ?? 'node',
      drop: () =>
        attachments.onChange({
          repos: attachments.repos,
          nodes: attachments.nodes.filter(n => n !== id),
        }),
    })),
  ];

  if (picked.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {picked.map(chip => (
        <Pressable
          key={chip.key}
          onPress={chip.drop}
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
          <Mono numberOfLines={1} style={{ fontSize: 11.5, color: c.foreground, maxWidth: 160 }}>
            {chip.label}
          </Mono>
          <Mono style={{ fontSize: 12 }}>×</Mono>
        </Pressable>
      ))}
    </View>
  );
}

/** `https://host/owner/repo.git` reads better as `owner/repo` on a phone. */
export function shortRepo(url: string): string {
  const parts = url.replace(/\.git$/, '').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || url;
}

function Pill({ label, onPress, muted }: { label: string; onPress?: () => void; muted?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        height: 30,
        justifyContent: 'center',
        paddingHorizontal: 11,
        borderRadius: 9999,
        backgroundColor: mix(c.mutedForeground, pressed ? 22 : 12),
      })}>
      <Mono style={{ fontSize: 12, color: muted ? c.mutedForeground : c.foreground }}>{label}</Mono>
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
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: mix(c.mutedForeground, pressed ? 22 : 12),
      })}>
      {children}
    </Pressable>
  );
}

/** A label for the section above a composer, matching the web's "What's next?". */
export function ComposerLabel({ children }: { children: React.ReactNode }) {
  return <Meta>{children}</Meta>;
}
