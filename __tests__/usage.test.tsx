/**
 * The Usage page's quota strip, mounted — because nothing else here can be.
 *
 * The strip is advisory by contract: the server sends windows the plan itself
 * reported, and the page must not invent numbers it was not given. So the
 * checks are about restraint as much as presence: a connection with windows
 * gets a bar, a connection without gets a sentence, a connection that failed
 * gets its error and nothing else, and a server with no subscription
 * connection gets no section at all. A Claude plan is observed, never polled,
 * so its card says when it was seen and offers no refresh.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ProviderKind, type PlanQuotaSummary, type UsageDashboard } from '../src/api/contracts';

const dashboard: UsageDashboard = {
  range: 1,
  totals: {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    completions: 4,
    estimatedCost: 0.25,
    hasUnpriced: false,
  },
  daily: [],
  breakdown: [],
};

const windows = [
  { label: '5 hours', usedPercent: 60, resetsAt: '2026-09-25T18:30:00Z' },
  { label: 'Weekly', usedPercent: null, resetsAt: null },
];

let quotas: PlanQuotaSummary[] = [];

const mockSeam = {
  usage: jest.fn((): Promise<UsageDashboard> => Promise.resolve(dashboard)),
  planQuotas: jest.fn((): Promise<PlanQuotaSummary[]> => Promise.resolve(quotas)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));

import { UsageScreen } from '../src/screens/Usage';

async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<UsageScreen navigation={{ setOptions: jest.fn() }} />);
  });
  return tree;
}

/** Every string a tree paints, in order — `toJSON` alone chokes on the RefreshControl's circular props. */
function text(tree: ReturnType<typeof create>): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    const element = node as { children?: unknown[] };
    for (const child of element.children ?? []) walk(child);
  };
  walk(tree.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  mockSeam.usage.mockClear();
  mockSeam.planQuotas.mockClear();
  quotas = [];
});

describe('Usage quota strip', () => {
  it('shows a window bar with the percent left and its reset time', async () => {
    quotas = [
      {
        connectionId: 'cx-1',
        connectionName: 'Codex Work',
        planType: 'Pro',
        windows,
        observedAt: '2026-09-25T12:00:00Z',
        isStale: false,
        error: null,
        kind: ProviderKind.OpenAICodex,
        canRefresh: true,
      },
    ];
    const tree = await mount();
    // Whitespace is squashed before matching: RN flattens sibling text nodes
    // with the separator glued to both, so "5 hours ·" reads "5 hours  ·" in
    // the walked tree. What matters is the words, not the gap.
    const all = text(tree).replace(/\s+/g, ' ');
    expect(all).toContain('codex allowance · Codex Work');
    expect(all).toContain('pro'); // the plan, lower-cased like the web's
    expect(all).toContain('5 hours · 40% left');
    expect(all).toContain('resets 18:30');
    expect(all).toContain('weekly · usage unknown');
    expect(all).toContain('advisory · observed 12:00');
    expect(all).not.toContain('stale');
  });

  it('says so when no allowance has been reported yet', async () => {
    quotas = [
      {
        connectionId: 'cx-2',
        connectionName: 'Codex Personal',
        planType: null,
        windows: [],
        observedAt: null,
        isStale: true,
        error: null,
        kind: ProviderKind.OpenAICodex,
        canRefresh: true,
      },
    ];
    const tree = await mount();
    const all = text(tree);
    expect(all).toContain('codex allowance · Codex Personal');
    expect(all).toContain('No allowance reported yet.');
    expect(all).toContain('stale');
  });

  it('shows the failure instead of numbers when the refresh failed', async () => {
    quotas = [
      {
        connectionId: 'cx-3',
        connectionName: 'Codex Work',
        planType: null,
        windows: [],
        observedAt: null,
        isStale: false,
        error: 'Codex did not answer.',
        kind: ProviderKind.OpenAICodex,
        canRefresh: true,
      },
    ];
    const tree = await mount();
    const all = text(tree);
    expect(all).toContain('Codex did not answer.');
    expect(all).not.toContain('% left');
  });

  it('renders no strip at all without a Codex connection', async () => {
    const tree = await mount();
    expect(text(tree)).not.toContain('codex allowance');
  });

  it('asks the upstream again from the card, not just the cache', async () => {
    quotas = [
      {
        connectionId: 'cx-1',
        connectionName: 'Codex Work',
        planType: null,
        windows,
        observedAt: null,
        isStale: false,
        error: null,
        kind: ProviderKind.OpenAICodex,
        canRefresh: true,
      },
    ];
    const tree = await mount();
    expect(mockSeam.planQuotas).toHaveBeenCalledWith(false);

    const button = tree.root
      .findAll(n => n.props.accessibilityLabel === 'Refresh Codex allowance' && typeof n.props.onPress === 'function')
      .pop();
    expect(button).toBeTruthy();
    await act(async () => {
      button!.props.onPress();
    });
    expect(mockSeam.planQuotas).toHaveBeenCalledWith(true);
  });

  it('shows a Claude plan as of its last turn, with no refresh to offer', async () => {
    quotas = [
      {
        connectionId: 'cc-1',
        connectionName: 'My Claude plan',
        planType: null,
        windows: [{ label: '5-hour', usedPercent: 85, resetsAt: '2026-09-25T18:30:00Z' }],
        observedAt: '2026-09-25T12:00:00Z',
        isStale: false,
        error: null,
        kind: ProviderKind.ClaudeCode,
        canRefresh: false,
      },
    ];
    const tree = await mount();
    const all = text(tree).replace(/\s+/g, ' ');
    expect(all).toContain('claude allowance · My Claude plan');
    expect(all).toContain('5-hour · 15% left');
    expect(all).toContain('as of the last turn, 12:00');
    expect(all).not.toContain('codex');
    expect(tree.root.findAll(n => /^Refresh/.test(n.props.accessibilityLabel ?? ''))).toHaveLength(0);
  });

  it('says where a Claude plan’s allowance will come from before any turn', async () => {
    quotas = [
      {
        connectionId: 'cc-2',
        connectionName: 'Unused plan',
        planType: null,
        windows: [],
        observedAt: null,
        isStale: true,
        error: null,
        kind: ProviderKind.ClaudeCode,
        canRefresh: false,
      },
    ];
    const tree = await mount();
    expect(text(tree)).toContain('Claude Code reports it during a turn on this connection.');
  });

  it('marks subscription turns in the breakdown as the plan’s, not a bill', async () => {
    mockSeam.usage.mockImplementationOnce(() =>
      Promise.resolve({
        ...dashboard,
        breakdown: [
          {
            providerKind: ProviderKind.ClaudeCode,
            connectionName: 'My Claude plan',
            model: 'claude-opus-5-5',
            totals: { ...dashboard.totals, estimatedCost: null },
            attributionQuality: 0,
          },
          {
            providerKind: ProviderKind.Anthropic,
            connectionName: 'API',
            model: 'claude-haiku-4-5',
            totals: { ...dashboard.totals, estimatedCost: 1.5 },
            attributionQuality: 0,
          },
        ],
      }),
    );
    const tree = await mount();
    await act(async () => {});
    const all = text(tree);
    expect(all).toContain('plan');
    expect(all).toContain('$1.50');
  });
});
