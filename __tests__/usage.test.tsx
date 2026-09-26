/**
 * The Usage page's quota strip, mounted — because nothing else here can be.
 *
 * The strip is advisory by contract: the server sends windows the plan itself
 * reported, and the page must not invent numbers it was not given. So the
 * checks are about restraint as much as presence: a connection with windows
 * gets a bar, a connection without gets a sentence, a connection that failed
 * gets its error and nothing else, and a server with no Codex connection gets
 * no section at all.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { CodexQuotaSummary, UsageDashboard } from '../src/api/contracts';

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

let quotas: CodexQuotaSummary[] = [];

const mockSeam = {
  usage: jest.fn((): Promise<UsageDashboard> => Promise.resolve(dashboard)),
  codexQuotas: jest.fn((): Promise<CodexQuotaSummary[]> => Promise.resolve(quotas)),
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
  mockSeam.codexQuotas.mockClear();
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
      },
    ];
    const tree = await mount();
    expect(mockSeam.codexQuotas).toHaveBeenCalledWith(false);

    const button = tree.root
      .findAll(n => n.props.accessibilityLabel === 'Refresh Codex allowance' && typeof n.props.onPress === 'function')
      .pop();
    expect(button).toBeTruthy();
    await act(async () => {
      button!.props.onPress();
    });
    expect(mockSeam.codexQuotas).toHaveBeenCalledWith(true);
  });
});
