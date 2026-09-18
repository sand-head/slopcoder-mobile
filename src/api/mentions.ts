/**
 * Finding a partner's name in the agent's prose.
 *
 * The agent writes about its team — "asked Ada to take the relay while Bruno
 * finishes the migration" — and those names are the only thread tying that
 * sentence to the cards above and below it. Colouring them turns reading a
 * delegation-heavy transcript from parsing into scanning.
 *
 * The cockpit does this by scanning Markdig's rendered HTML. There is no HTML
 * here: the markdown renderer hands us text nodes, so this splits one of those
 * into runs instead. The matching rules are the same, and they are the part
 * worth keeping in step — each of them is a way to get this visibly wrong.
 */

/** One partner the prose may name, and the colour they are drawn in. */
export interface SubSessionMention {
  persona: string;
  /** A palette name (`tintFor`); an unknown or empty one renders untinted. */
  color: string;
}

/** A piece of a text node: plain, or one partner's name. */
export interface MentionRun {
  text: string;
  /** The colour this run takes, or null for ordinary prose. */
  color: string | null;
}

/**
 * <paramref name="text"/> split into tinted and untinted runs. A single
 * left-to-right pass, so two names can never rewrite each other's output.
 *
 * Whole words only — `Adapter` must keep its ink, and a substring match that
 * tints half a word reads as a rendering bug. Longest name first, so an
 * "Ada II" is never cut short by the "Ada" sharing its prefix. Matching
 * ignores case (an agent that writes "ada" still means her) but every run
 * carries the text exactly as it was written.
 */
export function splitMentions(
  text: string,
  mentions: readonly SubSessionMention[],
): MentionRun[] {
  if (mentions.length === 0 || text.length === 0)
    return [{ text, color: null }];

  const ordered = mentions
    .filter(m => m.persona.length > 0 && m.color.length > 0)
    .slice()
    .sort((a, b) => b.persona.length - a.persona.length);
  if (ordered.length === 0) return [{ text, color: null }];

  const runs: MentionRun[] = [];
  let copied = 0;

  for (let i = 0; i < text.length; i++) {
    if (i > 0 && isWordChar(text[i - 1])) continue;

    for (const mention of ordered) {
      const name = mention.persona;
      const end = i + name.length;
      if (end > text.length) continue;
      if (text.slice(i, end).toLowerCase() !== name.toLowerCase()) continue;
      if (end < text.length && isWordChar(text[end])) continue;

      if (i > copied) runs.push({ text: text.slice(copied, i), color: null });
      runs.push({ text: text.slice(i, end), color: mention.color });
      copied = end;
      i = end - 1;
      break;
    }
  }

  if (copied < text.length)
    runs.push({ text: text.slice(copied), color: null });
  return runs.length > 0 ? runs : [{ text, color: null }];
}

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}_]/u.test(c);
}
