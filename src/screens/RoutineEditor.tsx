/**
 * Create and edit one routine, on the phone.
 *
 * A form sheet, as the platform presents one: Cancel on the left, Create or
 * Save on the right, the fields down the page. Describe it in a sentence at
 * the top and the model fills the form in; the form is the truth either way
 * and works with no model at all. One screen for both routes — an edit is
 * the same form with its fields already answered.
 *
 * The choices that are a list — the model, the facet, where the answer goes,
 * a trigger's kind and its connection — come up from the bottom as sheets
 * rather than as dropdowns, and a trigger is a row that opens its own sheet
 * to be edited. Everything the form *decides* is in `api/routineEditor.ts`;
 * this file lays it out and talks to the server.
 *
 * Two things the server does for it, deterministically: reading "every
 * weekday at 7am" as a cron, and drafting the whole form from a description.
 * Neither is guessed at here.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Alert,
  Platform,
  Pressable,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  AutomationKind,
  ChannelKind,
  type AutomationWebhookSecret,
  type ChannelSummary,
  type FacetOption,
  type ModelCandidate,
  type RecentRepo,
  type RemoteNodeSummary,
  type RoutineDraftResult,
} from '../api/contracts';
import { deviceZone } from '../api/routines';
import {
  HEARTBEAT_ALWAYS,
  HEARTBEAT_NEEDED,
  canSave,
  cardOfProposal,
  cardSummary,
  channelKey,
  channelKindOf,
  confirmation,
  deliveryLabel,
  emptyForm,
  formOf,
  formProblem,
  hookPath,
  isValid,
  keyFor,
  moreSummary,
  newCard,
  pending,
  problem,
  slotDescription,
  slotName,
  slotsFor,
  toDraft,
  unavailable,
  type RoutineForm,
  type TriggerCard,
  type TriggerSlot,
} from '../api/routineEditor';
import { useAuth } from '../state/auth';
import { useOwnedRepos } from '../state/repos';
import { rowToChoice } from '../api/repoPicker';
import { Body, Button, Check, Field, Hint, Meta, Mono, Screen } from '../ui/kit';
import { Sheet, SheetGroup, SheetSegments } from '../ui/Sheet';
import { AttachChips, AttachSheet, shortRepo, type Attachments } from '../ui/Composer';
import { SecretSheet } from '../ui/SecretSheet';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { useHeaderInset } from '../navigation/headers';
import { tapConfirm, tapError, tapSelect, tapSuccess } from '../ui/haptics';
import { font, mix, radius, useTheme } from '../theme';
import { KEYBOARD_GAP } from '../ui/keyboard';

/** How long after the typing stops a schedule is read. */
const PARSE_DEBOUNCE_MS = 400;

type SheetKind = 'model' | 'facet' | 'reply' | 'attach' | 'trigger' | 'secret' | null;

