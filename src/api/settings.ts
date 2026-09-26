/**
 * What the settings screens decide, with no screen in the way.
 *
 * Each web settings page carries a little logic in its `@code` block — how a
 * channel's settings blob is read back into a form and written out again, what
 * "valid JSON with 3 handlers" is, which line of a skill is its description,
 * how memory entries group. This file is that logic, ported function for
 * function so the phone and the browser agree on what they store, and so it
 * can be tested without mounting anything.
 */
import {
  ChannelKind,
  GitServiceKind,
  McpTransportKind,
  ModelTier,
  ProviderKind,
  type ChannelSummary,
  type ConnectionSummary,
  type GitConnectionSummary,
  type McpServerSummary,
  type MemorySummary,
  type RemoteNodeSummary,
} from './contracts';

// ---- connections ----

export function providerLabel(kind: ProviderKind): string {
  switch (kind) {
    case ProviderKind.Anthropic:
      return 'Anthropic';
    case ProviderKind.OpenAICompatible:
      return 'OpenAI-compatible';
    case ProviderKind.OpenAICodex:
      return 'ChatGPT · Codex';
    case ProviderKind.ClaudeCode:
      return 'Claude Code';
    default:
      return 'Provider';
  }
}

/** "Anthropic · default · added 2026-09-01" — a connection row's second line. */
export function connectionMeta(c: ConnectionSummary): string {
  const where =
    c.kind === ProviderKind.OpenAICodex || c.kind === ProviderKind.ClaudeCode
      ? c.accountLabel ?? 'subscription'
      : c.baseUrl ?? 'default';
  return `${providerLabel(c.kind)} · ${where} · added ${day(c.createdAt)}`;
}

/** The kinds a key-based form can add; Codex is a sign-in flow, not a form. */
export const ADDABLE_PROVIDERS: { kind: ProviderKind; label: string; note: string }[] = [
  { kind: ProviderKind.Anthropic, label: 'Anthropic API', note: 'api key' },
  { kind: ProviderKind.OpenAICompatible, label: 'OpenAI-compatible', note: 'endpoint' },
  { kind: ProviderKind.ClaudeCode, label: 'Claude Code', note: 'subscription' },
];

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  hint: string;
}

/**
 * Known OpenAI-compatible services, prefilled into the form. Data only: the
 * catalog declines to grade unknown providers' models, and the user does that
 * on the connection's models list as always.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', hint: 'Key from openrouter.ai/keys.' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', hint: 'Key from console.groq.com.' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1', hint: 'Key from api.together.ai.' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: 'Key from platform.deepseek.com.' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', hint: 'Key from console.mistral.ai.' },
  { name: 'xAI', baseUrl: 'https://api.x.ai/v1', hint: 'Key from console.x.ai.' },
  { name: 'z.ai GLM', baseUrl: 'https://api.z.ai/api/paas/v4', hint: 'Key from z.ai; GLM coding plans use this endpoint.' },
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', hint: 'No key needed — type anything.' },
];

/** The add form's words for one kind: what the key field is, what the placeholder shows. */
export function providerForm(kind: ProviderKind): {
  title: string;
  description: string;
  namePlaceholder: string;
  keyLabel: string;
  keyPlaceholder: string;
  baseUrlLabel: string | null;
  baseUrlPlaceholder: string;
} {
  switch (kind) {
    case ProviderKind.Anthropic:
      return {
        title: 'Connect Anthropic',
        description: 'The key is validated against the Anthropic API before it is stored encrypted.',
        namePlaceholder: 'Personal Anthropic',
        keyLabel: 'API key',
        keyPlaceholder: 'sk-ant-…',
        baseUrlLabel: 'Base URL (optional)',
        baseUrlPlaceholder: 'https://api.anthropic.com',
      };
    case ProviderKind.ClaudeCode:
      return {
        title: 'Connect Claude Code',
        description:
          'The token is checked for shape and stored encrypted; Claude Code verifies it against your plan on the first turn.',
        namePlaceholder: 'My Claude plan',
        keyLabel: 'Setup token',
        keyPlaceholder: 'sk-ant-oat01-…',
        baseUrlLabel: null,
        baseUrlPlaceholder: '',
      };
    default:
      return {
        title: 'Connect an OpenAI-compatible endpoint',
        description: 'The key and endpoint are validated before they are stored encrypted.',
        namePlaceholder: 'Local vLLM',
        keyLabel: 'API key',
        keyPlaceholder: 'sk-… (anything for a local server)',
        baseUrlLabel: 'Base URL',
        baseUrlPlaceholder: 'http://localhost:11434/v1',
      };
  }
}

