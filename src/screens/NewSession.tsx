/**
 * Starting a session. Two calls, not one: create is cheap and synchronous,
 * starting the turn is long-running and detached.
 *
 * `clientWorkspace` is never sent. That omission is the whole mechanism by
 * which the session runs in the server's sandbox — which is the only kind a
 * phone can start, and the same kind the web app makes.
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApprovalMode,
  ThinkingLevel,
  autoRoute,
  type FacetOption,
  type GitRepoRow,
  type ModelCandidate,
  type RemoteNodeSummary,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import { Body, Button, Field, Hint, Mono, Screen, SectionLabel } from '../ui/kit';
import { mix, useTheme } from '../theme';

const THINKING: { label: string; value: ThinkingLevel | null }[] = [
  { label: 'auto', value: null },
  { label: 'off', value: ThinkingLevel.Off },
  { label: 'low', value: ThinkingLevel.Low },
  { label: 'medium', value: ThinkingLevel.Medium },
  { label: 'high', value: ThinkingLevel.High },
  { label: 'max', value: ThinkingLevel.Max },
];

const APPROVALS: { label: string; value: ApprovalMode }[] = [
  { label: 'dangerous', value: ApprovalMode.Dangerous },
  { label: 'auto', value: ApprovalMode.Auto },
  { label: 'always', value: ApprovalMode.Always },
];

export function NewSessionScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);

  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [repos, setRepos] = useState<GitRepoRow[]>([]);
  const [nodes, setNodes] = useState<RemoteNodeSummary[]>([]);
  const [query, setQuery] = useState('');

  const [model, setModel] = useState<ModelCandidate | null>(null);
  const [pickedRepos, setPickedRepos] = useState<string[]>([]);
  const [pickedNodes, setPickedNodes] = useState<string[]>([]);
  const [facet, setFacet] = useState<string | null>(null);
  const [thinking, setThinking] = useState<ThinkingLevel | null>(null);
  const [approval, setApproval] = useState<ApprovalMode>(ApprovalMode.Dangerous);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seam) return;
    void Promise.all([seam.models(), seam.facets(), seam.recentRepos(), seam.nodes()]).then(
      ([m, f, r, n]) => {
        setModels(m);
        setFacets(f);
        setRecent(r);
        setNodes(n);
      },
    );
  }, [seam]);

  // Repo search is the one call worth debouncing — it fans out to every
  // connected forge.
  useEffect(() => {
    if (!seam || query.trim().length < 2) {
      setRepos([]);
      return;
    }
    const timer = setTimeout(() => {
      void seam.searchRepos(query.trim()).then(setRepos);
    }, 300);
    return () => clearTimeout(timer);
  }, [seam, query]);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const create = async () => {
    if (!seam) return;
    setBusy(true);
    setError(null);
    try {
      const selection = model
        ? { auto: false, connectionId: model.connectionId, modelId: model.modelId }
        : autoRoute;

      const id = await seam.createSession({
        selection,
        initialPrompt: prompt.trim(),
        repoUrls: pickedRepos.length > 0 ? pickedRepos : null,
        thinkingLevel: thinking,
        facet,
        nodeIds: pickedNodes.length > 0 ? pickedNodes : null,
      });

      if (!id) {
        setError('That model selection is no longer available.');
        return;
      }

      if (approval !== ApprovalMode.Dangerous) {
        await seam.setApprovalMode(id, { mode: approval, useClassifier: true });
      }

      await seam.start(id, { prompt: prompt.trim(), selection });
      navigation.replace('Session', { id });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 24,
            gap: 18,
          }}
          keyboardShouldPersistTaps="handled">
          <Body style={{ fontSize: 22, fontWeight: '500' }}>New session</Body>

          <View style={{ gap: 6 }}>
            <SectionLabel label="task" />
            <Field
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Describe a task…"
              autoCapitalize="sentences"
              style={{ height: undefined, minHeight: 88, paddingTop: 10 }}
            />
          </View>

          <View>
            <SectionLabel label="model" />
            <Chips
              options={[
                { key: 'auto', label: 'auto' },
                ...models.map(m => ({ key: m.modelId, label: m.modelDisplayName || m.modelId })),
              ]}
              selected={model ? model.modelId : 'auto'}
              onSelect={key => setModel(models.find(m => m.modelId === key) ?? null)}
            />
            {models.length === 0 ? <Hint>No providers connected yet.</Hint> : null}
          </View>

          <View>
            <SectionLabel label="repositories" count={pickedRepos.length} />
            <Field value={query} onChangeText={setQuery} placeholder="Search repositories…" />
            <View style={{ height: 8 }} />
            <Chips
              multi
              options={[
                ...recent.map(url => ({ key: url, label: shortRepo(url) })),
                ...repos
                  .filter(r => !recent.includes(r.cloneUrl))
                  .map(r => ({ key: r.cloneUrl, label: r.fullName })),
              ]}
              selectedMany={pickedRepos}
              onSelect={key => setPickedRepos(toggle(pickedRepos, key))}
            />
          </View>

          {nodes.length > 0 ? (
            <View>
              <SectionLabel label="remote nodes" count={pickedNodes.length} />
              <Chips
                multi
                options={nodes.filter(n => n.enabled).map(n => ({ key: n.id, label: n.name }))}
                selectedMany={pickedNodes}
                onSelect={key => setPickedNodes(toggle(pickedNodes, key))}
              />
            </View>
          ) : null}

          <View>
            <SectionLabel label="facet" />
            <Chips
              options={[
                { key: '', label: 'default' },
                ...facets.map(f => ({ key: f.name, label: f.name })),
              ]}
              selected={facet ?? ''}
              onSelect={key => setFacet(key === '' ? null : key)}
            />
          </View>

          <View>
            <SectionLabel label="thinking" />
            <Chips
              options={THINKING.map(t => ({ key: String(t.value), label: t.label }))}
              selected={String(thinking)}
              onSelect={key => setThinking(THINKING.find(t => String(t.value) === key)?.value ?? null)}
            />
          </View>

          <View>
            <SectionLabel label="approvals" />
            <Chips
              options={APPROVALS.map(a => ({ key: String(a.value), label: a.label }))}
              selected={String(approval)}
              onSelect={key => setApproval(Number(key) as ApprovalMode)}
            />
            <Hint>
              {approval === ApprovalMode.Auto
                ? 'Never asks — nothing will block waiting for you.'
                : approval === ApprovalMode.Always
                  ? 'Asks on every tool call.'
                  : 'Asks only for what the classifier escalates.'}
            </Hint>
          </View>

          {error ? <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body> : null}

          <Button label="Start" onPress={create} busy={busy} disabled={!prompt.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Chips({
  options,
  selected,
  selectedMany,
  onSelect,
  multi,
}: {
  options: { key: string; label: string }[];
  selected?: string;
  selectedMany?: string[];
  onSelect: (key: string) => void;
  multi?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map(option => {
        const on = multi ? selectedMany?.includes(option.key) : selected === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            style={{
              minHeight: 36,
              justifyContent: 'center',
              paddingHorizontal: 12,
              borderRadius: 9999,
              borderWidth: 1,
              borderColor: on ? c.primary : c.border,
              backgroundColor: on ? mix(c.primary, 10) : c.card,
            }}>
            <Mono style={{ color: on ? c.primary : c.mutedForeground, fontSize: 12 }}>
              {option.label}
            </Mono>
          </Pressable>
        );
      })}
    </View>
  );
}

/** `https://host/owner/repo.git` reads better as `owner/repo` on a phone. */
function shortRepo(url: string): string {
  const trimmed = url.replace(/\.git$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || trimmed;
}
