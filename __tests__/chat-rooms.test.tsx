/**
 * Chat rooms: where a user's agent sessions talk to one another, read on the
 * phone. Ports of `Pages/Rooms.razor`'s decisions, the hub signal that keeps
 * the pages live, the transcript row a pushed @mention becomes, and the two
 * screens.
 *
 * The hub half is the one that fails silently: a `RoomChanged` handler bound
 * with the wrong arity is dropped by SignalR without a word, and the pages
 * simply stop updating.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { ChatRoomEntry, ChatRoomListing, ChatRoomPresence, ChatRoomView } from '../src/api/contracts';
import {
  handleTint,
  memberLine,
  mergeRoom,
  prependEarlier,
  serialRefresh,
  touches,
  unread,
} from '../src/api/rooms';
import { TranscriptFolder, modelDivider } from '../src/api/transcript';

// ---- fixtures ----

const listing: ChatRoomListing = {
  id: 'r-1',
  name: 'relay',
  description: 'push relay coordination',
  members: 2,
  messages: 3,
  createdAt: '2026-11-17T09:00:00Z',
  lastMessageAt: '2026-11-17T10:00:00Z',
  lastSender: 'brisk-comet-42',
  lastPreview: 'shipped the relay',
};

function entry(seq: number, over: Partial<ChatRoomEntry> = {}): ChatRoomEntry {
  return {
    seq,
    senderSessionId: 's-1',
    sender: 'brisk-comet-42',
    text: `message ${seq}`,
    mentioned: [],
    at: '2026-11-17T10:00:00Z',
    ...over,
  };
}

const member: ChatRoomPresence = {
  sessionId: 's-2',
  handle: 'quiet-otter-7',
  sessionTitle: 'Fix the relay',
  state: 'running',
  isSubSession: true,
  joinedAt: '2026-11-17T09:00:00Z',
  lastReadSeq: 2,
};

function view(messages: ChatRoomEntry[], hasEarlier = false): ChatRoomView {
  return { room: listing, members: [member], messages, hasEarlier };
}

// ---- the decisions ----

describe('rooms', () => {
  /** Reference values from the web's `Tint`, run with C#'s int32 wrap-around. */
  it('tints a handle the shade the web does, whatever its case', () => {
    expect(handleTint('brisk-comet-42')).toBe('orange');
    expect(handleTint('Brisk-Comet-42')).toBe('orange');
    expect(handleTint('quiet-otter-7')).toBe('fuchsia');
    expect(handleTint('calm-river-1003')).toBe('amber');
  });

  it('appends new messages to a fresh read and keeps pages already paged back to', () => {
    let page = mergeRoom(null, view([entry(3), entry(4)], true));
    expect(page.messages.map(m => m.seq)).toEqual([3, 4]);
    expect(page.view.hasEarlier).toBe(true);

    page = prependEarlier(page, view([entry(1), entry(2)], false));
    expect(page.messages.map(m => m.seq)).toEqual([1, 2, 3, 4]);
    expect(page.view.hasEarlier).toBe(false);

    // The newest window comes back with only the tail and says there is more
    // before it; the reader has already loaded all of it, so that stands.
    page = mergeRoom(page, view([entry(4), entry(5)], true));
    expect(page.messages.map(m => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(page.view.hasEarlier).toBe(false);
  });

  it('counts unread against the newest loaded message', () => {
    const messages = [entry(1), entry(2), entry(5)];
    expect(unread(member, messages)).toBe(3);
    expect(unread(member, [])).toBe(0);
    expect(memberLine(member, messages)).toBe('sub-session · running · 3 unread');
    expect(memberLine({ ...member, isSubSession: false, lastReadSeq: 9 }, messages)).toBe('running');
  });

  it('takes "" as touching every room, and matches names without case', () => {
    expect(touches('', 'relay')).toBe(true);
    expect(touches('Relay', 'relay')).toBe(true);
    expect(touches('other', 'relay')).toBe(false);
    expect(touches('relay', null)).toBe(false);
  });

  it('runs one re-read at a time, and a burst during it as exactly one more', async () => {
    const calls: boolean[] = [];
    let release: () => void = () => {};
    const run = jest.fn(
      (withRoom: boolean) =>
        new Promise<void>(resolve => {
          calls.push(withRoom);
          release = resolve;
        }),
    );
    const refresh = serialRefresh(run);

    refresh(false);
    refresh(false);
    refresh(true);
    refresh(false);
    expect(calls).toEqual([false]);

    await act(async () => release());
    expect(calls).toEqual([false, true]);
    await act(async () => release());
    expect(calls).toEqual([false, true]);
  });
});

// ---- the transcript ----

