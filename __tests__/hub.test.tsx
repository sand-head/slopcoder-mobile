/**
 * The live connection, and the two ways it stopped being live.
 *
 * The first TestFlight build showed "Reconnecting to live updates…" forever,
 * and there were two separate reasons for it. Both are invisible to every other
 * kind of test: the unit suites do not open sockets, and on a desk the server
 * is always up and the handshake always succeeds on the first try.
 *
 * - Each screen built its own hub. Opening a session gave you a second socket,
 *   and closing it announced the connection lost while the list's was still
 *   connected. Nothing ever said otherwise.
 * - A handshake that failed left the built connection assigned, so every later
 *   `start()` returned at the guard and the automatic reconnect policy — which
 *   only ever covers a socket that dropped after connecting once — never
 *   engaged. Launching out of signal wedged the app until it was killed.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

const started: string[] = [];
const built: any[] = [];

/** A hub connection that does what it is told to do, and says when. */
jest.mock('@microsoft/signalr', () => {
  class Connection {
    state = 'Disconnected';
    handlers: Record<string, (...args: any[]) => void> = {};
    closed: (() => void) | null = null;
    /** Set by a test to make the next handshake fail. */
    static failNext = false;

    on() {}
    onreconnected() {}
    onreconnecting() {}
    onclose(handler: () => void) {
      this.closed = handler;
    }
    async invoke() {
      return null;
    }
    async start() {
      started.push('start');
      if (Connection.failNext) throw new Error('no route to host');
      this.state = 'Connected';
    }
    async stop() {
      this.state = 'Disconnected';
      this.closed?.();
    }
  }

  class Builder {
    static options: any = null;
    withUrl(_url: string, options: any) {
      Builder.options = options;
      return this;
    }
    withAutomaticReconnect() {
      return this;
    }
    build() {
      const connection = new Connection();
      built.push(connection);
      return connection;
    }
  }

  return {
    HubConnectionBuilder: Builder,
    HubConnectionState: { Connected: 'Connected', Disconnected: 'Disconnected' },
    // The real values, because the code combines them as flags.
    HttpTransportType: { None: 0, WebSockets: 1, ServerSentEvents: 2, LongPolling: 4 },
    __Connection: Connection,
    __Builder: Builder,
  };
});

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: {},
}));
jest.mock('../src/push', () => ({ enablePush: jest.fn(), disablePush: jest.fn() }));

const signalr = require('@microsoft/signalr');
const { useAuth } = require('../src/state/auth');
const { useConnection } = require('../src/state/connection');
const { useSessionHub } = require('../src/state/hub');

const CREDENTIAL = { server: 'https://slop.example', apiKey: 'sk-1', userName: 'jessie' };

/** Every screen still mounted, so a test cannot leak one into the next. */
const mounted = new Set<ReturnType<typeof create>>();

/** A screen that wants the hub, mounted and unmounted like a real one. */
function screen() {
  let hub: unknown = null;
  function Screen() {
    hub = useSessionHub().hub;
    return <Text>screen</Text>;
  }

  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(<Screen />);
  });
  mounted.add(tree!);

  return {
    get hub() {
      return hub;
    },
    close: () => {
      if (!mounted.delete(tree!)) return;
      act(() => tree!.unmount());
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  started.length = 0;
  built.length = 0;
  signalr.__Connection.failNext = false;
  useConnection.setState({ reachable: true, live: false });
  useAuth.setState({ credential: CREDENTIAL });
});

afterEach(() => {
  // Let the shared hub go, so the next test starts from nothing. A screen left
  // mounted would otherwise still be holding a reference to it — and would take
  // another the moment the next test signed in again.
  for (const tree of mounted) act(() => tree.unmount());
  mounted.clear();
  act(() => useAuth.setState({ credential: null }));
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('the shared hub', () => {
  it('opens one connection however many screens want it', async () => {
    const list = screen();
    const detail = screen();

    await act(async () => {});

    expect(built).toHaveLength(1);
    expect(list.hub).toBe(detail.hub);
    expect(useConnection.getState().live).toBe(true);

    detail.close();
  });

  it('stays live when a screen that was using it goes away', async () => {
    const list = screen();
    const detail = screen();
    await act(async () => {});

    detail.close();

    // The list is still showing, still subscribed, still receiving. Saying the
    // connection dropped here is the banner that would not go away.
    expect(useConnection.getState().live).toBe(true);
    expect(built).toHaveLength(1);

    list.close();
  });

  it('lets the connection go once nothing is using it', async () => {
    const only = screen();
    await act(async () => {});

    only.close();
    expect(useConnection.getState().live).toBe(true);

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(useConnection.getState().live).toBe(false);
  });

  it('keeps the connection across a navigation', async () => {
    const list = screen();
    await act(async () => {});

    // Push and pop, each of which releases before the next acquires.
    const detail = screen();
    list.close();
    detail.close();
    const again = screen();

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(built).toHaveLength(1);
    expect(useConnection.getState().live).toBe(true);

    again.close();
  });
});

describe('the transport', () => {
  /**
   * A socket that cannot be established — a proxy that will not upgrade, a
   * network that eats WebSockets — is indistinguishable from a hung connection
   * from inside the app, and pinning the client to WebSockets alone turns that
   * into a transcript that never updates. Long polling is the fallback; SSE is
   * not, because React Native has no EventSource and it would fail the same
   * silent way it is meant to rescue.
   */
  it('falls back to long polling but never to server-sent events', async () => {
    screen();
    await act(async () => {});

    const { transport } = signalr.__Builder.options;
    const { WebSockets, LongPolling, ServerSentEvents } = signalr.HttpTransportType;

    /* eslint-disable no-bitwise */
    expect(transport & WebSockets).toBeTruthy();
    expect(transport & LongPolling).toBeTruthy();
    expect(transport & ServerSentEvents).toBeFalsy();
    /* eslint-enable no-bitwise */
  });
});

describe('a handshake that fails', () => {
  it('tries again rather than wedging', async () => {
    signalr.__Connection.failNext = true;

    const list = screen();
    await act(async () => {});

    expect(useConnection.getState().live).toBe(false);
    expect(started).toHaveLength(1);

    // The retry the automatic reconnect policy would never make, because it
    // only covers a socket that connected once.
    signalr.__Connection.failNext = false;
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    expect(started.length).toBeGreaterThan(1);
    expect(useConnection.getState().live).toBe(true);

    list.close();
  });

  /**
   * The phone has no console. Without this the only account of a connection
   * that never arrives is a bar reading "Reconnecting to live updates…", which
   * says nothing about whether it is the key, the proxy or the network.
   */
  it('keeps the reason, so the banner can be asked why', async () => {
    signalr.__Connection.failNext = true;

    const list = screen();
    await act(async () => {});

    expect(useConnection.getState().reason).toBe('no route to host');

    signalr.__Connection.failNext = false;
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    // And drops it once there is nothing to explain.
    expect(useConnection.getState().reason).toBeNull();

    list.close();
  });

  it('keeps trying for as long as the server is away', async () => {
    signalr.__Connection.failNext = true;

    const list = screen();
    await act(async () => {});

    for (let i = 0; i < 4; i++) {
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
    }

    expect(started.length).toBeGreaterThan(3);
    expect(useConnection.getState().live).toBe(false);

    list.close();
  });
});
