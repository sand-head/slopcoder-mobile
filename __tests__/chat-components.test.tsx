/**
 * The two chat components a room screen is built from: the drawer that
 * switches between sessions and rooms, and the composer that posts into one.
 *
 * Both are presentational, so the suites drive them the way a screen would —
 * props in, callbacks out — and hold them to the behaviours that are easy to
 * get subtly wrong: a create that validates before it asks, keeps its input on
 * a rejection and clears only on success; a send that cannot double-post and
 * keeps the draft when the server says no.
 */
import React from 'react';
import { Modal, TextInput } from 'react-native';
import { act, create } from 'react-test-renderer';
import {
  SessionStatus,
  type ChatRoomListing,
  type ChatRoomPresence,
  type SessionSummary,
} from '../src/api/contracts';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
import {
  ChatSwitcher,
  isValidChannelName,
  normalizeChannelName,
} from '../src/ui/ChatSwitcher';
import {
  RoomComposer,
  completeMention,
  matchingMembers,
  trailingMention,
} from '../src/ui/RoomComposer';

// ---- fixtures ----

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's-1',
    title: 'Relay migration',
    model: 'auto',
    autoRoute: true,
    status: SessionStatus.Running,
    createdAt: '2026-11-17T09:00:00Z',
    updatedAt: '2026-11-18T10:00:00Z',
    ...over,
  };
}

function room(over: Partial<ChatRoomListing> = {}): ChatRoomListing {
  return {
    id: 'r-1',
    name: 'relay',
    description: 'push relay coordination',
    members: 2,
    messages: 3,
    createdAt: '2026-11-17T09:00:00Z',
    lastMessageAt: '2026-11-18T10:00:00Z',
    lastSender: 'brisk-comet-42',
    lastPreview: 'shipped the relay',
    ...over,
  };
}

function member(over: Partial<ChatRoomPresence> = {}): ChatRoomPresence {
  return {
    sessionId: 's-2',
    handle: 'brisk-comet-42',
    sessionTitle: 'Fix the relay',
    state: 'running',
    isSubSession: false,
    joinedAt: '2026-11-17T09:00:00Z',
    lastReadSeq: 3,
    ...over,
  };
}

const labels = (tree: ReturnType<typeof create>) =>
  [
    ...new Set(
      tree.root
        .findAll(
          node =>
            typeof node.props.accessibilityLabel === 'string' &&
            node.props.accessibilityRole === 'button',
        )
        .map(node => node.props.accessibilityLabel as string),
    ),
  ];

const press = (tree: ReturnType<typeof create>, label: string) => {
  const node = tree.root.find(
    n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label,
  );
  act(() => node.props.onPress());
};

const type = (tree: ReturnType<typeof create>, label: string, text: string) => {
  const node = tree.root.find(
    n => n.type === TextInput && n.props.accessibilityLabel === label,
  );
  act(() => node.props.onChangeText(text));
};

const texts = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(n => typeof n.props.children === 'string').map(n => n.props.children as string);

const mounted = new Set<ReturnType<typeof create>>();
function track(tree: ReturnType<typeof create>) {
  mounted.add(tree);
  return tree;
}

afterEach(async () => {
  for (const tree of mounted) await act(async () => tree.unmount());
  mounted.clear();
});

// ---- the switcher ----