export function RoutineEditorScreen({ route, navigation }: { route: any; navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);
  const server = useAuth(s => s.credential?.server);

  /** The routine being edited; undefined on a create. */
  const id: string | undefined = route.params?.id;
  /** Open with one empty trigger card — the detail screen's "+ add trigger". */
  const add: boolean = route.params?.add === true;
  const creating = id === undefined;

  // ---- catalogs ----
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [nodes, setNodes] = useState<RemoteNodeSummary[]>([]);
  const [recent, setRecent] = useState<RecentRepo[]>([]);
  const owned = useOwnedRepos(seam);

  // ---- the form ----
  const [form, setForm] = useState<RoutineForm>(() => emptyForm(deviceZone() ?? 'UTC'));
  const [loaded, setLoaded] = useState(creating);
  const [loadedName, setLoadedName] = useState('');
  const loadedEnabled = useRef(true);
  const [dirty, setDirty] = useState(false);
  const [more, setMore] = useState(false);

  // ---- describing ----
  const [description, setDescription] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [reading, setReading] = useState<string[]>([]);
  const [draftedBy, setDraftedBy] = useState<string | null>(null);
  const [draftElapsed, setDraftElapsed] = useState(0);
  // Which fields the user has touched since the last draft. A redraft fills in
  // what they have not answered themselves and leaves the rest alone — a model
  // that rewrites the prompt somebody just tightened is worse than no model.
  const edited = useRef({ name: false, prompt: false, model: false, delivery: false, triggers: false });

  // ---- saving ----
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<AutomationWebhookSecret[]>([]);
  const pendingNav = useRef<string | null>(null);
  const leaving = useRef(false);

  // ---- sheets ----
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const busy = saving || drafting;

  // ---- one place to change the form ----

  const patch = useCallback((change: Partial<RoutineForm>) => {
    setForm(current => ({ ...current, ...change }));
    setDirty(true);
  }, []);

  const patchCard = useCallback((key: string, change: Partial<TriggerCard>) => {
    setForm(current => ({
      ...current,
      triggers: current.triggers.map(t => (t.key === key ? { ...t, ...change } : t)),
    }));
  }, []);

  // ---- reading schedules ----
  //
  // One debounced parse per card, keyed by its render key. A later keystroke
  // owns the ✓ line: the earlier call is aborted and its answer never lands.
  const parsers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout> | null; abort: AbortController }>());
  const formRef = useRef(form);
  formRef.current = form;

  const cancelParse = useCallback((key: string) => {
    const previous = parsers.current.get(key);
    if (!previous) return;
    if (previous.timer) clearTimeout(previous.timer);
    previous.abort.abort();
    parsers.current.delete(key);
  }, []);

  const parse = useCallback(
    (key: string, text: string, zone: string, immediate = false): Promise<void> => {
      cancelParse(key);
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        patchCard(key, { parse: null, parsing: false });
        return Promise.resolve();
      }
      if (!seam) return Promise.resolve();

      const abort = new AbortController();
      const entry = { timer: null as ReturnType<typeof setTimeout> | null, abort };
      parsers.current.set(key, entry);
      patchCard(key, { parsing: true });

      return new Promise<void>(resolve => {
        const run = async () => {
          try {
            const read = await seam.parseSchedule(trimmed, zone, abort.signal);
            if (abort.signal.aborted) return;
            patchCard(key, { parse: read, parsing: false });
          } catch {
            if (abort.signal.aborted) return;
            patchCard(key, {
              parse: {
                ok: false,
                cron: null,
                zone: null,
                sentence: null,
                firstRun: null,
                error: 'the server could not be reached to read that',
              },
              parsing: false,
            });
          } finally {
            if (parsers.current.get(key) === entry) parsers.current.delete(key);
            resolve();
          }
        };
        if (immediate) void run();
        else entry.timer = setTimeout(() => void run(), PARSE_DEBOUNCE_MS);
      });
    },
    [seam, cancelParse, patchCard],
  );

  /**
   * A stored cron is shown as the sentence it means when the sentence reads
   * back to the same cron — "Every weekday at 07:00" is what the user wrote,
   * and `0 7 * * 1-5` is what the server kept. A cron the grammar cannot say
   * stays a cron.
   */
  const preferEnglish = useCallback(
    async (key: string, cron: string, zone: string) => {
      if (!seam) return;
      const read = await seam.parseSchedule(cron, zone);
      if (!read.ok || !read.cron || !read.sentence) {
        patchCard(key, { parse: read, parsing: false });
        return;
      }
      try {
        const again = await seam.parseSchedule(read.sentence, zone);
        if (again.ok && again.cron === read.cron) {
          patchCard(key, { when: read.sentence, rawCron: false, parse: again, parsing: false });
          return;
        }
      } catch {
        // The cron stays; it is the truth either way.
      }
      patchCard(key, { parse: read, parsing: false });
    },
    [seam, patchCard],
  );

  useEffect(() => {
    const live = parsers.current;
    return () => {
      for (const entry of live.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.abort.abort();
      }
      live.clear();
    };
  }, []);

  // ---- loading ----

  useEffect(() => {
    if (!seam) return;
    let live = true;

    const settle = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

    void (async () => {
      // Each catalog is a convenience: "auto" always works, and with no
      // channels the kind picker greys its command lines out.
      const [f, m, ch, n, r] = await Promise.all([
        settle(seam.facets(), [] as FacetOption[]),
        settle(seam.models(), [] as ModelCandidate[]),
        settle(seam.channels(), [] as ChannelSummary[]),
        settle(seam.nodes(), [] as RemoteNodeSummary[]),
        settle(seam.recentRepos(), [] as RecentRepo[]),
      ]);
      if (!live) return;
      setFacets(f);
      setModels(m);
      setChannels(ch);
      setNodes(n);
      setRecent(r);

      if (id === undefined) {
        // A fresh routine starts with the card it is going to need.
        setForm(current => (current.triggers.length === 0 ? { ...current, triggers: [newCard()] } : current));
        setDirty(false);
        return;
      }

      let detail;
      try {
        detail = await seam.routine(id);
      } catch {
        detail = null;
      }
      if (!live) return;
      if (!detail) {
        setError('That routine could not be loaded.');
        setLoaded(true);
        return;
      }
      const routine = detail.routine;
      // The heartbeat's prompt is the system's and its settings live on its own
      // screen; there is nothing on this form that applies to it.
      if (routine.kind === AutomationKind.Heartbeat) {
        leaving.current = true;
        navigation.goBack();
        return;
      }

      const filled = formOf(routine, ch, f.map(x => x.name));
      if (add) filled.triggers.push(newCard());
      setLoadedName(routine.name);
      loadedEnabled.current = routine.enabled;
      setForm(filled);
      setLoaded(true);
      setDirty(add);

      const schedule = filled.triggers.find(t => t.slot === 'schedule');
      if (schedule) {
        patchCard(schedule.key, { parsing: true });
        try {
          await preferEnglish(schedule.key, schedule.when, filled.timeZone);
        } catch {
          if (live) patchCard(schedule.key, { parsing: false });
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [seam, id, add, navigation, patchCard, preferEnglish]);

  // ---- the bar ----

  const ready = canSave(form) && !busy && loaded;
  const save = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const confirm = () => save.current();
    const confirmLabel = creating ? 'Create' : 'Save';
    navigation.setOptions({
      title: creating ? 'New routine' : loadedName ? `Edit ${loadedName}` : 'Edit routine',
      headerLeft: () => (Platform.OS === 'ios' ? null : <Button label="Cancel" variant="ghost" onPress={cancel} />),
      headerRight: () =>
        Platform.OS === 'ios' ? null : <Button label={confirmLabel} variant="ghost" onPress={confirm} disabled={!ready} />,
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [
        { type: 'button', label: confirmLabel, variant: 'done', onPress: confirm, disabled: !ready },
      ],
    });
  }, [navigation, creating, loadedName, ready]);

  // A swipe down, a Cancel or Android's back with unsaved changes asks first.
  // Nothing is lost until the form is saved, so the question is the platform's
  // ordinary one and not a modal of our own.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', undefined, [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
  }, [navigation, dirty]);

  // ---- describing ----

  /**
   * Ask a model to fill the form in. Best-effort by construction: a failure
   * is a line on screen and an untouched form, never an error page.
   */
  const draft = async () => {
    const text = description.trim();
    if (!seam || busy || text.length === 0) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await seam.draftRoutine(text, form.timeZone.trim() || undefined);
      setDraftElapsed(result.elapsedMs);
      if (!result.ok) {
        tapError();
        setError(result.error ?? 'No model could draft that. Fill the form in yourself.');
        return;
      }
      setDraftedBy(result.draftedBy);
      setReading(result.reading);
      await adopt(result);
      tapSuccess();
    } catch {
      tapError();
      setError('Drafting could not reach the server. Fill the form in yourself.');
    } finally {
      setDrafting(false);
    }
  };

  /**
   * Take what the draft filled in, for every field the user has not answered
   * themselves since the last one.
   */
  const adopt = async (result: RoutineDraftResult) => {
    const touched = edited.current;
    const current = formRef.current;
    const next: Partial<RoutineForm> = {};
    if (!touched.name && result.name) next.name = result.name;
    if (!touched.prompt && result.prompt) next.prompt = result.prompt;
    if (!touched.model && result.model && models.some(m => m.modelId === result.model)) next.model = result.model;
    if (!touched.delivery) next.delivery = keyFor(result.deliveryKind, result.deliveryTargetId);

    let cards: TriggerCard[] | null = null;
    if (!touched.triggers && result.triggers.length > 0) {
      for (const card of current.triggers) cancelParse(card.key);
      cards = result.triggers.map(t => cardOfProposal(t, channels));
      next.triggers = cards;
    }
    patch(next);
    edited.current = { name: false, prompt: false, model: false, delivery: false, triggers: false };

    // Everything else the draft proposes is already a value; a schedule is
    // English, and only the server turns that into a cron.
    if (cards) {
      const zone = current.timeZone.trim() || 'UTC';
      await Promise.all(
        cards.filter(t => t.slot === 'schedule').map(t => parse(t.key, t.when, zone, true)),
      );
    }
  };

  // ---- triggers ----

  const addTrigger = () => {
    const card = newCard();
    patch({ triggers: [...form.triggers, card] });
    edited.current.triggers = true;
    setEditingKey(card.key);
    setSheet('trigger');
  };

  /**
   * Remove without a confirm. A trigger is cheap to add back and nothing is
   * lost until the form is saved, which is the real undo.
   */
  const removeTrigger = (key: string) => {
    cancelParse(key);
    patch({ triggers: form.triggers.filter(t => t.key !== key) });
    edited.current.triggers = true;
    setSheet(null);
  };

  const editCard = (key: string, change: Partial<TriggerCard>) => {
    patchCard(key, change);
    setDirty(true);
    edited.current.triggers = true;
  };

  const pickSlot = (card: TriggerCard, slot: TriggerSlot) => {
    if (unavailable(slot, card, form.triggers, channels)) return;
    tapSelect();
    cancelParse(card.key);
    editCard(card.key, {
      slot,
      channelId: null,
      match: slot === 'heartbeat' ? HEARTBEAT_ALWAYS : '',
      when: '',
      rawCron: false,
      parse: null,
      parsing: false,
    });
  };

  const scheduleTyped = (card: TriggerCard, text: string) => {
    editCard(card.key, { when: text });
    void parse(card.key, text, form.timeZone.trim() || 'UTC');
  };

  /** A new zone re-reads every schedule: "7am" is a different instant in it. */
  const zoneTyped = (text: string) => {
    patch({ timeZone: text });
    for (const card of form.triggers) {
      if (card.slot === 'schedule') void parse(card.key, card.when, text.trim() || 'UTC');
    }
  };

  // ---- saving ----

  /**
   * Write the form. Returns the routine's id, or null when the server
   * refused — the problem is already on screen.
   */
  const persist = async (): Promise<string | null> => {
    if (!seam || saving) return null;
    setSaving(true);
    setError(null);
    try {
      if (id !== undefined) {
        const updated = await seam.updateRoutine(id, toDraft(form, loadedEnabled.current));
        if (updated.error) return refused(updated.error);
        setMinted(updated.webhooks);
        setDirty(false);
        return id;
      }

      const created = await seam.createRoutine(toDraft(form, true));
      if (created.error) return refused(created.error);
      setMinted(created.webhooks);
      setDirty(false);

      // A create answers with the secrets it minted, not with an id, so a
      // routine with no webhook has to be found again by name.
      if (created.webhooks.length > 0) return created.webhooks[0].automationId;
      const wanted = form.name.trim();
      const all = await seam.routines();
      const newest = all
        .filter(a => a.kind === AutomationKind.Job && a.name === wanted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return newest?.id ?? null;
    } catch (e) {
      return refused(e instanceof Error && e.name !== 'SeamError' ? e.message : 'The server could not be reached. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const refused = (why: string): null => {
    tapError();
    setError(why);
    return null;
  };

  /** Dismiss the secret sheet, if it was up, and go where the save was headed. */
  const leave = (target: string | null) => {
    leaving.current = true;
    setSheet(null);
    navigation.goBack();
    // A create lands on the routine it made; an edit returns to the one it
    // came from, which reloads when it is focused again.
    if (creating && target) navigation.navigate('Routine', { id: target });
  };

  save.current = () => {
    void (async () => {
      const target = await persist();
      if (target === null && !creating) return;
      if (target === null) return;
      tapConfirm();
      pendingNav.current = target;
      if (mintedRef.current.length > 0) setSheet('secret');
      else leave(target);
    })();
  };

  // `persist` sets `minted` and the save reads it in the same tick, so it is
  // mirrored in a ref: state has not re-rendered yet by then.
  const mintedRef = useRef(minted);
  mintedRef.current = minted;

  /**
   * Save if there is anything to save, then start a run. A routine that has
   * never been stored cannot be run, so "Run once now" creates it first.
   */
  const runOnce = async () => {
    if (!seam) return;
    let target: string | null = id ?? null;
    if (creating || dirty) {
      target = await persist();
      if (target === null) return;
    }
    const why = await seam.runRoutineNow(target!);
    if (why) {
      tapError();
      setError(why);
      return;
    }
    tapConfirm();
    pendingNav.current = target;
    if (mintedRef.current.length > 0) setSheet('secret');
    else leave(target);
  };

  // ---- what the sheets show ----

  const editing = form.triggers.find(t => t.key === editingKey) ?? null;
  const modelLabel = form.model ? models.find(m => m.modelId === form.model)?.modelDisplayName ?? form.model : 'auto';
  const attachments: Attachments = {
    repos: form.repoUrls,
    nodes: form.nodeIds,
    recentRepos: recent.map(row => ({
      key: row.cloneUrl,
      label: row.label || shortRepo(row.cloneUrl),
      kind: row.kind,
    })),
    ownedRepos: owned.repos,
    ownedLoaded: owned.loaded,
    ownedError: owned.error,
    availableNodes: nodes.filter(n => n.enabled).map(n => ({ key: n.id, label: n.name, description: n.host })),
    searchRepos: async query => ((await seam?.searchRepos(query)) ?? []).map(rowToChoice),
    onChange: next => patch({ repoUrls: next.repos, nodeIds: next.nodes }),
  };

  return (
    <Screen>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner />
      </View>

      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        // Scrolls the field being typed in clear of the keyboard, and only
        // when the keyboard would actually cover it — see ui/keyboard.ts for
        // what the prop this replaced did instead. Layout mode keeps the
        // scroll view unwrapped, where the large title can find it.
        bottomOffset={KEYBOARD_GAP}
        mode="layout"
        keyboardDismissMode="interactive">
        {error ? (
          <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
            {error}
          </Body>
        ) : null}

        {/* ---- describe first ---- */}
        <View style={{ gap: 8 }}>
          <Meta>describe it</Meta>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Every weekday morning check the deploy and tell me on Discord if anything looks wrong."
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            editable={!busy}
            accessibilityLabel="Describe the routine"
            style={[styles.box(c), { minHeight: 76 }]}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button
              label={reading.length > 0 ? 'Redraft' : 'Draft the form'}
              variant="outline"
              busy={drafting}
              disabled={saving || description.trim().length === 0}
              onPress={() => void draft()}
            />
            {draftedBy ? (
              <Mono style={{ flex: 1 }} numberOfLines={1}>
                drafted in {(draftElapsed / 1000).toFixed(1)}s · {draftedBy}
              </Mono>
            ) : (
              <Hint>Optional. The form below is the truth either way.</Hint>
            )}
          </View>
          {reading.length > 0 ? (
            <View style={{ gap: 3 }}>
              <Meta>the agent read this as</Meta>
              {reading.map((line, i) => (
                <Mono key={i} style={{ color: c.foreground }}>
                  {line}
                </Mono>
              ))}
            </View>
          ) : null}
        </View>

        {/* ---- the form ---- */}
        <View style={{ gap: 8 }}>
          <Meta>name</Meta>
          <Field
            value={form.name}
            onChangeText={text => {
              edited.current.name = true;
              patch({ name: text });
            }}
            placeholder="morning-digest"
            autoCapitalize="none"
            accessibilityLabel="Name"
          />
        </View>

        <ChoiceRow label="model" value={modelLabel} onPress={() => setSheet('model')} disabled={busy} />

        <View style={{ gap: 8 }}>
          <Meta>prompt</Meta>
          <TextInput
            value={form.prompt}
            onChangeText={text => {
              edited.current.prompt = true;
              patch({ prompt: text });
            }}
            placeholder="What to do each run. It arrives with no conversation around it — answer NO_REPLY when there is nothing to say."
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel="Prompt"
            style={[styles.box(c), { minHeight: 160 }]}
          />
        </View>

        {/* ---- triggers ---- */}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Meta>triggers · {form.triggers.length}</Meta>
              <Mono>fires the prompt when any one of these happens</Mono>
            </View>
            <Button label="+ Add" variant="outline" onPress={addTrigger} disabled={busy} />
          </View>
          {form.triggers.map(card => (
            <TriggerRow
              key={card.key}
              card={card}
              channels={channels}
              onPress={() => {
                setEditingKey(card.key);
                setSheet('trigger');
              }}
            />
          ))}
          {form.triggers.length === 0 ? (
            <Hint>Nothing starts this routine yet — add a trigger and it comes to life.</Hint>
          ) : null}
        </View>

        <ChoiceRow
          label="reply to"
          value={deliveryLabel(form.delivery, channels)}
          onPress={() => setSheet('reply')}
          disabled={busy}
          hint="runs started from a chat or email always reply where they came from"
        />

        {/* ---- more options ---- */}
        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => {
              tapSelect();
              setMore(m => !m);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: more }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1, minHeight: 32 })}>
            <Mono style={{ color: c.foreground, fontSize: 13, transform: [{ rotate: more ? '90deg' : '0deg' }] }}>›</Mono>
            <Meta>more options</Meta>
            <Mono style={{ flex: 1 }} numberOfLines={1}>
              {moreSummary(form)}
            </Mono>
          </Pressable>

          {more ? (
            <View style={{ gap: 14 }}>
              <ChoiceRow label="facet" value={form.facet} onPress={() => setSheet('facet')} disabled={busy} />

              <View style={{ gap: 8 }}>
                <Meta>time zone</Meta>
                <Field
                  value={form.timeZone}
                  onChangeText={zoneTyped}
                  placeholder="UTC"
                  autoCapitalize="none"
                  accessibilityLabel="Time zone"
                />
              </View>

              <View style={{ gap: 8 }}>
                <Meta>active hours</Meta>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Field
                    value={form.activeStart}
                    onChangeText={text => patch({ activeStart: text })}
                    placeholder="any"
                    keyboardType="numbers-and-punctuation"
                    accessibilityLabel="Active from"
                    style={{ flex: 1 }}
                  />
                  <Mono>–</Mono>
                  <Field
                    value={form.activeEnd}
                    onChangeText={text => patch({ activeEnd: text })}
                    placeholder="any"
                    keyboardType="numbers-and-punctuation"
                    accessibilityLabel="Active until"
                    style={{ flex: 1 }}
                  />
                </View>
                <Hint>Runs may only start inside this window, as HH:MM. Blank means any time.</Hint>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Meta>memory</Meta>
                  <Body style={{ fontSize: 14 }}>Carry the previous answer forward</Body>
                  <Mono>Each run sees what the previous one answered.</Mono>
                </View>
                <Switch
                  value={form.continuity}
                  disabled={busy}
                  accessibilityLabel="Carry the previous answer forward"
                  onValueChange={on => patch({ continuity: on })}
                  trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
                />
              </View>

              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Meta style={{ flex: 1 }}>repositories & nodes</Meta>
                  <Button label="+ Attach" variant="outline" onPress={() => setSheet('attach')} disabled={busy} />
                </View>
                <AttachChips attachments={attachments} />
                {form.nodeIds.length > 0 ? (
                  <Mono style={{ color: c.destructive }}>
                    Runs are unattended: commands on {form.nodeIds.length === 1 ? 'this machine' : 'these machines'} go
                    through with nobody there to approve them. Give the prompt exactly what it may do.
                  </Mono>
                ) : (
                  <Hint>
                    Optional. Repositories are cloned into each run's workspace; a node is a machine the runs may
                    shell into.
                  </Hint>
                )}
              </View>
            </View>
          ) : null}
        </View>

        {/* ---- foot ---- */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Button label="Run once now" variant="outline" onPress={() => void runOnce()} disabled={!ready} busy={saving} />
          {!loaded ? (
            <Mono>loading…</Mono>
          ) : dirty || creating ? (
            <Mono style={{ flex: 1 }} numberOfLines={1}>
              {formProblem(form) ?? (dirty ? 'unsaved' : '')}
            </Mono>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      {/* ---- sheets ---- */}

      <Sheet visible={sheet === 'model'} title="Model" onClose={() => setSheet(null)}>
        <SheetGroup
          options={[
            { key: '', label: 'Auto', description: 'Let the router pick per run' },
            ...models.map(m => ({ key: m.modelId, label: m.modelDisplayName || m.modelId, description: m.connectionName })),
          ]}
          selected={form.model}
          onSelect={key => {
            edited.current.model = true;
            patch({ model: key });
            setSheet(null);
          }}
        />
        {models.length === 0 ? <Mono>No providers connected yet — auto is the only choice.</Mono> : null}
      </Sheet>

      <Sheet visible={sheet === 'facet'} title="Facet" onClose={() => setSheet(null)}>
        <SheetGroup
          options={
            facets.length > 0
              ? facets.map(f => ({ key: f.name, label: f.name, description: f.description ?? undefined }))
              : [{ key: form.facet, label: form.facet }]
          }
          selected={form.facet}
          onSelect={key => {
            patch({ facet: key });
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'reply'} title="Reply to" onClose={() => setSheet(null)}>
        <SheetGroup
          options={[
            { key: 'push', label: 'Push notification', description: 'This phone, and any browser you subscribed' },
            ...channels.map(ch => ({
              key: channelKey(ch.id),
              label: ch.displayName,
              description: ChannelKind[ch.kind],
            })),
            { key: 'none', label: 'Nobody', description: 'The answer lives in the run log' },
          ]}
          selected={form.delivery}
          onSelect={key => {
            edited.current.delivery = true;
            patch({ delivery: key });
            setSheet(null);
          }}
        />
        <Hint>Runs started from a chat or email always reply where they came from.</Hint>
      </Sheet>

      <AttachSheet
        visible={sheet === 'attach'}
        onClose={() => setSheet(null)}
        attachments={attachments}
        nodeDescription="Runs may shell into this machine — unattended, without approval"
      />

      <Sheet
        visible={sheet === 'trigger' && editing !== null}
        title={editing ? slotName(editing.slot) : 'Trigger'}
        onClose={() => setSheet(null)}>
        {editing ? (
          <TriggerEditor
            card={editing}
            cards={form.triggers}
            channels={channels}
            hookPath={hookPath(id ?? null, editing)}
            onPickSlot={slot => pickSlot(editing, slot)}
            onChange={change => editCard(editing.key, change)}
            onScheduleTyped={text => scheduleTyped(editing, text)}
            onRemove={() => removeTrigger(editing.key)}
          />
        ) : null}
      </Sheet>

      <SecretSheet
        secrets={sheet === 'secret' ? minted : []}
        server={server}
        onContinue={() => leave(pendingNav.current)}
      />
    </Screen>
  );
}

/**
 * The ✓ / ✕ / · at the head of a trigger's line. Geist Mono has no tick and
 * no cross (see `GLYPHS`), so the tick is drawn and the cross is the
 * multiplication sign the transcript already uses for an error.
 */
function Mark({ why, ok }: { why: string | null; ok: boolean }) {
  const theme = useTheme();
  const { c } = theme;
  return (
    <View style={{ width: 14, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      {why ? (
        <Mono style={{ color: c.destructive, fontSize: 14, lineHeight: 16 }}>×</Mono>
      ) : ok ? (
        <Check color={theme.status.ok} size={12} />
      ) : (
        <Mono style={{ fontSize: 14, lineHeight: 16 }}>·</Mono>
      )}
    </View>
  );
}

/** A label, the current choice, and a chevron: a row that opens a sheet. */
function ChoiceRow({
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

/** One trigger on the form: what it is, whether it is ready, and a tap to edit. */
function TriggerRow({
  card,
  channels,
  onPress,
}: {
  card: TriggerCard;
  channels: ChannelSummary[];
  onPress: () => void;
}) {
  const theme = useTheme();
  const { c } = theme;
  const why = problem(card);
  const ok = isValid(card);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${slotName(card.slot)}, ${cardSummary(card, channels)}`}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: card.slot === 'none' ? mix(c.mutedForeground, 40) : c.border,
        borderStyle: card.slot === 'none' ? 'dashed' : 'solid',
        backgroundColor: pressed ? mix(c.mutedForeground, 8) : c.card,
        padding: 12,
        gap: 4,
        opacity: card.enabled ? 1 : 0.55,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mark why={why} ok={ok} />
        <Body numberOfLines={1} style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 14.5 }}>
          {slotName(card.slot)}
        </Body>
        {!card.enabled ? <Mono>paused</Mono> : null}
        <Mono style={{ fontSize: 13 }}>›</Mono>
      </View>
      <Body numberOfLines={2} style={{ fontSize: 13.5, paddingLeft: 21 }}>
        {cardSummary(card, channels)}
      </Body>
      {why ? (
        <Mono numberOfLines={2} style={{ color: c.destructive, paddingLeft: 21 }}>
          {why}
        </Mono>
      ) : null}
    </Pressable>
  );
}

/** The sheet that edits one card: its kind, the fields that kind needs, its switch. */
function TriggerEditor({
  card,
  cards,
  channels,
  hookPath: path,
  onPickSlot,
  onChange,
  onScheduleTyped,
  onRemove,
}: {
  card: TriggerCard;
  cards: TriggerCard[];
  channels: ChannelSummary[];
  hookPath: string;
  onPickSlot: (slot: TriggerSlot) => void;
  onChange: (change: Partial<TriggerCard>) => void;
  onScheduleTyped: (text: string) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { c } = theme;
  const why = problem(card);
  const ok = isValid(card);
  const connections = (() => {
    const kind = channelKindOf(card.slot);
    return kind === null ? [] : channels.filter(ch => ch.kind === kind);
  })();

  return (
    <View style={{ gap: 14 }}>
      <SheetGroup
        label="kind"
        options={slotsFor(card, channels).map(slot => {
          const blocked = unavailable(slot, card, cards, channels);
          return {
            key: slot,
            label: slotName(slot),
            description: blocked ? `unavailable · ${blocked}` : slotDescription(slot),
          };
        })}
        selected={card.slot}
        onSelect={key => onPickSlot(key as TriggerSlot)}
      />

      {card.slot === 'schedule' ? (
        <View style={{ gap: 8 }}>
          <Meta>{card.rawCron ? 'cron' : 'when'}</Meta>
          <Field
            value={card.when}
            onChangeText={onScheduleTyped}
            placeholder={card.rawCron ? '0 7 * * 1-5' : 'e.g. every weekday at 7am'}
            autoCapitalize="none"
            accessibilityLabel={card.rawCron ? 'Cron' : 'When'}
          />
          <Pressable
            onPress={() => onChange({ rawCron: !card.rawCron })}
            hitSlop={8}
            accessibilityRole="button"
            style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
            <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>
              {card.rawCron ? 'write it in English instead' : 'write cron instead'}
            </Mono>
          </Pressable>
        </View>
      ) : null}

      {card.slot === 'fluxer' || card.slot === 'discord' || card.slot === 'telegram' ? (
        <>
          <View style={{ gap: 8 }}>
            <Meta>command</Meta>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Mono style={{ fontSize: 16, color: c.foreground }}>/</Mono>
              <Field
                value={card.match}
                onChangeText={text => onChange({ match: text })}
                placeholder="digest"
                autoCapitalize="none"
                accessibilityLabel="Command word"
                style={{ flex: 1 }}
              />
            </View>
          </View>
          <SheetGroup
            label="connection"
            options={connections.map(ch => ({ key: ch.id, label: ch.displayName, description: ch.enabled ? undefined : 'paused' }))}
            selected={card.channelId ?? ''}
            onSelect={key => onChange({ channelId: key })}
          />
          {connections.length === 0 ? <Mono>No {slotName(card.slot).replace(' command', '')} connection yet.</Mono> : null}
        </>
      ) : null}

      {card.slot === 'email' ? (
        <>
          <View style={{ gap: 8 }}>
            <Meta>plus-tag or subject:</Meta>
            <Field
              value={card.match}
              onChangeText={text => onChange({ match: text })}
              placeholder="digest, or subject:digest"
              autoCapitalize="none"
              accessibilityLabel="Plus-tag or subject prefix"
            />
          </View>
          <SheetGroup
            label="mailbox"
            options={connections.map(ch => ({ key: ch.id, label: ch.displayName }))}
            selected={card.channelId ?? ''}
            onSelect={key => onChange({ channelId: key })}
          />
        </>
      ) : null}

      {card.slot === 'webhook' ? (
        <>
          <View style={{ gap: 4 }}>
            <Meta>path</Meta>
            <Mono selectable style={{ color: c.foreground }}>
              {path}
            </Mono>
          </View>
          <View style={{ gap: 8 }}>
            <Meta>match (JSONPath, optional)</Meta>
            <Field
              value={card.match}
              onChangeText={text => onChange({ match: text })}
              placeholder={'$.action == "opened"'}
              autoCapitalize="none"
              accessibilityLabel="Match"
            />
          </View>
        </>
      ) : null}

      {card.slot === 'heartbeat' ? (
        <SheetSegments
          label="only when"
          options={[
            { key: HEARTBEAT_ALWAYS, label: 'every beat' },
            { key: HEARTBEAT_NEEDED, label: 'something needs me' },
          ]}
          selected={card.match || HEARTBEAT_ALWAYS}
          onSelect={key => onChange({ match: key })}
        />
      ) : null}

      {card.slot !== 'none' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Mark why={why} ok={ok} />
          <Mono style={{ flex: 1, color: why ? c.destructive : c.mutedForeground }}>
            {why ?? (ok ? confirmation(card) : pending(card))}
          </Mono>
        </View>
      ) : (
        <Hint>Pick a kind above — its options appear here.</Hint>
      )}

      {card.slot !== 'none' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14 }}>{card.enabled ? 'Open' : 'Paused'}</Body>
            <Mono>A paused trigger stays on the routine and simply does not match.</Mono>
          </View>
          <Switch
            value={card.enabled}
            accessibilityLabel="Trigger enabled"
            onValueChange={on => onChange({ enabled: on })}
            trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
          />
        </View>
      ) : null}

      <Button label="Remove trigger" variant="link-destructive" onPress={onRemove} />
    </View>
  );
}

const styles = {
  box: (c: { input: string; foreground: string; background: string }) => ({
    borderWidth: 1,
    borderColor: c.input,
    borderRadius: radius.md,
    padding: 12,
    // 16px or iOS zooms on focus.
    fontSize: 16,
    lineHeight: 23,
    fontFamily: font.sans,
    color: c.foreground,
    backgroundColor: c.background,
  }),
};
