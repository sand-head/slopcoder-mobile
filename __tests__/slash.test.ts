/**
 * Telling a command from a prompt, which the composer has to do before it
 * sends anything anywhere.
 *
 * These rules are `SlopCoder.Contracts/SlashCommandParser.cs`, ported. Each
 * case here is one the C# has too, and one that reads as a bug when it drifts:
 * a pasted path that runs as a command, or a menu that keeps offering itself
 * halfway through an argument.
 */
import { commandPrefix, matchCommands, parseSlashCommand } from '../src/api/slash';

describe('parseSlashCommand', () => {
  it('splits the name from its arguments', () => {
    expect(parseSlashCommand('/rewind 3')).toEqual({ name: 'rewind', args: '3' });
    expect(parseSlashCommand('  /goal  ship the thing  ')).toEqual({
      name: 'goal',
      args: 'ship the thing',
    });
  });

  it('takes a bare command with no arguments', () => {
    expect(parseSlashCommand('/compact')).toEqual({ name: 'compact', args: '' });
  });

  /** Someone pasting a path into the box is not asking to run anything. */
  it('refuses a path, a bare slash and ordinary prose', () => {
    expect(parseSlashCommand('/etc/passwd')).toBeNull();
    expect(parseSlashCommand('/')).toBeNull();
    expect(parseSlashCommand('and/or')).toBeNull();
    expect(parseSlashCommand('fix the tests')).toBeNull();
  });
});

describe('commandPrefix', () => {
  it('offers everything for a bare slash, and narrows as the name is typed', () => {
    expect(commandPrefix('/')).toBe('');
    expect(commandPrefix('/com')).toBe('com');
  });

  /** The name is settled once a space is typed; the menu has said all it can. */
  it('closes once the arguments start, and never opens mid-sentence', () => {
    expect(commandPrefix('/rewind 3')).toBeNull();
    expect(commandPrefix('look in /etc')).toBeNull();
    expect(commandPrefix('/etc/passwd')).toBeNull();
  });
});

describe('matchCommands', () => {
  const commands = [
    { name: 'compact', help: 'summarize older history' },
    { name: 'cost', help: 'what this session has spent' },
    { name: 'Deploy', help: 'template from ./slopcoder/.slopcoder/commands' },
  ];

  it('matches on the prefix, ignoring case, keeping the server order', () => {
    expect(matchCommands(commands, 'co').map(c => c.name)).toEqual(['compact', 'cost']);
    expect(matchCommands(commands, 'dep').map(c => c.name)).toEqual(['Deploy']);
    expect(matchCommands(commands, '').map(c => c.name)).toEqual(['compact', 'cost', 'Deploy']);
    expect(matchCommands(commands, 'zz')).toEqual([]);
  });
});
