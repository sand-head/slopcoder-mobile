/**
 * What a model offers, and the order the picker lists models in — ports of
 * `ThinkingLevels` and `ModelOrdering`, and the composer that draws them.
 *
 * The failure these pin is quiet: a dial offering Off on a model that always
 * thinks reads fine and then runs every turn at Low, and a pick made on one
 * model shown verbatim on another says something the provider will not do.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ApprovalMode, ProviderKind, ThinkingLevel, type ModelCandidate } from '../src/api/contracts';
import { findCandidate, isSwitch, levelLabel, offeredLevels, orderModels, runsAs } from '../src/api/models';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { Composer, type TurnOptions } from '../src/ui/Composer';
import { SheetGroup, SheetSegments } from '../src/ui/Sheet';

const { Off, Low, Medium, High, Max } = ThinkingLevel;

function candidate(over: Partial<ModelCandidate>): ModelCandidate {
  return {
    connectionId: 'c1',
    connectionName: 'Personal',
    kind: ProviderKind.Anthropic,
    modelId: 'm',
    modelDisplayName: 'M',
    tier: 1,
    tierSource: 0,
    contextWindowTokens: 200_000,
    ...over,
  };
}

describe('ThinkingLevels', () => {
  it('offers every effort and Off when the model says nothing', () => {
    expect(offeredLevels(null)).toEqual([Off, Low, Medium, High, Max]);
    expect(offeredLevels({ supportedThinkingLevels: [] })).toEqual([Off, Low, Medium, High, Max]);
  });

  it('offers only what the model lists, in dial order, and no Off on one that always thinks', () => {
    expect(offeredLevels({ supportedThinkingLevels: [High, Low, Low, Off] })).toEqual([Off, Low, High]);
    expect(offeredLevels({ supportedThinkingLevels: [Low, Medium, High, Max], alwaysThinks: true })).toEqual([
      Low,
      Medium,
      High,
      Max,
    ]);
  });

  /** Up first: Opus 5.5's Off is Low, Qwen 3.8's High is its xhigh (Max here). */
  it('runs an unoffered level as the nearest one above it, else the highest', () => {
    expect(runsAs(Off, { alwaysThinks: true })).toBe(Low);
    expect(runsAs(High, { supportedThinkingLevels: [Low, Medium, Max] })).toBe(Max);
    expect(runsAs(Max, { supportedThinkingLevels: [Low, Medium] })).toBe(Medium);
    expect(runsAs(Medium, null)).toBe(Medium);
  });

  it('calls a single effort a switch, and labels it On', () => {
    const qwen = { supportedThinkingLevels: [Medium] };
    expect(isSwitch(qwen)).toBe(true);
    expect(isSwitch({ supportedThinkingLevels: [Medium, Off] })).toBe(true);
    expect(isSwitch({ supportedThinkingLevels: [Low, High] })).toBe(false);
    expect(isSwitch(null)).toBe(false);
    expect(levelLabel(Medium, qwen)).toBe('On');
    expect(levelLabel(Off, qwen)).toBe('Off');
    expect(levelLabel(Medium, null)).toBe('Medium');
  });
});

describe('ModelOrdering', () => {
  it('sorts by provider, connection, tier, then newest first with undated last, then name', () => {
    const ordered = orderModels([
      candidate({ modelId: 'old', modelDisplayName: 'Old', tier: 1, releaseDate: '2025-01-01' }),
      candidate({ modelId: 'undated', modelDisplayName: 'A undated', tier: 1, releaseDate: null }),
      candidate({ modelId: 'new', modelDisplayName: 'New', tier: 1, releaseDate: '2026-09-01' }),
      candidate({ modelId: 'cheap', modelDisplayName: 'Cheap', tier: 0 }),
      candidate({ modelId: 'codex', kind: ProviderKind.OpenAICodex, connectionName: 'A plan', connectionId: 'c0', tier: 0 }),
      candidate({ modelId: 'b-conn', connectionName: 'b second', connectionId: 'c9', tier: 0 }),
    ]);

    expect(ordered.map(m => m.modelId)).toEqual(['b-conn', 'cheap', 'new', 'old', 'undated', 'codex']);
  });

  it('finds a candidate on its own connection before the same id on another', () => {
    const models = [candidate({ connectionId: 'a', modelId: 'Claude-X' }), candidate({ connectionId: 'b', modelId: 'claude-x' })];
    expect(findCandidate(models, 'b', 'claude-x')).toBe(models[1]);
    expect(findCandidate(models, null, 'claude-x')).toBe(models[0]);
    expect(findCandidate(models, 'b', null)).toBeNull();
  });
});