describe('ChatSwitcher', () => {
  function mount(over: Partial<React.ComponentProps<typeof ChatSwitcher>> = {}) {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ChatSwitcher
          visible
          onClose={() => {}}
          sessions={[session()]}
          rooms={[room()]}
          onOpenSession={() => {}}
          onOpenRoom={() => {}}
          onCreateRoom={() => Promise.resolve('relay')}
          {...over}
        />,
      );
    });
    return track(tree);
  }

  it('lists sessions and channels with presence and counts', () => {
    const tree = mount();
    expect(labels(tree)).toEqual(
      expect.arrayContaining(['Open session Relay migration, running', 'Open channel relay']),
    );
    expect(texts(tree)).toEqual(
      expect.arrayContaining(['Relay migration', 'brisk-comet-42: shipped the relay']),
    );
  });

  it('renders nothing while closed', () => {
    const tree = mount({ visible: false });
    expect(tree.root.findAll(n => typeof n.props.accessibilityLabel === 'string')).toHaveLength(0);
  });

  it('shows empty hints when both lists came back empty', () => {
    const tree = mount({ sessions: [], rooms: [] });
    expect(texts(tree)).toEqual(expect.arrayContaining(['No sessions yet.']));
    expect(texts(tree)).toEqual(
      expect.arrayContaining([expect.stringContaining('No channels yet')]),
    );
  });

  it('closes on the backdrop tap and on Android back', () => {
    const onClose = jest.fn();
    const tree = mount({ onClose });

    press(tree, 'Close chat switcher');
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      tree.root.findByType(Modal).props.onRequestClose();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens a session and closes the drawer', () => {
    const onOpenSession = jest.fn();
    const onClose = jest.fn();
    const tree = mount({ onOpenSession, onClose });

    press(tree, 'Open session Relay migration, running');
    expect(onOpenSession).toHaveBeenCalledWith('s-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('normalizes and validates channel names', () => {
    expect(normalizeChannelName('  #Relay-Ops ')).toBe('relay-ops');
    expect(normalizeChannelName('##x')).toBe('x');
    expect(isValidChannelName('relay-ops')).toBe(true);
    expect(isValidChannelName('1')).toBe(true);
    expect(isValidChannelName('-lead')).toBe(false);
    expect(isValidChannelName('has space')).toBe(false);
    expect(isValidChannelName('a'.repeat(65))).toBe(false);
  });

  it('validates before asking the server to create', () => {
    const onCreateRoom = jest.fn();
    const tree = mount({ onCreateRoom });

    press(tree, 'Create channel');
    type(tree, 'Channel name', 'Bad Name!');
    press(tree, 'Create');

    expect(onCreateRoom).not.toHaveBeenCalled();
    expect(texts(tree)).toEqual(
      expect.arrayContaining([expect.stringContaining('Names start with a letter or digit')]),
    );
    // The bad draft is still there to fix.
    expect(tree.root.find(n => n.type === TextInput && n.props.accessibilityLabel === 'Channel name').props.value).toBe('Bad Name!');
  });

  it('normalizes the name, opens the resolved room and closes on success', async () => {
    const onCreateRoom = jest.fn(() => Promise.resolve('relay-ops'));
    const onOpenRoom = jest.fn();
    const onClose = jest.fn();
    const tree = mount({ onCreateRoom, onOpenRoom, onClose });

    press(tree, 'Create channel');
    type(tree, 'Channel name', '  #Relay-Ops ');
    type(tree, 'Channel description', 'where the relay work lives');
    await act(async () => {
      tree.root
        .find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Create')
        .props.onPress();
    });

    expect(onCreateRoom).toHaveBeenCalledWith('relay-ops', 'where the relay work lives');
    expect(onOpenRoom).toHaveBeenCalledWith('relay-ops');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the input and shows the error at the form when creation fails', async () => {
    const onCreateRoom = jest.fn(() => Promise.reject(new Error('a room with that name exists')));
    const onOpenRoom = jest.fn();
    const tree = mount({ onCreateRoom, onOpenRoom });

    press(tree, 'Create channel');
    type(tree, 'Channel name', 'relay');
    await act(async () => {
      tree.root
        .find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Create')
        .props.onPress();
    });

    expect(onOpenRoom).not.toHaveBeenCalled();
    expect(texts(tree)).toEqual(expect.arrayContaining(['a room with that name exists']));
    expect(
      tree.root.find(n => n.type === TextInput && n.props.accessibilityLabel === 'Channel name').props.value,
    ).toBe('relay');
  });
});

// ---- the composer ----

describe('mention helpers', () => {
  it('finds a trailing mention only when @ opens the last word', () => {
    expect(trailingMention('check @bru')).toEqual({ start: 6, partial: 'bru' });
    expect(trailingMention('@')).toEqual({ start: 0, partial: '' });
    expect(trailingMention('mail me at a@b.co')).toBeNull();
    expect(trailingMention('settled @ada now')).toBeNull();
  });

  it('completes by replacing the trailing token', () => {
    const at = trailingMention('check @bru')!;
    expect(completeMention('check @bru', at, 'brisk-comet-42')).toBe('check @brisk-comet-42 ');
  });

  it('ranks prefix matches ahead of substring matches', () => {
    const members = [
      member({ sessionId: 'a', handle: 'quiet-otter-7' }),
      member({ sessionId: 'b', handle: 'brisk-comet-42' }),
      member({ sessionId: 'c', handle: 'web-bridge-2' }),
    ];
    expect(matchingMembers(members, 'bri').map(m => m.handle)).toEqual([
      'brisk-comet-42',
      'web-bridge-2',
    ]);
    expect(matchingMembers(members, 'otte').map(m => m.handle)).toEqual(['quiet-otter-7']);
  });
});

