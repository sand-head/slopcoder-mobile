/**
 * The editor, mounted — because nothing else here can be.
 *
 * As with the board: the screen only ever runs on a phone after a signed
 * build, so the cheapest check is to mount it against catalogs and a routine
 * the server could really send, and prove the form it paints is the one the
 * routine described. A smoke test, not a layout one; what it catches is the
 * screen that fails to render at all, or unfolds a routine wrongly.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  AutomationKind,
  AutomationTriggerKind,
  ChannelKind,
  DeliveryKind,
  type AutomationSummary,
  type ChannelSummary,
  type RoutineDetail,
} from '../src/api/contracts';

const discord: ChannelSummary = {
  id: 'ch-1',
  kind: ChannelKind.Discord,
  displayName: 'ops-bot',
  enabled: true,
  hasSecret: true,
  settings: '{}',
  pairedPeers: [],
  pendingPairings: [],
  mainSessionId: null,
  lastError: null,
  lastSeenAt: null,
  createdAt: '2026-09-01T00:00:00Z',
};

const routine: AutomationSummary = {
  id: 'r-1',
  name: 'morning triage',
  kind: AutomationKind.Job,
  prompt: 'triage the inbox',
  cronExpression: '0 7 * * 1-5',
  timeZoneId: 'Europe/Berlin',
  enabled: true,
  scheduleEnabled: true,
  facet: 'execute',
  model: null,
  repoUrls: [],
  nodeIds: [],
  continuity: false,
  notepad: '',
  activeHoursStart: null,
  activeHoursEnd: null,
  deliveryKind: DeliveryKind.Channel,
  deliveryTargetId: 'ch-1',
  triggers: [
    { kind: AutomationTriggerKind.ChannelCommand, channelId: 'ch-1', match: 'triage', secret: null, id: 't-1', enabled: true },
  ],
  sessionId: null,
  nextRunAt: null,
  lastRunAt: null,
  lastStatus: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const detail: RoutineDetail = {
  routine,
  scheduleSentence: 'Every weekday at 07:00',
  scheduleMeta: '0 7 * * 1-5 · Europe/Berlin',
  nextFire: null,
  notifiesLabel: 'Discord · ops-bot',
  history: Array(30).fill(null),
  runs30d: 0,
  notified30d: 0,
  failed30d: 0,
  medianDurationMs: null,
  triggers: [],
  lastRun: null,
  running: false,
};

const parse = {
  ok: true,
  cron: '0 7 * * 1-5',
  zone: 'Europe/Berlin',
  sentence: 'Every weekday at 07:00',
  firstRun: null,
  error: null,
};

const mockSeam = {
  facets: jest.fn(() => Promise.resolve([{ name: 'execute' }, { name: 'assist' }])),
  models: jest.fn(() => Promise.resolve([])),
  channels: jest.fn(() => Promise.resolve([discord])),
  nodes: jest.fn(() => Promise.resolve([])),
  recentRepos: jest.fn(() => Promise.resolve([])),
  repos: jest.fn(() => Promise.resolve({ repos: [], errors: [] })),
  routine: jest.fn(() => Promise.resolve(detail)),
  parseSchedule: jest.fn(() => Promise.resolve(parse)),
  createRoutine: jest.fn(() => Promise.resolve({ error: null, webhooks: [] })),
  updateRoutine: jest.fn(() => Promise.resolve({ error: null, webhooks: [] })),
  routines: jest.fn(() => Promise.resolve([routine])),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com' } }),
}));

import { RoutineEditorScreen } from '../src/screens/RoutineEditor';

function navigator() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    setOptions: jest.fn(),
    addListener: () => () => {},
  };
}

async function mount(params: { id?: string; add?: boolean } = {}) {
  const navigation = navigator();
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<RoutineEditorScreen route={{ params }} navigation={navigation} />);
  });
  // The catalogs, the routine and its schedule read land in turn.
  await act(async () => {});
  await act(async () => {});
  return { tree: tree!, navigation };
}

function text(tree: ReturnType<typeof create>): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    (node as { children?: unknown[] }).children?.forEach(walk);
  };
  walk(tree.toJSON());
  return parts.join('');
}

/** The bar's options, as the screen last set them. */
function bar(navigation: ReturnType<typeof navigator>) {
  const calls = navigation.setOptions.mock.calls;
  return calls[calls.length - 1][0] as {
    title: string;
    unstable_headerRightItems: () => { label: string; disabled?: boolean }[];
    unstable_headerLeftItems: () => { label: string }[];
  };
}

describe('the routine editor', () => {
  beforeEach(() => {
    for (const fn of Object.values(mockSeam)) fn.mockClear();
  });

  it('opens a new routine with one empty trigger card and a disabled Create', async () => {
    const { tree, navigation } = await mount();
    const rendered = text(tree);

    expect(rendered).toContain('describe it');
    expect(rendered).toContain('triggers · 1');
    expect(rendered).toContain('Choose a trigger kind');
    // The foot names the first thing missing, and a blank name comes first.
    expect(rendered).toContain('give it a name');

    const options = bar(navigation);
    expect(options.title).toBe('New routine');
    expect(options.unstable_headerLeftItems()[0].label).toBe('Cancel');
    expect(options.unstable_headerRightItems()[0]).toMatchObject({ label: 'Create', disabled: true });
  });

  it('unfolds a stored routine: its schedule in words, its command on its connection', async () => {
    const { tree, navigation } = await mount({ id: 'r-1' });
    const rendered = text(tree);

    expect(mockSeam.routine).toHaveBeenCalledWith('r-1');
    expect(bar(navigation).title).toBe('Edit morning triage');
    // A text field's value is a prop, not a child, so it is read as one.
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Name' && n.props.value === 'morning triage').length).toBeGreaterThan(0);
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Prompt' && n.props.value === 'triage the inbox').length).toBeGreaterThan(0);
    expect(rendered).toContain('triggers · 2');
    // The stored cron read back as the sentence it means.
    expect(mockSeam.parseSchedule).toHaveBeenCalledWith('0 7 * * 1-5', 'Europe/Berlin');
    expect(rendered).toContain('Every weekday at 07:00');
    expect(rendered).toContain('Discord command');
    expect(rendered).toContain('/triage on ops-bot');
    expect(rendered).toContain('Discord · ops-bot');
    // Nothing has changed, so Save is offered and there is nothing to warn about.
    expect(bar(navigation).unstable_headerRightItems()[0]).toMatchObject({ label: 'Save', disabled: false });
    expect(rendered).not.toContain('unsaved');
  });

  it('opens with an extra empty card when asked to add a trigger', async () => {
    const { tree } = await mount({ id: 'r-1', add: true });
    expect(text(tree)).toContain('triggers · 3');
  });

  it('saves an edit as an update and returns to the routine', async () => {
    const { navigation } = await mount({ id: 'r-1' });
    await act(async () => {
      (bar(navigation).unstable_headerRightItems()[0] as { onPress: () => void }).onPress();
    });
    await act(async () => {});

    expect(mockSeam.updateRoutine).toHaveBeenCalledTimes(1);
    const [id, draft] = mockSeam.updateRoutine.mock.calls[0] as unknown as [string, { cronExpression: string; triggers: { id: string }[] }];
    expect(id).toBe('r-1');
    expect(draft.cronExpression).toBe('0 7 * * 1-5');
    expect(draft.triggers.map(t => t.id)).toEqual(['t-1']);
    expect(navigation.goBack).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