export const TIERS: { tier: ModelTier | null; label: string }[] = [
  { tier: null, label: 'Unrated (medium)' },
  { tier: ModelTier.Simple, label: 'Simple' },
  { tier: ModelTier.Medium, label: 'Medium' },
  { tier: ModelTier.Complex, label: 'Complex' },
  { tier: ModelTier.Reasoning, label: 'Reasoning' },
];

/**
 * The model catalog shape, as the web's placeholder shows it: the Codex
 * `models.json` a provider documents, pasted whole. Shared by the add form
 * and the models sheet because it is one document, not two.
 */
export const MODEL_CATALOG_PLACEHOLDER = `{
  "models": [
    {
      "slug": "glm-5.3",
      "display_name": "GLM 5.3",
      "context_window": 1048576,
      "default_reasoning_level": "max",
      "supported_reasoning_levels": [
        { "effort": "low" },
        { "effort": "high" },
        { "effort": "max" }
      ]
    }
  ]
}`;

export function tierLabel(tier: ModelTier | null | undefined): string {
  return TIERS.find(t => t.tier === (tier ?? null))?.label ?? 'Unrated (medium)';
}

/** Where a git account lives: "github.com", or the forge's host. */
export function gitHost(c: GitConnectionSummary): string {
  if (c.kind === GitServiceKind.GitHub) return 'github.com';
  try {
    return c.baseUrl ? new URL(c.baseUrl).host : '';
  } catch {
    return c.baseUrl ?? '';
  }
}