describe('the transcript', () => {
  it('folds a pushed @mention into its own row, never a prompt', () => {
    const items = new TranscriptFolder().fold([
      {
        ordinal: 0,
        kind: 'ChatMentionReceived',
        payloadJson: JSON.stringify({
          roomId: 'r-1',
          room: 'relay',
          seq: 42,
          senderSessionId: 's-1',
          sender: 'brisk-comet-42',
          text: '@quiet-otter-7 can you take the relay?',
          member: true,
          interjected: true,
        }),
      },
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'chat-mention',
        room: 'relay',
        seq: 42,
        sender: 'brisk-comet-42',
        text: '@quiet-otter-7 can you take the relay?',
        interjected: true,
      }),
    ]);
  });

  /** A change of routed effort alone puts a new divider in; it has to say so. */
  it('names the effort an Auto turn was routed at, and only on Auto', () => {
    expect(modelDivider('claude-sonnet-5-5', true, 3)).toBe('claude-sonnet-5-5 · auto · high effort');
    expect(modelDivider('claude-sonnet-5-5', true, null)).toBe('claude-sonnet-5-5 · auto');
    expect(modelDivider('claude-sonnet-5-5', false, 3)).toBe('claude-sonnet-5-5');

    const items = new TranscriptFolder().fold([
      { ordinal: 0, kind: 'ModelSelected', payloadJson: JSON.stringify({ model: 'gpt-6-sol', autoRouted: true, effort: 1 }) },
    ]);
    expect(items[0]).toEqual(expect.objectContaining({ kind: 'divider', label: 'gpt-6-sol · auto · low effort' }));
  });
});

// ---- the hub ----

const mockConnections: any[] = [];
jest.mock('@microsoft/signalr', () => {
  class Connection {
    state = 'Disconnected';
    handlers: Record<string, (...args: any[]) => void> = {};
    reconnected: (() => void) | null = null;
    on(name: string, handler: (...args: any[]) => void) {
      this.handlers[name] = handler;
    }
    onreconnected(handler: () => void) {
      this.reconnected = handler;
    }
    onreconnecting() {}
    onclose() {}
    async invoke() {
      return null;
    }
    async start() {
      this.state = 'Connected';
    }
    async stop() {
      this.state = 'Disconnected';
    }
  }
  class Builder {
    withUrl() {
      return this;
    }
    withAutomaticReconnect() {
      return this;
    }
    build() {
      const connection = new Connection();
      mockConnections.push(connection);
      return connection;
    }
  }
  return {
    HubConnectionBuilder: Builder,
    HubConnectionState: { Connected: 'Connected', Disconnected: 'Disconnected' },
    HttpTransportType: { None: 0, WebSockets: 1, ServerSentEvents: 2, LongPolling: 4 },
  };
});

describe('the hub', () => {
  it('passes RoomChanged on with its one argument, and "" after a reconnect', async () => {
    const { SessionHub } = require('../src/api/hub');
    const hub = new SessionHub({ baseUrl: 'https://slop.example', apiKey: 'k' });
    await hub.start();
    const connection = mockConnections[mockConnections.length - 1];

    const heard: string[] = [];
    const stop = hub.addRoomListener((room: string) => heard.push(room));

    // One parameter: SignalR binds by arity, and a mismatch is dropped silently.
    expect(connection.handlers.RoomChanged).toHaveLength(1);
    connection.handlers.RoomChanged('relay');
    connection.reconnected();
    expect(heard).toEqual(['relay', '']);

    stop();
    connection.handlers.RoomChanged('relay');
    expect(heard).toEqual(['relay', '']);
    await hub.stop();
  });
});

// ---- the screens ----

const mockSeam = {
  chatRooms: jest.fn(() => Promise.resolve([listing])),
  chatRoom: jest.fn((_name: string, _before?: number | null) =>
    Promise.resolve<ChatRoomView | null>(view([entry(3), entry(4, { mentioned: ['quiet-otter-7'] })], true)),
  ),
  deleteChatRoom: jest.fn(() => Promise.resolve(true)),
};
const mockRoomListeners = new Set<(room: string) => void>();
const mockHub = {
  addRoomListener: (listener: (room: string) => void) => {
    mockRoomListeners.add(listener);
    return () => mockRoomListeners.delete(listener);
  },
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) => select({ seam: mockSeam }),
}));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: mockHub, connected: true }) }));

const { RoomsScreen, RoomScreen } = require('../src/screens/Rooms');

function navigator() {
  return {
    navigate: jest.fn(),
    push: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: () => () => {},
  };
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

async function mount(element: React.ReactElement) {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(element);
  });
  await act(async () => {});
  return tree!;
}

