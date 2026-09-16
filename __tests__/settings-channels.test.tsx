/**
 * The channels page and its editor, mounted against channels the server could
 * really send. A smoke test: what it catches is a screen that fails to render,
 * a card that mislabels a channel, or an edit that writes the settings blob
 * back in a shape the server no longer recognises.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ChannelKind, type ChannelSummary } from '../src/api/contracts';

const telegram: ChannelSummary = {
  id: 'ch-tg',
  kind: ChannelKind.Telegram,
  displayName: 'phone',
  enabled: true,
  hasSecret: true,
  settings: '{}',
  pairedPeers: ['12345'],
  pendingPairings: [],
  mainSessionId: null,
  lastError: null,
  lastSeenAt: '2026-09-01T10:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
};

const email: ChannelSummary = {
  id: 'ch-mail',
  kind: ChannelKind.Email,
  displayName: 'inbox',
  enabled: true,
  hasSecret: true,
  settings: JSON.stringify({
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    username: 'bot@example.com',
    fromAddress: 'bot@example.com',
    fromName: 'bot',
    folder: 'INBOX',
    pollSeconds: 90,
    allowFrom: ['me@example.com'],
  }),
  pairedPeers: [],
  pendingPairings: [],
  mainSessionId: null,
  lastError: null,
  lastSeenAt: null,
  createdAt: '2026-09-01T00:00:00Z',
};

const deliveryOnly: ChannelSummary = {
  ...email,
  id: 'ch-notify',
  displayName: 'notify',
  settings: JSON.stringify({ smtpHost: 'smtp.example.com', fromAddress: 'noreply@example.com', imapHost: '' }),
};

const mockSeam = {
  channels: jest.fn(() => Promise.resolve([telegram, email, deliveryOnly])),
  createChannel: jest.fn(() => Promise.resolve(null)),
  updateChannel: jest.fn(() => Promise.resolve(null)),
  deleteChannel: jest.fn(() => Promise.resolve(true)),
  setChannelEnabled: jest.fn(() => Promise.resolve(null)),
  pairChannel: jest.fn(() => Promise.resolve(null)),
  unpairChannel: jest.fn(() => Promise.resolve(null)),
  testChannel: jest.fn(() => Promise.resolve(null)),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/ui/ConnectionBanner', () => ({ ConnectionBanner: () => null }));

jest.mock('../src/state/auth', () => ({
  useAuth: (select: (state: unknown) => unknown) =>
    select({ seam: mockSeam, credential: { server: 'https://slop.example.com' } }),
}));

import { ChannelsScreen } from '../src/screens/settings/Channels';
import { ChannelEditorScreen } from '../src/screens/settings/ChannelEditor';

function navigator() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
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

/** The bar's options, as the screen last set them. */
function bar(navigation: ReturnType<typeof navigator>) {
  const calls = navigation.setOptions.mock.calls;
  return calls[calls.length - 1][0] as {
    title: string;
    unstable_headerRightItems: () => { label: string; disabled?: boolean; onPress: () => void }[];
    unstable_headerLeftItems: () => { label: string }[];
  };
}

function field(tree: ReturnType<typeof create>, label: string) {
  return tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  for (const fn of Object.values(mockSeam)) fn.mockClear();
});

describe('the channels page', () => {
  it('lists each channel with its kind, what is paired, and how to pair more', async () => {
    const navigation = navigator();
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ChannelsScreen navigation={navigation} />);
    });
    await settle();
    const rendered = text(tree!);

    expect(mockSeam.channels).toHaveBeenCalled();
    expect(rendered).toContain('phone');
    expect(rendered).toContain('telegram');
    // One peer paired, shown both as the count and as the row to unpair.
    expect(rendered).toContain('12345');
    expect(rendered).toContain('Message the bot to get a code.');
    expect(rendered).toContain('Write to the mailbox to get a code.');
    // The email facts: the mailbox, and whether it reads or only sends.
    expect(rendered).toContain('bot@example.com');
    expect(rendered).toContain('imap.example.com');
    expect(rendered).toContain('delivery only');
  });
});

describe('the channel editor', () => {
  it('opens a new channel with Connect disabled until it has a name', async () => {
    const navigation = navigator();
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ChannelEditorScreen route={{ params: {} }} navigation={navigation} />);
    });
    await settle();

    expect(bar(navigation).title).toBe('Connect a channel');
    expect(bar(navigation).unstable_headerLeftItems()[0].label).toBe('Cancel');
    expect(bar(navigation).unstable_headerRightItems()[0]).toMatchObject({ label: 'Connect', disabled: true });

    await act(async () => {
      field(tree!, 'Name').props.onChangeText('phone');
    });
    expect(bar(navigation).unstable_headerRightItems()[0]).toMatchObject({ label: 'Connect', disabled: false });
  });

  it('unfolds a stored email channel into its fields, and writes them back the same', async () => {
    const navigation = navigator();
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ChannelEditorScreen route={{ params: { channel: email } }} navigation={navigation} />);
    });
    await settle();

    expect(bar(navigation).title).toBe("Edit 'inbox'");
    expect(field(tree!, 'SMTP host').props.value).toBe('smtp.example.com');
    // The IMAP half only unfolds once there is a host to read from.
    expect(field(tree!, 'IMAP port').props.value).toBe('993');
    expect(field(tree!, 'Allow from').props.value).toBe('me@example.com');
    // The credential never comes back, so the box is blank and says so.
    expect(field(tree!, 'Replace password').props.value).toBe('');

    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress();
    });
    await settle();

    expect(mockSeam.updateChannel).toHaveBeenCalledTimes(1);
    const [id, draft] = mockSeam.updateChannel.mock.calls[0] as unknown as [string, { secret: string | null; settings: string; enabled: boolean }];
    expect(id).toBe('ch-mail');
    expect(draft.secret).toBeNull();
    expect(draft.enabled).toBe(true);
    const settings = JSON.parse(draft.settings);
    expect(settings.imapHost).toBe('imap.example.com');
    expect(settings.smtpPort).toBe(465);
    expect(settings.pollSeconds).toBe(90);
    expect(settings.allowFrom).toEqual(['me@example.com']);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('shows the server’s refusal in place rather than leaving', async () => {
    mockSeam.createChannel.mockReturnValueOnce(Promise.resolve('That name is taken.' as never));
    const navigation = navigator();
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<ChannelEditorScreen route={{ params: {} }} navigation={navigation} />);
    });
    await settle();
    await act(async () => {
      field(tree!, 'Name').props.onChangeText('phone');
    });
    await act(async () => {
      bar(navigation).unstable_headerRightItems()[0].onPress();
    });
    await settle();

    expect(mockSeam.createChannel).toHaveBeenCalledTimes(1);
    expect(text(tree!)).toContain('That name is taken.');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