describe('RoomComposer', () => {
  const members = [
    member(),
    member({ sessionId: 's-3', handle: 'quiet-otter-7', sessionTitle: 'Tidy the logs', state: 'idle' }),
  ];

  function mount(over: Partial<React.ComponentProps<typeof RoomComposer>> = {}) {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <RoomComposer roomName="relay" members={members} onSend={() => Promise.resolve()} {...over} />,
      );
    });
    return track(tree);
  }

  const inputValue = (tree: ReturnType<typeof create>) =>
    tree.root.find(n => n.type === TextInput && n.props.accessibilityLabel === 'Message #relay').props
      .value as string;

  it('offers matching members for the trailing mention and completes a tap', () => {
    const tree = mount();
    type(tree, 'Message #relay', 'can you check @bri');

    expect(labels(tree)).toContain('Mention brisk-comet-42');
    expect(labels(tree)).not.toContain('Mention quiet-otter-7');

    press(tree, 'Mention brisk-comet-42');
    expect(inputValue(tree)).toBe('can you check @brisk-comet-42 ');
  });

  it('shows no suggestions once the mention is settled mid-draft', () => {
    const tree = mount();
    type(tree, 'Message #relay', '@brisk-comet-42 can you check');
    expect(labels(tree)).not.toContain('Mention brisk-comet-42');
  });

  it('the @ button inserts @ and offers the room', () => {
    const tree = mount();
    press(tree, 'Mention an agent');
    expect(inputValue(tree)).toBe('@');
    expect(labels(tree)).toEqual(
      expect.arrayContaining(['Mention brisk-comet-42', 'Mention quiet-otter-7']),
    );
  });

  it('does not carry a standing notification explainer under the composer', () => {
    const tree = mount();
    expect(texts(tree)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Only agents you @mention')]),
    );
  });

  it('clears the draft only after the send resolves', async () => {
    const onSend = jest.fn(() => Promise.resolve());
    const tree = mount({ onSend });

    type(tree, 'Message #relay', 'shipping the relay');
    await act(async () => {
      tree.root
        .find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Send message')
        .props.onPress();
    });

    expect(onSend).toHaveBeenCalledWith('shipping the relay');
    expect(inputValue(tree)).toBe('');
  });

  it('keeps the draft and shows the error at the composer when send fails', async () => {
    const onSend = jest.fn(() => Promise.reject(new Error('room is read-only')));
    const tree = mount({ onSend });

    type(tree, 'Message #relay', 'anyone there?');
    await act(async () => {
      tree.root
        .find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Send message')
        .props.onPress();
    });

    expect(texts(tree)).toEqual(expect.arrayContaining(['room is read-only']));
    expect(inputValue(tree)).toBe('anyone there?');
  });

  it('clears the failure once the draft is edited', async () => {
    const onSend = jest.fn(() => Promise.reject(new Error('room is read-only')));
    const tree = mount({ onSend });

    type(tree, 'Message #relay', 'anyone there?');
    await act(async () => {
      tree.root
        .find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Send message')
        .props.onPress();
    });
    expect(texts(tree)).toEqual(expect.arrayContaining(['room is read-only']));

    type(tree, 'Message #relay', 'anyone there? still around?');
    expect(texts(tree)).not.toEqual(expect.arrayContaining(['room is read-only']));
  });

  it('cannot double-send while a send is in flight', async () => {
    let resolveSend: () => void = () => {};
    const onSend = jest.fn(
      () =>
        new Promise<void>(resolve => {
          resolveSend = resolve;
        }),
    );
    const tree = mount({ onSend });

    type(tree, 'Message #relay', 'once');
    const send = () =>
      tree.root
        .find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Send message')
        .props.onPress();

    await act(async () => {
      send();
    });
    expect(onSend).toHaveBeenCalledTimes(1);

    // A second tap while the first send is unresolved is dropped, even though
    // the button is already showing its busy spinner.
    await act(async () => {
      send();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(inputValue(tree)).toBe('once');

    await act(async () => {
      resolveSend();
    });
    expect(inputValue(tree)).toBe('');
  });
});
