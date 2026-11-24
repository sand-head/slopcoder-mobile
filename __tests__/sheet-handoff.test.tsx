/**
 * One sheet opening another: the new-session composer's settings → model picker.
 *
 * Reported from an iPhone: tap the model row in the launcher's settings, the
 * settings sheet closes, the model picker opens, then the picker closes by
 * itself. The stand-in below behaves the way TrueSheet 4.1.0 does natively, on
 * both platforms (ios/TrueSheetView.mm, android/.../TrueSheetView.kt):
 *
 * - `present()` puts the sheet on top of the topmost presented sheet that is not
 *   being dismissed (iOS `findPresentingViewController`; Android
 *   `TrueSheetStackManager.registerSheet`), and waits if the presenter is
 *   still animating out;
 * - `dismiss()` takes down the sheet and every sheet above it (iOS dismisses
 *   from `presentingViewController`, which UIKit applies to the whole stack;
 *   Android calls `dismissStack` first), and `onDidDismiss` fires for each one
 *   when the animation lands, a moment later.
 *
 * The library's own jest mock resolves everything at once and never fires
 * `onDidDismiss`, which is how this sequence went untested.
 */
import React from 'react';
import { View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApprovalMode, type ModelCandidate } from '../src/api/contracts';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Native = { title: string; dismissing: boolean; onDidDismiss?: () => void };

// `mock`-prefixed so the factory may close over it.
const mockNative = {
  stack: [] as Native[],
  log: [] as string[],
  /** One animation frame of the native transition. */
  tick: () => new Promise<void>(resolve => setTimeout(resolve, 5)),
};

jest.mock('@lodev09/react-native-true-sheet', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  const titleOf = (children: unknown): string => {
    let found = '';
    const walk = (node: unknown) => {
      if (found || node == null || typeof node !== 'object') return;
      const el = node as { props?: { children?: unknown }; type?: unknown };
      const kids = el.props?.children;
      if (typeof kids === 'string' && el.props && (el.props as { style?: { textAlign?: string } }).style?.textAlign === 'center') {
        found = kids;
        return;
      }
      (Array.isArray(kids) ? kids : [kids]).forEach(walk);
    };
    (Array.isArray(children) ? children : [children]).forEach(walk);
    return found;
  };
  class TrueSheet extends R.Component {
    entry: Native | null = null;
    get title() {
      return titleOf(this.props.children);
    }
    async present() {
      // Wait out a presenter that is animating away, as the library does.
      while (mockNative.stack.some(e => e.dismissing)) await mockNative.tick();
      if (this.entry && mockNative.stack.includes(this.entry)) return;
      this.entry = { title: this.title, dismissing: false, onDidDismiss: () => this.props.onDidDismiss?.() };
      mockNative.stack.push(this.entry);
      mockNative.log.push(`present ${this.entry.title}`);
    }
    async dismiss() {
      const at = this.entry ? mockNative.stack.indexOf(this.entry) : -1;
      if (at < 0 || this.entry!.dismissing) return; // "already dismissed"
      const going = mockNative.stack.slice(at);
      going.forEach(e => (e.dismissing = true));
      mockNative.log.push(`dismiss ${this.entry!.title}${going.length > 1 ? ` (+${going.length - 1} above)` : ''}`);
      await mockNative.tick();
      mockNative.stack = mockNative.stack.filter(e => !going.includes(e));
      for (const e of going.reverse()) {
        mockNative.log.push(`didDismiss ${e.title}`);
        e.onDidDismiss?.();
      }
    }
    render() {
      return R.createElement(V, null, this.props.children);
    }
  }
  return { TrueSheet };
});

import { Composer } from '../src/ui/Composer';

const model: ModelCandidate = {
  connectionId: 'c1',
  connectionName: 'Anthropic',
  kind: 0,
  modelId: 'claude-opus-5-5',
  modelDisplayName: 'Opus 5.5',
  tier: 1,
  tierSource: 0,
  contextWindowTokens: null,
  defaultThinkingLevel: 0,
  supportedThinkingLevels: null,
  alwaysThinks: false,
  releaseDate: null,
} as unknown as ModelCandidate;

function Launcher() {
  const [options, setOptions] = React.useState({
    selection: { auto: true, connectionId: null as string | null, modelId: null as string | null },
    thinking: null,
    approval: ApprovalMode.Dangerous,
    facet: null,
  });
  return (
    <View>
      <Composer
        launcher
        value=""
        onChangeValue={() => {}}
        placeholder="Message a new agent…"
        action="Start"
        onAction={() => {}}
        running={false}
        options={options}
        onChangeOptions={setOptions as never}
        models={[model]}
        facets={[]}
      />
    </View>
  );
}