/** A .NET `TimeSpan` — "00:00:05", or "1.02:03:04" with days — as milliseconds. */
export function timeSpanMs(text: string): number {
  const match = /^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (((Number(days ?? 0) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

// ---- mcp servers ----

/** The row's target: the command line for stdio, the URL for HTTP. */
export function mcpTarget(s: McpServerSummary): string {
  if (s.kind === McpTransportKind.Http) return s.url ?? '';
  return s.args.length === 0 ? s.command : `${s.command} ${s.args.join(' ')}`;
}

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/** `KEY=value` per line into a map; the first line that is not one is the error. */
export function parseSecrets(text: string): { secrets: Record<string, string>; error: string | null } {
  const secrets: Record<string, string> = {};
  for (const raw of splitLines(text)) {
    const split = raw.indexOf('=');
    if (split <= 0) return { secrets, error: `"${raw}" isn't KEY=value.` };
    secrets[raw.slice(0, split).trim()] = raw.slice(split + 1);
  }
  return { secrets, error: null };
}

// ---- remote nodes ----

/** "pi@192.168.1.20", with the port only when it is not 22. */
export function nodeTarget(n: RemoteNodeSummary): string {
  return `${n.username}@${n.host}${n.port === 22 ? '' : `:${n.port}`}`;
}

/** The command to run on the node, as the login user. */
export function installCommand(authorizedKeysLine: string): string {
  return `echo '${authorizedKeysLine}' >> ~/.ssh/authorized_keys`;
}

// ---- hooks ----

/**
 * The web's client-side check, verbatim: the document must parse and be an
 * object keyed by event name. Returns the line to show and whether the
 * document may be saved; the tick itself is drawn by `Note`, since the font
 * has no glyph for one.
 */
export function checkHooks(json: string): { ok: boolean; message: string } {
  if (json.trim().length === 0) return { ok: true, message: 'empty — saving removes your global hooks' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'Invalid: the document must be a JSON object keyed by event name.' };
  }
  const handlers = Object.values(parsed as Record<string, unknown>)
    .filter(Array.isArray)
    .reduce((sum, list) => sum + list.length, 0);
  return { ok: true, message: `valid JSON with ${handlers} handler${handlers === 1 ? '' : 's'}` };
}

// ---- skills ----

/**
 * The frontmatter's description line, read straight off the raw text. No
 * parser: a skill whose frontmatter is unreadable would not have saved.
 */
export function describeSkill(content: string): string {
  for (const line of content.split('\n').slice(0, 20)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith('description:')) {
      return trimmed.slice('description:'.length).trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

export const SKILL_PLACEHOLDER =
  '---\nname: monthly-invoices\ndescription: Pull last month\'s invoices and total them\n---\n\nSteps…';

export const FACET_PLACEHOLDER =
  '---\ndescription: writes docs only\ntools-allow: read_file, write_file\n---\nYou write documentation. Nothing else.';

// ---- memory ----

export interface MemoryGroup {
  /** "" is user scope; otherwise a repo key. */
  key: string;
  title: string;
  entries: MemorySummary[];
}

/**
 * User scope sorts first; repo groups follow alphabetically. Inside a group
 * the pinned entries lead — they cost prompt tokens on every request, so they
 * are what a review is looking for.
 */
export function groupMemories(entries: MemorySummary[]): MemoryGroup[] {
  const sorted = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  const groups = new Map<string, MemorySummary[]>();
  for (const entry of sorted) {
    const list = groups.get(entry.repoKey) ?? [];
    list.push(entry);
    groups.set(entry.repoKey, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, title: key.length === 0 ? 'User memory' : key, entries: list }));
}

// ---- channels ----

export function channelLabel(kind: ChannelKind): string {
  switch (kind) {
    case ChannelKind.Telegram:
      return 'telegram';
    case ChannelKind.Email:
      return 'email';
    case ChannelKind.Discord:
      return 'discord';
    case ChannelKind.Fluxer:
      return 'fluxer';
    default:
      return 'ntfy';
  }
}

export const CHANNEL_KINDS: { kind: ChannelKind; label: string }[] = [
  { kind: ChannelKind.Telegram, label: 'Telegram bot' },
  { kind: ChannelKind.Ntfy, label: 'ntfy topic' },
  { kind: ChannelKind.Email, label: 'Email (SMTP + IMAP)' },
  { kind: ChannelKind.Discord, label: 'Discord bot' },
  { kind: ChannelKind.Fluxer, label: 'Fluxer bot' },
];

/** The two-way kinds: the ones a person can pair with and talk to. */
export function channelPairs(kind: ChannelKind): boolean {
  return kind === ChannelKind.Telegram || kind === ChannelKind.Discord || kind === ChannelKind.Fluxer || kind === ChannelKind.Email;
}

function blob(channel: ChannelSummary): Record<string, unknown> {
  try {
    const parsed = JSON.parse(channel.settings.trim().length === 0 ? '{}' : channel.settings);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A string out of the settings blob, or "". */
export function channelSetting(channel: ChannelSummary, name: string): string {
  const value = blob(channel)[name];
  return typeof value === 'string' ? value : '';
}

function channelNumber(channel: ChannelSummary, name: string, fallback: string): string {
  const value = blob(channel)[name];
  return typeof value === 'number' ? String(value) : fallback;
}

/** A string array out of the blob, joined for a form's one-line field. */
function channelList(channel: ChannelSummary, name: string): string {
  const value = blob(channel)[name];
  if (!Array.isArray(value)) return '';
  return value
    .map(item => (typeof item === 'string' ? item : JSON.stringify(item)))
    .filter(item => item.trim().length > 0)
    .join(', ');
}

/** The facts a channel card lists under its name. */
export function channelFacts(channel: ChannelSummary): { label: string; value: string; mono?: boolean }[] {
  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: 'paired', value: String(channel.pairedPeers.length) },
    { label: 'last seen', value: channel.lastSeenAt ? stamp(channel.lastSeenAt) : 'never' },
  ];
  if (channel.kind === ChannelKind.Ntfy) facts.push({ label: 'topic', value: channelSetting(channel, 'topic'), mono: true });
  if (channel.kind === ChannelKind.Email) {
    facts.push({ label: 'mailbox', value: channelSetting(channel, 'fromAddress'), mono: true });
    const imap = channelSetting(channel, 'imapHost');
    facts.push({ label: 'inbound', value: imap.length > 0 ? imap : 'delivery only' });
  }
  return facts;
}

/** Every field the channel form can hold, as the text the fields bind. */
export interface ChannelForm {
  kind: ChannelKind;
  displayName: string;
  secret: string;
  server: string;
  topic: string;
  listenChannelIds: string;
  deliverToChannelIds: string;
  instance: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: string;
  imapHost: string;
  imapPort: string;
  imapSecurity: string;
  username: string;
  fromAddress: string;
  fromName: string;
  folder: string;
  pollSeconds: string;
  allowFrom: string;
}

export function emptyChannelForm(kind: ChannelKind = ChannelKind.Telegram): ChannelForm {
  return {
    kind,
    displayName: '',
    secret: '',
    server: 'https://ntfy.sh',
    topic: '',
    listenChannelIds: '',
    deliverToChannelIds: '',
    instance: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecurity: 'starttls',
    imapHost: '',
    imapPort: '993',
    imapSecurity: 'ssl',
    username: '',
    fromAddress: '',
    fromName: '',
    folder: 'INBOX',
    pollSeconds: '60',
    allowFrom: '',
  };
}

/** A stored channel unfolded into the form. The secret never comes back, so it starts blank. */
export function channelFormOf(channel: ChannelSummary): ChannelForm {
  const empty = emptyChannelForm(channel.kind);
  const or = (value: string, fallback: string) => (value.length > 0 ? value : fallback);
  return {
    kind: channel.kind,
    displayName: channel.displayName,
    secret: '',
    server: or(channelSetting(channel, 'server'), 'https://ntfy.sh'),
    topic: channelSetting(channel, 'topic'),
    listenChannelIds: channelList(channel, 'listenChannelIds'),
    deliverToChannelIds: channelList(channel, 'deliverToChannelIds'),
    instance: channelSetting(channel, 'instance'),
    smtpHost: channelSetting(channel, 'smtpHost'),
    smtpPort: channelNumber(channel, 'smtpPort', empty.smtpPort),
    smtpSecurity: or(channelSetting(channel, 'smtpSecurity'), empty.smtpSecurity),
    imapHost: channelSetting(channel, 'imapHost'),
    imapPort: channelNumber(channel, 'imapPort', empty.imapPort),
    imapSecurity: or(channelSetting(channel, 'imapSecurity'), empty.imapSecurity),
    username: channelSetting(channel, 'username'),
    fromAddress: channelSetting(channel, 'fromAddress'),
    fromName: channelSetting(channel, 'fromName'),
    folder: or(channelSetting(channel, 'folder'), empty.folder),
    pollSeconds: channelNumber(channel, 'pollSeconds', empty.pollSeconds),
    allowFrom: channelList(channel, 'allowFrom'),
  };
}

function splitIds(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map(id => id.trim())
    .filter(id => id.length > 0);
}

/** A typed number, or the default: a blank port must reach the server as 587. */
function port(text: string, fallback: number): number {
  const number = parseInt(text.trim(), 10);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * The non-secret half, as the JSON blob the server stores — the same shape
 * `Channels.razor` writes, key for key. Telegram needs none, so it writes an
 * empty object rather than a shape nobody reads.
 */
export function channelSettingsJson(form: ChannelForm): string {
  switch (form.kind) {
    case ChannelKind.Ntfy:
      return JSON.stringify({
        server: form.server.trim().length === 0 ? 'https://ntfy.sh' : form.server.trim(),
        topic: form.topic.trim(),
      });
    case ChannelKind.Discord:
    case ChannelKind.Fluxer: {
      const settings: Record<string, unknown> = {
        listenChannelIds: splitIds(form.listenChannelIds),
        deliverToChannelIds: splitIds(form.deliverToChannelIds),
      };
      if (form.kind === ChannelKind.Fluxer && form.instance.trim().length > 0) settings.instance = form.instance.trim();
      return JSON.stringify(settings);
    }
    case ChannelKind.Email:
      return JSON.stringify({
        smtpHost: form.smtpHost.trim(),
        smtpPort: port(form.smtpPort, 587),
        smtpSecurity: form.smtpSecurity,
        imapHost: form.imapHost.trim(),
        imapPort: port(form.imapPort, 993),
        imapSecurity: form.imapSecurity,
        username: form.username.trim(),
        fromAddress: form.fromAddress.trim(),
        fromName: form.fromName.trim(),
        folder: form.folder.trim().length === 0 ? 'INBOX' : form.folder.trim(),
        pollSeconds: port(form.pollSeconds, 60),
        allowFrom: [
          ...new Set(
            form.allowFrom
              .split(/[,;\n]/)
              .map(a => a.trim().toLowerCase())
              .filter(a => a.length > 0),
          ),
        ],
      });
    default:
      return '{}';
  }
}

// ---- time ----

/** "2026-09-01" — the day a row was added, as the web's `TimeFormat.Day`. */
export function day(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** "2026-09-01 17:24" — the settings tables' stamp. */
export function stamp(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day(iso)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Seconds left on a pairing code; zero once it has gone. */
export function secondsLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}
