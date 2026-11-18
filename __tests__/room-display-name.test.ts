import type { ChatRoomEntry, ChatRoomPresence } from '../src/api/contracts';
import { senderDisplayName } from '../src/api/rooms';

const member: ChatRoomPresence = {
  sessionId: 's-1',
  handle: 'brisk-comet-42',
  sessionTitle: 'Fix the relay',
  state: 'idle',
  isSubSession: false,
  joinedAt: '2026-11-18T10:00:00Z',
  lastReadSeq: 0,
};

function message(over: Partial<ChatRoomEntry> = {}): ChatRoomEntry {
  return {
    seq: 1,
    senderSessionId: 's-1',
    sender: 'brisk-comet-42',
    text: 'hello',
    mentioned: [],
    at: '2026-11-18T10:01:00Z',
    ...over,
  };
}

describe('channel sender display names', () => {
  it('uses the server’s session title even when the sender is not a room member', () => {
    expect(
      senderDisplayName(
        message({ senderSessionId: 'outside-room', senderSessionTitle: 'Review the release' }),
        [member],
      ),
    ).toBe('Review the release');
  });

  it('falls back to the member title on an older server, then the handle', () => {
    expect(senderDisplayName(message(), [member])).toBe('Fix the relay');
    expect(senderDisplayName(message({ senderSessionId: 'deleted', sender: 'old-handle' }), [member])).toBe('old-handle');
  });

  it('leaves a human owner’s display name alone', () => {
    expect(
      senderDisplayName(
        message({ senderSessionId: null, sender: 'Jess', fromUser: true }),
        [member],
      ),
    ).toBe('Jess');
  });
});
