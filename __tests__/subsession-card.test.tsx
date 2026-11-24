import React from 'react';
import { act, create } from 'react-test-renderer';
import { SubSessionCard } from '../src/ui/SubSessionCard';

jest.mock('../src/state/auth', () => ({ useAuth: (select: (s: unknown) => unknown) => select({ seam: null }) }));
jest.mock('../src/state/hub', () => ({ useSessionHub: () => ({ hub: null }) }));
jest.mock('../src/state/session', () => ({ useSession: () => ({
  state: { status: require('../src/api/contracts').SessionStatus.Idle, pendingApprovalIds: [], pendingQuestionIds: [] },
  items: [{ kind: 'user', key: 'p', text: 'Check keyboard' }, ...Array.from({ length: 6 }, (_, i) => ({ kind: 'text', key: `r${i}`, text: `Checked ${i}.` }))], error: null,
}) }));

it('discloses real activity independently from opening the read-only session', () => {
  const open = jest.fn();
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SubSessionCard item={{ kind: 'subsession', key: 's', subSessionId: 'id',
    ordinal: 1, sub: null, name: 'Keyboard check', persona: 'Cedar', profile: 'Explorer', model: 'model-1', color: '', routeReason: null }} onOpen={open} />); });
  const header = () => tree.root.find(node => node.props.accessibilityRole === 'button' && node.props.accessibilityState?.expanded !== undefined && node.props.onPress);
  expect(header().props.accessibilityLabel).toContain('Explorer, model-1');
  expect(tree.root.findAll(node => node.props.children === 'Check keyboard').length).toBeGreaterThan(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Parent session');
  expect(JSON.stringify(tree.toJSON())).toContain('Cedar');
  act(() => header().props.onPress());
  expect(header().props.accessibilityState.expanded).toBe(false);
  expect(tree.root.findAll(node => node.props.children === 'Check keyboard')).toHaveLength(0);
  expect(open).not.toHaveBeenCalled();
  act(() => tree.root.find(node => node.props.accessibilityLabel === 'Open Cedar activity' && node.props.onPress).props.onPress());
  expect(open).toHaveBeenCalledWith('id');
  act(() => tree.unmount());
});
