import fs from 'fs';
import path from 'path';
import { getStateFromPath } from '@react-navigation/native';
import { linking } from '../src/linking';
import { serialRefresh } from '../src/api/sessionIdentity';

it('does not route old room links and keeps external channel settings routable', () => {
  expect(getStateFromPath('rooms/relay', linking.config as never)).toBeUndefined();
  const channels = getStateFromPath('settings/channels', linking.config as never);
  expect(JSON.stringify(channels)).toContain('Channels');
});

it('removes live room seam and hub operations, but not integration and history contracts', () => {
  const root = path.join(__dirname, '..', 'src');
  const seam = fs.readFileSync(path.join(root, 'api/seam.ts'), 'utf8');
  const hub = fs.readFileSync(path.join(root, 'api/hub.ts'), 'utf8');
  const transcript = fs.readFileSync(path.join(root, 'api/transcript.ts'), 'utf8');
  expect(seam).not.toContain('api/seam/rooms/');
  expect(hub).not.toContain('RoomChanged');
  expect(seam).toContain('api/seam/channels/');
  expect(seam).toContain('api/seam/memory/');
  expect(seam).toContain('api/seam/skills/');
  expect(transcript).toContain("case 'ChatMentionReceived'");
  expect(transcript).toContain("case 'DirectMessageReceived'");
});

it('coalesces session registry refresh bursts without losing the final refresh', async () => {
  const completions: (() => void)[] = [];
  const run = jest.fn(() => new Promise<void>(resolve => completions.push(resolve)));
  const refresh = serialRefresh(run);
  refresh(false); refresh(false); refresh(false);
  expect(run).toHaveBeenCalledTimes(1);
  completions.shift()!();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(2);
  completions.shift()!();
  await Promise.resolve(); await Promise.resolve();
});
