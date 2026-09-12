/**
 * Starting a session, shaped like the session it is about to become.
 *
 * This used to be a form: stacked chip rows for model, repositories, nodes,
 * facet, thinking and approvals, with Start at the bottom of a long scroll.
 * Every one of those now lives behind the composer's own controls — the same
 * ones the cockpit has — so the screen is simply the cockpit with the transcript
 * not written yet.
 *
 * Two calls, as on the web: create is cheap and synchronous, starting the turn is
 * neither. `clientWorkspace` is never sent, which is what makes the session
 * server-sandboxed, the only kind a phone can start.
 */
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApprovalMode,
  type FacetOption,
  type ModelCandidate,
  type RemoteNodeSummary,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import { Composer, shortRepo, type TurnOptions } from '../ui/Composer';
import { Body, Hint, LogoMark, Mono, Screen } from '../ui/kit';
import { font, useTheme } from '../theme';

export function NewSessionScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<ModelCandidate[]>([]);
  const [facets, setFacets] = useState<FacetOption[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [allNodes, setAllNodes] = useState<RemoteNodeSummary[]>([]);

  const [repos, setRepos] = useState<string[]>([]);
  const [nodes, setNodes] = useState<string[]>([]);
  const [options, setOptions] = useState<TurnOptions>({
    selection: { auto: true, connectionId: null, modelId: null },
    thinking: null,
    approval: ApprovalMode.Dangerous,
    facet: null,
  });

  useEffect(() => {
    if (!seam) return;
    void Promise.all([seam.models(), seam.facets(), seam.recentRepos(), seam.nodes()]).then(
      ([m, f, r, n]) => {
        setModels(m);
        setFacets(f);
        setRecent(r);
        setAllNodes(n);
      },
    );
  }, [seam]);

  const start = async () => {
    if (!seam) return;
    const text = prompt.trim();
    if (!text) return;

    setBusy(true);
    setError(null);
    try {
      const id = await seam.createSession({
        selection: options.selection,
        initialPrompt: text,
        repoUrls: repos.length > 0 ? repos : null,
        thinkingLevel: options.thinking,
        facet: options.facet,
        nodeIds: nodes.length > 0 ? nodes : null,
      });
      if (!id) {
        setError('That model selection is no longer available.');
        return;
      }

      // The one setting with no create-time field.
      if (options.approval !== ApprovalMode.Dangerous) {
        await seam.setApprovalMode(id, { mode: options.approval, useClassifier: true });
      }
      await seam.start(id, { prompt: text, selection: options.selection });

      // Replace, not push: going back from the cockpit should reach the list,
      // not a form for a session that now exists.
      navigation.replace('Session', { id });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = repos.length > 0 ? repos.map(shortRepo).join(', ') : 'nothing attached yet';

  return (
    <Screen>
      {/* The cockpit's header: the logo goes back, the title sits over a mono
          line saying what the session will be made of. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          paddingTop: insets.top + 8,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <LogoMark size={28} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontFamily: font.sansMedium, fontSize: 14 }}>
            New session
          </Body>
          <Mono numberOfLines={1}>{subtitle}</Mono>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 44}
        style={{ flex: 1 }}>
        {/* Where the transcript will be. */}
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
          <LogoMark size={34} />
          <Hint>
            Describe a task below. It runs on the server, so you can close the app and come back
            to it.
          </Hint>
          {error ? <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body> : null}
        </View>

        <View style={{ paddingHorizontal: 10, paddingBottom: insets.bottom + 10, paddingTop: 4 }}>
          <Composer
            value={prompt}
            onChangeValue={setPrompt}
            placeholder="Describe a task…"
            action="Start"
            onAction={start}
            busy={busy}
            disabled={!prompt.trim()}
            options={options}
            onChangeOptions={setOptions}
            models={models}
            facets={facets}
            attachments={{
              repos,
              nodes,
              recentRepos: recent.map(url => ({ key: url, label: shortRepo(url) })),
              availableNodes: allNodes
                .filter(n => n.enabled)
                .map(n => ({ key: n.id, label: n.name, description: n.host })),
              searchRepos: async query => {
                const rows = (await seam?.searchRepos(query)) ?? [];
                return rows.map(r => ({ key: r.cloneUrl, label: r.fullName }));
              },
              onChange: next => {
                setRepos(next.repos);
                setNodes(next.nodes);
              },
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
