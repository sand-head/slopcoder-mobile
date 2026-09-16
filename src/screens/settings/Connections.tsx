/**
 * Model providers and git accounts, on the phone.
 *
 * A connection is a row with its switch; its models open in a sheet, which
 * is where the cockpit's inline card goes when there is no room beside the
 * row. Adding one is a form (a key) or a sign-in (Codex), each its own
 * modal — so this page only lists, flips and removes.
 *
 * Git accounts can be listed and disconnected here, not connected: connecting
 * is an OAuth round trip that lands on a cookie session, which a device key
 * is not. The foot says where to go.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Platform, Switch, View } from 'react-native';
import {
  ModelTier,
  ProviderKind,
  type ConnectionSummary,
  type GitAppSummary,
  type GitConnectionSummary,
  type ModelOption,
} from '../../api/contracts';
import { ADDABLE_PROVIDERS, connectionMeta, day, gitHost, TIERS, tierLabel } from '../../api/settings';
import { useAuth } from '../../state/auth';
import { Body, Hint, Mono } from '../../ui/kit';
import { Sheet, SheetSegments } from '../../ui/Sheet';
import { OverflowMenu } from '../../ui/menu';
import { BarText, Empty, ListRow, Problem, Section, SettingsPage, Tag, useFocusLoad } from '../../ui/settings';
import { barMenu } from '../../navigation/headers';
import { tapConfirm, tapError, tapRefuse, tapSelect } from '../../ui/haptics';
import { mix, useTheme } from '../../theme';

interface Loaded {
  connections: ConnectionSummary[];
  git: GitConnectionSummary[];
  apps: GitAppSummary[];
}

/** What the models sheet holds for one connection. */
interface Models {
  connection: ConnectionSummary;
  models: ModelOption[];
  disabled: Set<string>;
  tiers: Record<string, ModelTier>;
  error: string | null;
  loading: boolean;
}

function gitKindLabel(c: GitConnectionSummary): string {
  return c.kind === 0 ? 'GitHub' : 'Forgejo';
}

/** "GitHub", or the forge's host — how the web names a registered app. */
function appLabel(app: GitAppSummary): string {
  if (app.kind === 0) return 'GitHub';
  try {
    return app.baseUrl ? new URL(app.baseUrl).host : 'Forgejo';
  } catch {
    return app.baseUrl ?? 'Forgejo';
  }
}

