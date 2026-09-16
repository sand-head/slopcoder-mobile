/**
 * One editor for everything under Settings that is a document: a facet, a
 * skill, a memory entry, the hooks JSON, the permission rules YAML.
 *
 * Five web pages each carry the same form — a name, a body, a Validate that
 * runs the real parser, a Save — and differ only in which fields they show
 * and what checks them. So it is one sheet with a `kind`, presented over the
 * list it came from: Cancel on the left, Save on the right, the body filling
 * the screen, which is what a document wants on a phone rather than a box at
 * the foot of a table.
 *
 * The checks are the server's where the web's are: a facet goes through the
 * exact parser the runtime uses, and the rules through the harness's. The
 * hooks document is checked here, as the web checks it in the browser.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Platform, ScrollView, View } from 'react-native';
import type { MemorySummary, UserFacetSummary, UserSkillSummary } from '../../api/contracts';
import { FACET_PLACEHOLDER, SKILL_PLACEHOLDER, checkHooks } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Button, Hint, Screen } from '../../ui/kit';
import { BarText, CodeBox, FormField, Note, Problem, SwitchRow } from '../../ui/settings';
import { ConnectionBanner } from '../../ui/ConnectionBanner';
import { useHeaderInset } from '../../navigation/headers';
import { tapConfirm, tapError } from '../../ui/haptics';

export type DocKind = 'facet' | 'skill' | 'memory' | 'hooks' | 'permissions';

export interface DocEditorParams {
  kind: DocKind;
  /** The row being edited; absent on a create. Not used for hooks/permissions. */
  entry?: UserFacetSummary | UserSkillSummary | MemorySummary;
}

const HOOKS_PLACEHOLDER = '{\n  "pre_tool_use": [{ "matcher": "run_bash", "command": "./hooks/check.sh", "timeout": 30 }]\n}';
const PERMISSIONS_PLACEHOLDER = 'rules:\n  - action: allow\n    tool: run_bash\n    executable: git\n    subcommand: push';

function titleOf(kind: DocKind, editing: string | null): string {
  switch (kind) {
    case 'facet':
      return editing ? `Edit ‘${editing}’` : 'New facet';
    case 'skill':
      return editing ? `Edit ‘${editing}’` : 'New skill';
    case 'memory':
      return editing ? `Edit ‘${editing}’` : 'New entry';
    case 'hooks':
      return 'Hooks';
    default:
      return 'Permission rules';
  }
}