/** Let every queued native transition land. */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await mockNative.tick();
    });
  }
}

const presented = () => mockNative.stack.filter(e => !e.dismissing).map(e => e.title);

function press(tree: ReactTestRenderer, label: string) {
  const node = tree.root.find(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
  return act(async () => node.props.onPress());
}

beforeEach(() => {
  mockNative.stack = [];
  mockNative.log = [];
});

describe('settings → model picker on the new-session composer', () => {
  it('keeps the picker open until a model is chosen, and shows the choice', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Launcher />);
    });
    await settle();

    await press(tree, 'Turn settings');
    await settle();
    expect(presented()).toEqual(['Turn settings']);

    await press(tree, 'Model: Auto');
    await settle();
    if (process.env.SHOW_SHEET_LOG) console.log(mockNative.log.join('\n'));
    // The fault: the picker was presented on top of the settings sheet, then
    // taken down with it (and its state cleared by the settings sheet's late
    // didDismiss). It must be the only sheet up, and still up.
    expect(presented()).toEqual(['Select model']);

    const row = tree.root.find(
      n =>
        typeof n.type !== 'string' &&
        typeof n.props.onPress === 'function' &&
        n.findAll(x => x.props.children === 'Opus 5.5').length > 0 &&
        n.findAll(x => typeof x.props.onPress === 'function').length === 1,
    );
    await act(async () => row.props.onPress());
    await settle();

    // Back at the composer, with the choice applied and shown.
    expect(presented()).toEqual([]);
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Model: Opus 5.5').length).toBeGreaterThan(0);
    // Dismissed sheets never stacked: the picker opened only after settings had gone.
    expect(mockNative.log).toEqual([
      'present Turn settings',
      'dismiss Turn settings',
      'didDismiss Turn settings',
      'present Select model',
      'dismiss Select model',
      'didDismiss Select model',
    ]);
    act(() => tree.unmount());
  });

  it('still closes on the sheet\'s own dismissal (a swipe), and reopens', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Launcher />);
    });
    await press(tree, 'Turn settings');
    await settle();
    // A swipe down: native dismisses without JS asking.
    const top = mockNative.stack[mockNative.stack.length - 1];
    await act(async () => {
      mockNative.stack = [];
      top.onDidDismiss?.();
    });
    await settle();
    await press(tree, 'Turn settings');
    await settle();
    expect(presented()).toEqual(['Turn settings']);
    act(() => tree.unmount());
  });
});

describe('any sheet that hands over to another', () => {
  const { Sheet } = require('../src/ui/Sheet');
  const { Text } = require('react-native');

  // Both tree orders: the bug depended on the new sheet's effect running first.
  for (const order of ['next sheet first in the tree', 'next sheet last in the tree']) {
    it(`opens the next one only after the first has gone (${order})`, async () => {
      const closes: string[] = [];
      let set!: (s: 'a' | 'b' | null) => void;
      function Two() {
        const [open, setOpen] = React.useState<'a' | 'b' | null>('a');
        set = setOpen;
        const a = (
          <Sheet key="a" visible={open === 'a'} title="First" onClose={() => { closes.push('a'); setOpen(null); }}>
            <Text>first</Text>
          </Sheet>
        );
        const b = (
          <Sheet key="b" visible={open === 'b'} title="Second" onClose={() => { closes.push('b'); setOpen(null); }}>
            <Text>second</Text>
          </Sheet>
        );
        return <View>{order.includes('first') ? [b, a] : [a, b]}</View>;
      }
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<Two />);
      });
      await settle();
      expect(presented()).toEqual(['First']);
      await act(async () => set('b'));
      await settle();
      expect(presented()).toEqual(['Second']);
      // The first sheet's late didDismiss is not a close: nothing asked the parent to close anything.
      expect(closes).toEqual([]);
      act(() => tree.unmount());
    });
  }

  it('reports a swipe as one close, and the close button as one close', async () => {
    const onClose = jest.fn();
    let set!: (v: boolean) => void;
    function One() {
      const [open, setOpen] = React.useState(true);
      set = setOpen;
      return (
        <Sheet visible={open} title="Only" onClose={() => { onClose(); setOpen(false); }}>
          <Text>x</Text>
        </Sheet>
      );
    }
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<One />);
    });
    await settle();
    // Swipe: native goes first.
    const top = mockNative.stack.pop()!;
    await act(async () => top.onDidDismiss?.());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => set(true));
    await settle();
    await act(async () => tree.root.find(n => n.props.accessibilityLabel === 'Close' && n.props.onPress).props.onPress());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(presented()).toEqual([]);
    act(() => tree.unmount());
  });
});
