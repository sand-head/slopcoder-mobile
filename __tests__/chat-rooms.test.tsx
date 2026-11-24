import { TranscriptFolder } from '../src/api/transcript';
import { handleTint } from '../src/api/sessionIdentity';

test('historical room mentions remain decodable with owner provenance', () => {
  const items = new TranscriptFolder().fold([{ ordinal: 0, kind: 'ChatMentionReceived', payloadJson: JSON.stringify({
    room: 'relay', seq: 42, sender: 'Jess', fromUser: true, text: 'old message', interjected: true,
  }) }]);
  expect(items[0]).toEqual(expect.objectContaining({ kind: 'chat-mention', room: 'relay', seq: 42,
    sender: 'Jess', fromUser: true, text: 'old message', interjected: true }));
  expect(handleTint('Brisk-Comet-42')).toEqual(handleTint('brisk-comet-42'));
});