export function DocEditorScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const seam = useAuth(s => s.seam);
  const params = (route.params ?? {}) as DocEditorParams;
  const kind = params.kind;
  const entry = params.entry;
  const memory = entry && 'repoKey' in entry ? entry : null;
  const editing = entry?.name ?? null;
  const isDocument = kind === 'hooks' || kind === 'permissions';
  const named = kind === 'facet' || kind === 'skill' || kind === 'memory';

  const [name, setName] = useState(entry?.name ?? '');
  const [repoKey, setRepoKey] = useState(memory?.repoKey ?? '');
  const [description, setDescription] = useState(memory?.description ?? '');
  const [content, setContent] = useState(entry?.content ?? '');
  const [pinned, setPinned] = useState(memory?.pinned ?? false);
  // A hooks or rules document is read when the sheet opens; the row it came
  // from only knows the document exists.
  const [loaded, setLoaded] = useState(!isDocument);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!seam || !isDocument) return;
    let live = true;
    (kind === 'hooks' ? seam.hooks() : seam.permissions())
      .then(text => {
        if (!live) return;
        setContent(text ?? '');
        setLoaded(true);
      })
      .catch(e => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [seam, kind, isDocument]);

  const touch = <T,>(set: (v: T) => void) => (value: T) => {
    set(value);
    setDirty(true);
    setNote(null);
  };

  /**
   * Run the kind's check and show its line. Returns whether the document may
   * be saved: a check that errs stops a save, as it does on the web.
   */
  const validate = async (): Promise<boolean> => {
    if (!seam) return false;
    if (kind === 'hooks') {
      const check = checkHooks(content);
      setNote({ ok: check.ok, text: check.message });
      return check.ok;
    }
    if (kind === 'permissions') {
      if (content.trim().length === 0) {
        setNote({ ok: true, text: 'empty — saving removes your global rules' });
        return true;
      }
      const check = await seam.checkPermissions(content);
      setNote(
        check.error
          ? { ok: false, text: `Invalid YAML: ${check.error}` }
          : { ok: true, text: `valid YAML with ${check.ruleCount} rule${check.ruleCount === 1 ? '' : 's'}` },
      );
      return check.error === null;
    }
    if (kind === 'facet') {
      const check = await seam.checkFacet(name.trim(), content);
      if (check.error) {
        setNote({ ok: false, text: `Invalid: ${check.error}.` });
        return false;
      }
      setNote({
        ok: true,
        text:
          `parses as facet ‘${check.name}’` +
          (check.toolsAllowed > 0 ? `, allows ${check.toolsAllowed} tools` : '') +
          (check.toolsDenied > 0 ? `, denies ${check.toolsDenied} tools` : '') +
          (check.model ? `, pinned to ${check.model}` : ''),
      });
      return true;
    }
    return true;
  };

  const save = useRef<() => void>(() => {});
  save.current = () => {
    void (async () => {
      if (!seam || busy) return;
      setBusy(true);
      setError(null);
      try {
        if (!(await validate())) {
          tapError();
          return;
        }
        switch (kind) {
          case 'facet':
            await seam.saveFacet(name.trim(), content);
            break;
          case 'skill': {
            const why = await seam.saveSkill(name.trim(), content);
            if (why) {
              tapError();
              setError(why);
              return;
            }
            break;
          }
          case 'memory':
            await seam.saveMemory({
              repoKey: repoKey.trim().toLowerCase(),
              name: name.trim(),
              description: description.trim(),
              content,
              pinned,
            });
            break;
          case 'hooks':
            await seam.saveHooks(content);
            break;
          default:
            await seam.savePermissions(content);
        }
        tapConfirm();
        leaving.current = true;
        navigation.goBack();
      } catch (e) {
        tapError();
        // A memory entry the server refuses (a bad slug, say) comes back as a
        // status, not a sentence; the message names the call at least.
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const ready = loaded && !busy && (!named || (name.trim().length > 0 && content.trim().length > 0));

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const confirm = () => save.current();
    navigation.setOptions({
      title: titleOf(kind, editing),
      headerLeft: () => (Platform.OS === 'ios' ? null : <BarText label="Cancel" onPress={cancel} />),
      headerRight: () => (Platform.OS === 'ios' ? null : <BarText label="Save" onPress={confirm} disabled={!ready} />),
      unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
      unstable_headerRightItems: () => [{ type: 'button', label: 'Save', variant: 'done', onPress: confirm, disabled: !ready }],
    });
  }, [navigation, kind, editing, ready]);

  // A swipe down or Cancel with unsaved changes asks first; the platform's
  // ordinary question, since nothing is lost until the form is saved.
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

  const validates = kind === 'facet' || kind === 'hooks' || kind === 'permissions';

  return (
    <Screen>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerInset, left: 0, right: 0, zIndex: 1 }}>
        <ConnectionBanner />
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        {error ? <Problem>{error}</Problem> : null}

        {kind === 'hooks' ? (
          <Hint>
            Your global lifecycle hooks, merged with each repo's .slopcoder/hooks.json (all handlers run; handlers
            execute inside the session's sandbox). Events: session_start, pre_tool_use, post_tool_use,
            post_tool_use_failure, stop. Exit 0 = proceed (optional JSON verdict on stdout); exit 2 = block-with-output.
          </Hint>
        ) : null}
        {kind === 'permissions' ? (
          <Hint>
            Your global allow/ask/deny rules, merged with each repo's .slopcoder/permissions.yaml. This is the trusted
            layer: only rules saved here may allow (skip the approval gate) — repo files can tighten with deny/ask but
            never loosen.
          </Hint>
        ) : null}

        {named ? (
          <FormField
            label="name"
            value={name}
            onChangeText={touch(setName)}
            placeholder={kind === 'facet' ? 'docs-writer' : kind === 'skill' ? 'monthly-invoices' : 'build-quirks'}
            editable={editing === null}
            hint={editing !== null ? 'A name cannot change; make a new one and delete this.' : undefined}
          />
        ) : null}

        {kind === 'memory' ? (
          <>
            <FormField
              label="repo key"
              value={repoKey}
              onChangeText={touch(setRepoKey)}
              placeholder="host/owner/name — blank for user scope"
              editable={editing === null}
            />
            <FormField
              label="description"
              value={description}
              onChangeText={touch(setDescription)}
              placeholder="one line, shown in the agent's memory index"
              autoCapitalize="sentences"
            />
          </>
        ) : null}

        <CodeBox
          label={kind === 'memory' ? 'entry (markdown)' : kind === 'hooks' ? 'hooks.json' : kind === 'permissions' ? 'permissions.yaml' : 'content'}
          value={content}
          onChangeText={touch(setContent)}
          placeholder={
            kind === 'facet'
              ? FACET_PLACEHOLDER
              : kind === 'skill'
                ? SKILL_PLACEHOLDER
                : kind === 'hooks'
                  ? HOOKS_PLACEHOLDER
                  : kind === 'permissions'
                    ? PERMISSIONS_PLACEHOLDER
                    : 'The full entry.'
          }
          minHeight={isDocument ? 320 : 220}
          editable={loaded && !busy}
          accessibilityLabel="Content"
        />

        {kind === 'memory' ? (
          <SwitchRow
            label="Pin into every prompt"
            detail="The whole body in every system prompt, not a one-line index entry."
            value={pinned}
            onChange={touch(setPinned)}
            disabled={busy}
          />
        ) : null}

        {note ? <Note ok={note.ok}>{note.text}</Note> : null}

        {validates ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button label="Validate" variant="outline" disabled={!loaded || busy} onPress={() => void validate()} />
            {isDocument ? <Hint>Saving an empty document removes your global {kind === 'hooks' ? 'hooks' : 'rules'}.</Hint> : null}
          </View>
        ) : null}

        {kind === 'facet' ? (
          <Hint>
            Same format as a repo's .slopcoder/facets/*.md — frontmatter (description, tools-allow, tools-deny, model,
            color) then the system-prompt body.
          </Hint>
        ) : null}
        {kind === 'skill' ? (
          <Hint>
            A SKILL.md: a --- frontmatter block with name and description, then the instructions. Yours win over a
            repository's skill of the same name.
          </Hint>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
