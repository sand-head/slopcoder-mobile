/**
 * The settings pages' own logic, ported from the razor `@code` blocks. Each
 * of these is a place the phone and the browser must store the same thing:
 * a channel blob with a key the server does not read is a channel that
 * silently never works.
 */
import { ChannelKind, McpTransportKind, ModelTier, ProviderKind } from '../src/api/contracts';
import type { ChannelSummary, MemorySummary } from '../src/api/contracts';
import {
  channelFacts,
  channelFormOf,
  channelSettingsJson,
  checkHooks,
  connectionMeta,
  describeSkill,
  emptyChannelForm,
  groupMemories,
  installCommand,
  mcpTarget,
  nodeTarget,
  parseSecrets,
  secondsLeft,
  tierLabel,
  timeSpanMs,
} from '../src/api/settings';

function channel(kind: ChannelKind, settings: unknown): ChannelSummary {
  return {
    id: 'ch',
    kind,
    displayName: 'x',
    enabled: true,
    hasSecret: true,
    settings: JSON.stringify(settings),
    pairedPeers: [],
    pendingPairings: [],
    mainSessionId: null,
    lastError: null,
    lastSeenAt: null,
    createdAt: '2026-09-01T12:00:00Z',
  };
}

describe('channel settings', () => {
  it('writes an email channel the way Channels.razor does, ports as numbers and allow-from lowercased', () => {
    const form = {
      ...emptyChannelForm(ChannelKind.Email),
      smtpHost: ' smtp.example.com ',
      smtpPort: '',
      imapHost: 'imap.example.com',
      imapPort: 'abc',
      fromAddress: 'bot@example.com',
      folder: '',
      pollSeconds: '45',
      allowFrom: 'Me@Example.com, me@example.com; other@example.com',
    };
    expect(JSON.parse(channelSettingsJson(form))).toEqual({
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecurity: 'ssl',
      username: '',
      fromAddress: 'bot@example.com',
      fromName: '',
      folder: 'INBOX',
      pollSeconds: 45,
      allowFrom: ['me@example.com', 'other@example.com'],
    });
  });

  it('writes discord ids as arrays and a fluxer instance only when given', () => {
    const discord = { ...emptyChannelForm(ChannelKind.Discord), listenChannelIds: '1, 2 3', instance: 'ignored' };
    expect(JSON.parse(channelSettingsJson(discord))).toEqual({ listenChannelIds: ['1', '2', '3'], deliverToChannelIds: [] });

    const fluxer = { ...emptyChannelForm(ChannelKind.Fluxer), instance: ' https://fluxer.example ' };
    expect(JSON.parse(channelSettingsJson(fluxer)).instance).toBe('https://fluxer.example');
    expect(channelSettingsJson(emptyChannelForm(ChannelKind.Telegram))).toBe('{}');
    expect(JSON.parse(channelSettingsJson({ ...emptyChannelForm(ChannelKind.Ntfy), server: '', topic: 't' }))).toEqual({
      server: 'https://ntfy.sh',
      topic: 't',
    });
  });

  it('reads a stored blob back into the form, and never the secret', () => {
    const stored = channel(ChannelKind.Email, {
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecurity: 'ssl',
      imapHost: '',
      fromAddress: 'bot@example.com',
      allowFrom: ['a@example.com'],
    });
    const form = channelFormOf(stored);
    expect(form.smtpHost).toBe('smtp.example.com');
    expect(form.smtpPort).toBe('465');
    expect(form.smtpSecurity).toBe('ssl');
    expect(form.imapPort).toBe('993');
    expect(form.folder).toBe('INBOX');
    expect(form.allowFrom).toBe('a@example.com');
    expect(form.secret).toBe('');
  });

  it('survives a blob that is not JSON', () => {
    const broken = { ...channel(ChannelKind.Ntfy, {}), settings: '{not json' };
    expect(channelFormOf(broken).server).toBe('https://ntfy.sh');
    expect(channelFacts(broken).find(f => f.label === 'topic')?.value).toBe('');
  });

  it('lists an email mailbox and says delivery-only without an IMAP host', () => {
    const facts = channelFacts(channel(ChannelKind.Email, { fromAddress: 'bot@example.com', imapHost: '' }));
    expect(facts.find(f => f.label === 'mailbox')?.value).toBe('bot@example.com');
    expect(facts.find(f => f.label === 'inbound')?.value).toBe('delivery only');
  });
});

