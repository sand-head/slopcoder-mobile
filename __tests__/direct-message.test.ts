import { TranscriptFolder } from '../src/api/transcript';
import type { AgentEventEnvelope } from '../src/api/contracts';

const envelope = (ordinal: number, kind: string, payload: object): AgentEventEnvelope => ({
  ordinal, kind, payloadJson: JSON.stringify(payload),
});
const direct = { messageId: 'dedup-1', senderSessionId: 'sender-1', sender: 'amber', text: '<b>untrusted</b>\nhello', interjected: true };

test('direct peer message is attributed, deduplicated, and distinct from legacy user and room messages', () => {
  const events = [
    envelope(0, 'UserPrompt', { text: 'owner' }),
    envelope(1, 'DirectMessageReceived', { ...direct, fromUser: true }),
    envelope(2, 'DirectMessageReceived', direct),
    envelope(3, 'ChatMentionReceived', { sender: 'peer', text: 'old', room: 'relay', seq: 7 }),
    envelope(4, 'DirectMessageReceived', { ...direct, messageId: 'dedup-2', senderSessionId: null, interjected: false }),
  ];
  const folder = new TranscriptFolder();
  const items = folder.fold(events);
  expect(items.map(i => i.kind)).toEqual(['user', 'direct-message', 'chat-mention', 'direct-message']);
  expect(items[1]).toEqual(expect.objectContaining({ ...direct, kind: 'direct-message', ordinal: 1 }));
  expect(items[1]).not.toHaveProperty('fromUser');
  expect(items[1]).not.toHaveProperty('room');
  expect(items[3]).toEqual(expect.objectContaining({ senderSessionId: null, interjected: false }));
  expect(folder.fold(events)).toHaveLength(4);
  expect(folder.refold(events)).toHaveLength(4);
});