export function ConnectionsScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);
  const server = useAuth(s => s.credential?.server);

  const load = useCallback(async (): Promise<Loaded> => {
    if (!seam) return { connections: [], git: [], apps: [] };
    // A forge that is down must not take the provider list with it.
    const [connections, git, apps] = await Promise.all([
      seam.connections(),
      seam.gitConnections().catch(() => [] as GitConnectionSummary[]),
      seam.gitApps().catch(() => [] as GitAppSummary[]),
    ]);
    return { connections, git, apps };
  }, [seam]);

  const { data, error, refreshing, reload, refresh, set } = useFocusLoad(navigation, seam ? load : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [models, setModels] = useState<Models | null>(null);

  // ---- the bar: one + that opens the four ways in ----

  useLayoutEffect(() => {
    const items = [
      ...ADDABLE_PROVIDERS.map(p => ({
        key: String(p.kind),
        label: `${p.label} · ${p.note}`,
        symbol: 'key',
        onPress: () => navigation.navigate('ProviderEditor', { kind: p.kind }),
      })),
      {
        key: 'codex',
        label: 'ChatGPT · Codex · subscription',
        symbol: 'person.crop.circle',
        onPress: () => navigation.navigate('CodexConnect'),
      },
    ];
    navigation.setOptions({
      title: 'Connections',
      ...barMenu(items, () =>
        Platform.OS === 'ios' ? null : (
          <OverflowMenu title="Add provider" items={items.map(i => ({ key: i.key, title: i.label, onPress: i.onPress }))}>
            <BarText label="Add" onPress={() => {}} />
          </OverflowMenu>
        ),
      ),
    });
  }, [navigation]);

  // ---- switches and removals ----

  const flipConnection = async (connection: ConnectionSummary, enabled: boolean) => {
    if (!seam || !data) return;
    // The switch moves at once; a refusal moves it back.
    set({ ...data, connections: data.connections.map(x => (x.id === connection.id ? { ...x, enabled } : x)) });
    setBusy(true);
    setProblem(null);
    try {
      const ok = await seam.setConnectionEnabled(connection.id, enabled);
      if (!ok) setProblem('That connection is gone.');
      await reload();
    } catch (e) {
      tapError();
      setProblem(`Failed to update connection: ${e instanceof Error ? e.message : String(e)}`);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (connection: ConnectionSummary) =>
    Alert.alert(
      'Remove this connection?',
      `“${connection.displayName}” is removed and its key forgotten; sessions using it can no longer run turns.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            tapRefuse();
            void (async () => {
              if (!seam) return;
              setBusy(true);
              try {
                await seam.deleteConnection(connection.id);
                if (models?.connection.id === connection.id) setModels(null);
                await reload();
              } catch (e) {
                setProblem(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );

  const confirmDisconnect = (git: GitConnectionSummary) =>
    Alert.alert(
      'Disconnect this account?',
      `“${git.username}” is disconnected; repository listing and pull requests through it stop working.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            tapRefuse();
            void (async () => {
              if (!seam) return;
              setBusy(true);
              try {
                await seam.deleteGitConnection(git.id);
                await reload();
              } catch (e) {
                setProblem(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );

  // ---- the models sheet ----

  const openModels = async (connection: ConnectionSummary) => {
    if (!seam) return;
    tapSelect();
    setModels({ connection, models: [], disabled: new Set(), tiers: {}, error: null, loading: true });
    try {
      // The resolve-and-catalog dance happens server-side; the decrypted key
      // never crosses the seam.
      const list = await seam.connectionModels(connection.id);
      if (list.length === 0) {
        setModels(current =>
          current && current.connection.id === connection.id
            ? { ...current, loading: false, error: 'That connection is no longer available.' }
            : current,
        );
        return;
      }
      const [disabled, tiers] = await Promise.all([seam.disabledModels(connection.id), seam.connectionTiers(connection.id)]);
      setModels(current =>
        current && current.connection.id === connection.id
          ? { ...current, models: list, disabled: new Set(disabled), tiers, loading: false }
          : current,
      );
    } catch (e) {
      setModels(current =>
        current && current.connection.id === connection.id
          ? { ...current, loading: false, error: `Couldn't list models: ${e instanceof Error ? e.message : String(e)}` }
          : current,
      );
    }
  };

  const flipModel = async (modelId: string, enabled: boolean) => {
    if (!seam || !models) return;
    const id = models.connection.id;
    const next = new Set(models.disabled);
    if (enabled) next.delete(modelId);
    else next.add(modelId);
    setModels({ ...models, disabled: next });
    try {
      if (!(await seam.setModelEnabled(id, modelId, enabled))) throw new Error('That connection is gone.');
      tapConfirm();
    } catch (e) {
      tapError();
      setModels(current => (current && current.connection.id === id ? { ...current, disabled: models.disabled, error: `Failed to update model: ${e instanceof Error ? e.message : String(e)}` } : current));
    }
  };

  const grade = async (modelId: string, tier: ModelTier | null) => {
    if (!seam || !models) return;
    const id = models.connection.id;
    tapSelect();
    try {
      await seam.setModelTier(id, modelId, tier);
      const tiers = await seam.connectionTiers(id);
      setModels(current => (current && current.connection.id === id ? { ...current, tiers } : current));
    } catch (e) {
      setModels(current => (current && current.connection.id === id ? { ...current, error: e instanceof Error ? e.message : String(e) } : current));
    }
  };

  // The sheet's state outlives its close so the dismiss animation has content;
  // the next open replaces it.
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (models) setSheetOpen(true);
  }, [models]);

  const connections = data?.connections ?? [];
  const git = data?.git ?? [];
  const apps = data?.apps ?? [];
  const compatible = models?.connection.kind === ProviderKind.OpenAICompatible;

  return (
    <>
      <SettingsPage refreshing={refreshing} onRefresh={refresh} error={error ?? problem} loading={data === null && !error}>
        <Section label="model providers" count={connections.length}>
          {connections.length === 0 ? <Empty>No provider connections yet — add one with +.</Empty> : null}
          {connections.map(connection => (
            <ListRow
              key={connection.id}
              title={connection.displayName}
              subtitle={connectionMeta(connection)}
              switchValue={connection.enabled}
              onSwitch={on => void flipConnection(connection, on)}
              disabled={busy}
              dimmed={!connection.enabled}
              onPress={() => void openModels(connection)}
              menu={[
                { key: 'models', title: 'Models…', symbol: 'list.bullet', onPress: () => void openModels(connection) },
                { key: 'remove', title: 'Remove', symbol: 'trash', destructive: true, onPress: () => confirmRemove(connection) },
              ]}
            />
          ))}
        </Section>

        <Section label="git services" count={git.length}>
          {git.length === 0 ? (
            <Empty>
              No git accounts connected. Connect GitHub or a Forgejo instance to pick repositories, clone private repos, and let
              the agent open pull requests — slopcoder never sees your password.
            </Empty>
          ) : null}
          {git.map(account => (
            <ListRow
              key={account.id}
              title={account.username}
              subtitle={`${gitKindLabel(account)} · ${gitHost(account)} · connected ${day(account.createdAt)}`}
              tag={account.trouble ? 'reconnect' : undefined}
              tagTone={account.trouble ? 'warn' : undefined}
              warn={account.trouble}
              menu={[{ key: 'disconnect', title: 'Disconnect', symbol: 'trash', destructive: true, onPress: () => confirmDisconnect(account) }]}
            />
          ))}
          <View style={{ paddingTop: 10 }}>
            {apps.length > 0 ? (
              <Hint>
                Connecting an account is a sign-in with {apps.map(appLabel).join(' or ')}, and that round trip lands in a browser:
                open {server ? `${server}/settings/connections` : 'slopcoder'} on a computer and press Connect there. The account
                shows up here once it is linked.
              </Hint>
            ) : (
              <Hint>No git service apps are registered yet, so there is nothing to connect to. Ask an administrator to register one.</Hint>
            )}
          </View>
        </Section>
      </SettingsPage>

      <Sheet visible={sheetOpen} title={models ? `Models · ${models.connection.displayName}` : 'Models'} onClose={() => setSheetOpen(false)}>
        {models ? (
          <>
            <Mono>{compatible ? 'ungraded models route as medium' : 'graded by the provider'}</Mono>
            {compatible ? (
              <Hint>
                An OpenAI-compatible endpoint can serve anything under any name, so slopcoder can't judge how capable these models
                are — only you can. Auto uses your grades to route prompts.
              </Hint>
            ) : null}
            {models.error ? <Problem>{models.error}</Problem> : null}
            {models.loading ? <Mono>loading models…</Mono> : null}
            {models.models.map(model => {
              const off = models.disabled.has(model.id);
              const tier = models.tiers[model.id];
              return (
                <View
                  key={model.id}
                  style={{ gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border, opacity: off ? 0.55 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body numberOfLines={1} style={{ fontSize: 14 }}>
                        {model.displayName}
                      </Body>
                      {model.displayName !== model.id ? <Mono numberOfLines={1}>{model.id}</Mono> : null}
                    </View>
                    {!compatible && tier !== undefined ? <Tag>{ModelTier[tier].toLowerCase()}</Tag> : null}
                    <Switch
                      value={!off}
                      accessibilityLabel={`${model.displayName} enabled`}
                      onValueChange={on => void flipModel(model.id, on)}
                      trackColor={{ true: c.primary, false: mix(c.mutedForeground, 30) }}
                    />
                  </View>
                  {compatible ? (
                    <SheetSegments
                      options={TIERS.map(t => ({ key: t.tier === null ? '' : String(t.tier), label: t.tier === null ? 'Unrated' : t.label }))}
                      selected={tier === undefined ? '' : String(tier)}
                      onSelect={key => void grade(model.id, key === '' ? null : (Number(key) as ModelTier))}
                    />
                  ) : null}
                  {compatible ? <Mono>{tierLabel(tier ?? null)}</Mono> : null}
                </View>
              );
            })}
          </>
        ) : null}
      </Sheet>
    </>
  );
}