describe('hooks check', () => {
  it('counts handlers across events and flags a non-object', () => {
    expect(checkHooks('{"pre_tool_use":[{},{}],"stop":[{}],"note":"x"}')).toEqual({ ok: true, message: 'valid JSON with 3 handlers' });
    expect(checkHooks('[1]').ok).toBe(false);
    expect(checkHooks('{"a":[{}]}').message).toBe('valid JSON with 1 handler');
    expect(checkHooks('  ').message).toContain('empty');
    expect(checkHooks('{').message).toMatch(/^Invalid JSON: /);
  });
});

describe('mcp and nodes', () => {
  it('parses KEY=value lines and names the first that is not one', () => {
    expect(parseSecrets('A=1\n\n B = two=2 ')).toEqual({ secrets: { A: '1', B: ' two=2' }, error: null });
    expect(parseSecrets('A=1\nNOTAPAIR').error).toBe('"NOTAPAIR" isn\'t KEY=value.');
    expect(parseSecrets('=x').error).toBe('"=x" isn\'t KEY=value.');
  });

  it('shows a stdio server as its command line and an http one as its url', () => {
    const base = { id: 's', displayName: 'fs', hasSecrets: false, enabled: true, createdAt: '2026-09-01T12:00:00Z' };
    expect(mcpTarget({ ...base, kind: McpTransportKind.Stdio, command: 'npx', args: ['-y', 'x'], url: null })).toBe('npx -y x');
    expect(mcpTarget({ ...base, kind: McpTransportKind.Http, command: '', args: [], url: 'https://m/sse' })).toBe('https://m/sse');
  });

  it('names a node target with the port only when it is not 22', () => {
    const node = { username: 'pi', host: 'h', port: 22 } as never;
    expect(nodeTarget(node)).toBe('pi@h');
    expect(nodeTarget({ username: 'pi', host: 'h', port: 2222 } as never)).toBe('pi@h:2222');
    expect(installCommand('ssh-ed25519 AAAA slop')).toBe("echo 'ssh-ed25519 AAAA slop' >> ~/.ssh/authorized_keys");
  });
});

describe('the rest', () => {
  it('describes a skill from its frontmatter, quotes stripped', () => {
    expect(describeSkill('---\nname: x\ndescription: "Do the thing"\n---\nSteps')).toBe('Do the thing');
    expect(describeSkill('no frontmatter')).toBe('');
  });

  it('groups memory with user scope first and pinned entries leading', () => {
    const entry = (name: string, repoKey: string, pinned: boolean): MemorySummary => ({
      id: name,
      repoKey,
      name,
      description: '',
      content: '',
      pinned,
      updatedAt: '2026-09-01T12:00:00Z',
    });
    const groups = groupMemories([entry('b', 'x/y/z', false), entry('a', '', false), entry('z', '', true)]);
    expect(groups.map(g => g.title)).toEqual(['User memory', 'x/y/z']);
    expect(groups[0].entries.map(e => e.name)).toEqual(['z', 'a']);
  });

  it('reads a .NET TimeSpan and a subscription connection', () => {
    expect(timeSpanMs('00:00:05')).toBe(5000);
    expect(timeSpanMs('1.02:00:00.5')).toBe(((26 * 60) * 60 + 0.5) * 1000);
    expect(timeSpanMs('nonsense')).toBe(0);
    expect(
      connectionMeta({
        id: 'c',
        kind: ProviderKind.OpenAICodex,
        displayName: 'x',
        baseUrl: null,
        createdAt: '2026-09-01T12:00:00Z',
        lastValidatedAt: null,
        accountLabel: null,
        enabled: true,
        hasModelCatalog: false,
      }),
    ).toMatch(/^ChatGPT · Codex · subscription · added 2026-09-01$/);
    expect(tierLabel(ModelTier.Reasoning)).toBe('Reasoning');
    expect(tierLabel(undefined)).toBe('Unrated (medium)');
  });

  it('counts a pairing code down and never below zero', () => {
    const now = Date.parse('2026-09-15T10:00:00Z');
    expect(secondsLeft('2026-09-15T10:01:30Z', now)).toBe(90);
    expect(secondsLeft('2026-09-15T09:59:00Z', now)).toBe(0);
  });
});