describe('the composer’s dials', () => {
  const opus = candidate({
    modelId: 'claude-opus-5-5',
    modelDisplayName: 'Opus 5.5',
    supportedThinkingLevels: [Low, Medium, High, Max],
    alwaysThinks: true,
    releaseDate: '2026-09-22',
  });
  const qwen = candidate({
    connectionId: 'local',
    connectionName: 'Local',
    kind: ProviderKind.OpenAICompatible,
    modelId: 'qwen3.6-27b',
    modelDisplayName: 'Qwen 3.6',
    supportedThinkingLevels: [Medium],
  });

  function mount(options: TurnOptions, extra: Partial<React.ComponentProps<typeof Composer>> = {}) {
    const onChange = jest.fn();
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(
        <Composer
          value=""
          onChangeValue={() => {}}
          placeholder="Send a message…"
          action="Send"
          onAction={() => {}}
          options={options}
          onChangeOptions={onChange}
          models={[qwen, opus]}
          facets={[]}
          {...extra}
        />,
      );
    });
    const segments = tree!.root.findByType(SheetSegments);
    return { tree: tree!, onChange, segments };
  }

  const pinned = (model: ModelCandidate, thinking: ThinkingLevel | null): TurnOptions => ({
    selection: { auto: false, connectionId: model.connectionId, modelId: model.modelId },
    thinking,
    approval: ApprovalMode.Dangerous,
    facet: null,
  });

  it('offers no Off on a model that always thinks, and shows a stored Off as the Low it runs as', () => {
    const { tree, segments } = mount(pinned(opus, Off));

    expect(segments.props.options.map((o: { key: string }) => o.key)).toEqual(['auto', 'low', 'medium', 'high', 'max']);
    expect(segments.props.selected).toBe('low');
    // The pill under the box says what will run, not the stale pick.
    const pills = tree.root.findAll(n => n.props.children === 'Low' && typeof n.type === 'function');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('draws a switch model as Off and On, and a tap on On stores its one effort', () => {
    const { segments, onChange } = mount(pinned(qwen, null));

    expect(segments.props.options).toEqual([
      { key: 'auto', label: 'Auto' },
      { key: 'off', label: 'Off' },
      { key: 'medium', label: 'On' },
    ]);
    act(() => segments.props.onSelect('medium'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ thinking: Medium }));
    act(() => segments.props.onSelect('auto'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ thinking: null }));
  });

  it('reads an Auto session’s dial off the model it last routed to; the launcher offers everything', () => {
    const auto: TurnOptions = {
      selection: { auto: true, connectionId: null, modelId: null },
      thinking: null,
      approval: ApprovalMode.Dangerous,
      facet: null,
    };
    const routed = mount(auto, { routed: { connectionId: opus.connectionId, modelId: opus.modelId } });
    expect(routed.segments.props.options.map((o: { key: string }) => o.key)).not.toContain('off');

    const launcher = mount(auto);
    expect(launcher.segments.props.options.map((o: { key: string }) => o.key)).toEqual([
      'auto',
      'off',
      'low',
      'medium',
      'high',
      'max',
    ]);
  });

  it('lists models newest-first by provider, and keys each row by its connection too', () => {
    const { tree, onChange } = mount(pinned(opus, null));
    const group = tree.root.findAllByType(SheetGroup)[0];

    expect(group.props.options.map((o: { label: string }) => o.label)).toEqual(['Auto', 'Opus 5.5', 'Qwen 3.6']);
    expect(group.props.selected).toBe('c1/claude-opus-5-5');

    act(() => group.props.onSelect('local/qwen3.6-27b'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ selection: { auto: false, connectionId: 'local', modelId: 'qwen3.6-27b' } }),
    );
  });
});
