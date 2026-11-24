import React from 'react';
import { Modal } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SessionStatus } from '../src/api/contracts';
import { ChatSwitcher } from '../src/ui/ChatSwitcher';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

test('session switcher preserves sessions and closes after selection, without room controls', async () => {
  const onOpenSession = jest.fn(); const onClose = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ChatSwitcher visible onClose={onClose} onOpenSession={onOpenSession}
    sessions={[{ id: 's-1', title: 'Relay migration', model: 'auto', autoRoute: true,
      status: SessionStatus.Running, createdAt: '2026-11-17', updatedAt: '2026-11-18' }]} />); });
  const row = tree.root.find(n => n.props.accessibilityLabel === 'Open session Relay migration, running' && n.props.onPress);
  act(() => row.props.onPress());
  expect(onOpenSession).toHaveBeenCalledWith('s-1'); expect(onClose).toHaveBeenCalledTimes(1);
  expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Create channel')).toHaveLength(0);
  act(() => tree.root.findByType(Modal).props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});

test('session drawer search matches repository labels and keeps old-server sessions safe', async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ChatSwitcher visible onClose={() => {}} onOpenSession={() => {}}
    sessions={[
      { id: 's-1', title: 'First', model: 'auto', autoRoute: true, repoNames: ['SlopCoder-Mobile'],
        status: SessionStatus.Idle, createdAt: '2026-11-17', updatedAt: '2026-11-18' },
      { id: 's-2', title: 'Old server', model: 'auto', autoRoute: true,
        status: SessionStatus.Running, createdAt: '2026-11-17', updatedAt: '2026-11-18' },
    ]} />); });
  const search = tree.root.find(n => n.props.accessibilityLabel === 'Search sessions' && n.props.onChangeText);
  act(() => search.props.onChangeText('CODER-mobile'));
  expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Open session First, idle' && n.props.onPress)).toHaveLength(1);
  expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Open session Old server, running' && n.props.onPress)).toHaveLength(0);
  act(() => search.props.onChangeText('running'));
  expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Open session Old server, running' && n.props.onPress)).toHaveLength(1);
  await act(async () => tree.unmount());
});
