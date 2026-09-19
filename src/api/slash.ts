/**
 * Deciding, on the phone, whether what is in the composer is a command.
 *
 * Ported from `SlopCoder.Contracts/SlashCommandParser.cs`, and pure for the
 * same reason it is pure there: the composer has to know a command from a
 * prompt before it sends anything anywhere. Running the command is still the
 * server's job — it needs the sandbox, the facet catalogue and the live model,
 * none of which exist here.
 *
 * Keep the rules in step with the C#. Each of them is a way to get this
 * visibly wrong: a pasted path is not a command, and neither is a bare slash.
 */
import type { SlashCommandInfo } from './contracts';

/** Null when the input is not a slash command and should be sent as a prompt. */
export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (trimmed.length < 2 || trimmed[0] !== '/') return null;

  const space = trimmed.indexOf(' ');
  const name = space < 0 ? trimmed.slice(1) : trimmed.slice(1, space);
  const args = space < 0 ? '' : trimmed.slice(space + 1).trim();

  // A bare "/" or something path-like ("/etc/passwd") is not a command.
  return name.length === 0 || name.includes('/') ? null : { name, args };
}

/**
 * The partial command being typed — `"/co"` → `"co"`, and a bare `"/"` → `""`,
 * which offers the lot. Null once the name is settled: a space means the
 * arguments have started and the menu has said all it can.
 */
export function commandPrefix(draft: string): string | null {
  if (!draft.startsWith('/') || draft.includes(' ') || draft.slice(1).includes('/')) return null;
  return draft.slice(1);
}

/** What the menu offers for a prefix, in the order the server listed them. */
export function matchCommands(
  commands: readonly SlashCommandInfo[],
  prefix: string,
): SlashCommandInfo[] {
  const wanted = prefix.toLowerCase();
  return commands.filter(c => c.name.toLowerCase().startsWith(wanted));
}
