import React from 'react';
import { act, create } from 'react-test-renderer';
import { useSession, type SessionView } from '../src/state/session';
import type { Seam } from '../src/api/seam';
import type { SessionHub } from '../src/api/hub';

const envelope = (ordinal: number) => ({ ordinal, kind: 'UserPrompt', payloadJson: JSON.stringify({ text: `event ${ordinal}` }) });
const session = { nextOrdinal: 240, live: null };
let view: SessionView;
const hub = { addListener: jest.fn(), removeListener: jest.fn(), subscribe: jest.fn(async () => null), unsubscribe: jest.fn(async () => {}) };
function Probe({ seam, id }: { seam: Seam; id: string }) { view = useSession(seam, hub as unknown as SessionHub, id); return null; }

test('earlier paging is single-flight and returns actual progress', async () => {
  let resolve!: (value: ReturnType<typeof envelope>[]) => void;
  const scrollback = jest.fn().mockResolvedValueOnce(Array.from({ length: 120 }, (_, i) => envelope(i + 120)))
    .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const seam = { session: jest.fn(async () => session), scrollback, presence: jest.fn(async () => true) } as unknown as Seam;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Probe seam={seam} id="a" />); });
  let one!: ReturnType<SessionView['loadEarlier']>; let two!: ReturnType<SessionView['loadEarlier']>;
  act(() => { one = view.loadEarlier(); two = view.loadEarlier(); });
  expect(one).toBe(two);
  await act(async () => { resolve(Array.from({ length: 120 }, (_, i) => envelope(i))); await one; });
  expect(await one).toMatchObject({ progress: true, hasMore: false });
  expect(scrollback).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});

test('earlier network errors are returned rather than unhandled', async () => {
  const scrollback = jest.fn().mockResolvedValueOnce(Array.from({ length: 120 }, (_, i) => envelope(i + 120)))
    .mockRejectedValueOnce(new Error('offline'));
  const seam = { session: jest.fn(async () => session), scrollback, presence: jest.fn(async () => true) } as unknown as Seam;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Probe seam={seam} id="a" />); });
  let result!: Awaited<ReturnType<SessionView['loadEarlier']>>;
  await act(async () => { result = await view.loadEarlier(); });
  expect(result).toMatchObject({ progress: false, hasMore: true, error: 'offline' });
  await act(async () => tree.unmount());
});

test('a stale earlier response cannot publish into a different session', async () => {
  let release!: (value: ReturnType<typeof envelope>[]) => void;
  const scrollback = jest.fn().mockResolvedValueOnce(Array.from({ length: 120 }, (_, i) => envelope(i + 120)))
    .mockImplementationOnce(() => new Promise(done => { release = done; }))
    .mockResolvedValue(Array.from({ length: 120 }, (_, i) => envelope(i + 120)));
  const seam = { session: jest.fn(async () => session), scrollback, presence: jest.fn(async () => true) } as unknown as Seam;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Probe seam={seam} id="a" />); });
  let pending!: ReturnType<SessionView['loadEarlier']>;
  act(() => { pending = view.loadEarlier(); });
  await act(async () => { tree.update(<Probe seam={seam} id="b" />); });
  await act(async () => { release(Array.from({ length: 120 }, (_, i) => envelope(i))); await pending; });
  expect(await pending).toMatchObject({ progress: false });
  expect(view.items.every(item => item.ordinal >= 120)).toBe(true);
  await act(async () => tree.unmount());
});