async function signal(room: string) {
  await act(async () => {
    for (const listener of [...mockRoomListeners]) listener(room);
  });
  await act(async () => {});
}

beforeEach(() => {
  Object.values(mockSeam).forEach(fn => fn.mockClear());
});

describe('the rooms list', () => {
  it('shows each room with its last message and counts, and opens one', async () => {
    const navigation = navigator();
    const tree = await mount(<RoomsScreen navigation={navigation} />);

    const rendered = text(tree);
    expect(rendered).toContain('#relay');
    expect(rendered).toContain('brisk-comet-42: shipped the relay');
    expect(rendered).toContain('2 members · 3 messages');

    await act(async () =>
      tree.root
        .find(n => n.props.accessibilityLabel === '#relay, brisk-comet-42: shipped the relay' && n.props.onPress)
        .props.onPress(),
    );
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { name: 'relay' });
    await act(async () => tree.unmount());
  });

  it('re-reads on any room’s signal', async () => {
    const tree = await mount(<RoomsScreen navigation={navigator()} />);
    const before = mockSeam.chatRooms.mock.calls.length;
    await signal('elsewhere');
    expect(mockSeam.chatRooms.mock.calls.length).toBe(before + 1);
    await act(async () => tree.unmount());
  });

  it('says what a room is when there are none', async () => {
    mockSeam.chatRooms.mockImplementationOnce(() => Promise.resolve([]));
    const tree = await mount(<RoomsScreen navigation={navigator()} />);
    expect(text(tree)).toContain('create_room');
    await act(async () => tree.unmount());
  });
});

describe('one room', () => {
  const route = { params: { name: 'relay' } };

  it('shows its messages oldest first, who they mentioned, and opens the sender’s session', async () => {
    const navigation = navigator();
    const tree = await mount(<RoomScreen route={route} navigation={navigation} />);

    const rendered = text(tree);
    expect(rendered.indexOf('message 3')).toBeLessThan(rendered.indexOf('message 4'));
    expect(rendered).toContain('→ quiet-otter-7');
    expect(rendered).toContain('push relay coordination');
    expect(navigation.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ title: '#relay' }));

    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'brisk-comet-42, open this session' && n.props.onPress)[0]
        .props.onPress(),
    );
    expect(navigation.push).toHaveBeenCalledWith('Session', { id: 's-1' });
    await act(async () => tree.unmount());
  });

  it('pages back from the oldest message it has', async () => {
    const tree = await mount(<RoomScreen route={route} navigation={navigator()} />);
    mockSeam.chatRoom.mockImplementationOnce(() => Promise.resolve(view([entry(1), entry(2)], false)));

    await act(async () =>
      tree.root.find(n => n.props.accessibilityLabel === 'Load earlier messages' && n.props.onPress).props.onPress(),
    );
    await act(async () => {});

    expect(mockSeam.chatRoom).toHaveBeenLastCalledWith('relay', 3);
    const rendered = text(tree);
    expect(rendered).toContain('message 1');
    expect(rendered).not.toContain('Load earlier messages');
    await act(async () => tree.unmount());
  });

  it('re-reads only for its own room', async () => {
    const tree = await mount(<RoomScreen route={route} navigation={navigator()} />);
    const before = mockSeam.chatRoom.mock.calls.length;
    await signal('elsewhere');
    expect(mockSeam.chatRoom.mock.calls.length).toBe(before);
    await signal('RELAY');
    expect(mockSeam.chatRoom.mock.calls.length).toBe(before + 1);
    await act(async () => tree.unmount());
  });

  it('says so when the room is gone', async () => {
    mockSeam.chatRoom.mockImplementationOnce(() => Promise.resolve(null));
    const tree = await mount(<RoomScreen route={route} navigation={navigator()} />);
    expect(text(tree)).toContain('No such room');
    await act(async () => tree.unmount());
  });

  it('deletes only once confirmed, then leaves', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const navigation = navigator();
    const tree = await mount(<RoomScreen route={route} navigation={navigation} />);

    const options = navigation.setOptions.mock.calls[navigation.setOptions.mock.calls.length - 1][0];
    const [menu] = options.unstable_headerRightItems();
    const remove = menu.menu.items.find((item: { label: string }) => item.label === 'Delete room');
    act(() => remove.onPress());
    expect(mockSeam.deleteChatRoom).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find(b => b.text === 'Delete')!.onPress!());
    await act(async () => {});
    expect(mockSeam.deleteChatRoom).toHaveBeenCalledWith('relay');
    expect(navigation.goBack).toHaveBeenCalled();

    alert.mockRestore();
    await act(async () => tree.unmount());
  });
});
