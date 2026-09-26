/**
 * Which repositories the attach sheet offers, and when it asks the server.
 *
 * The cockpit's `AttachPicker.razor` has settled this already, and the two have
 * to agree or the same search gives different answers depending on which screen
 * you are holding. Its rule, in order:
 *
 * 1. Nothing typed: the repositories recent sessions used.
 * 2. Typed: the ones you own, matched locally — no round trip, no debounce.
 * 3. Typed and *nothing* of yours matches: widen to a search across every
 *    connected forge, minus what you already own, capped.
 * 4. A clone URL rather than a search: offer it as itself, whoever owns it.
 *
 * Step 3 is the only one that costs a request, and the third condition is what
 * keeps it rare. The app used to skip straight to it — and parse its answer
 * wrongly, so the search always came back empty and the sheet only ever showed
 * step 1. "Does it only use repos from existing sessions?" was exactly right.
 */
import { GitServiceKind, type GitRepoRow } from './contracts';

export interface RepoChoice {
  /** The clone URL, which is what a session is actually attached to. */
  key: string;
  label: string;
  description?: string;
  /** Which forge the row came from — picks the mark beside the name. */
  kind?: GitServiceKind | null;
}

/** How many of your own repositories to show for one query. */
const LOCAL_LIMIT = 20;

/** How many to keep from a search across the forges. */
const REMOTE_LIMIT = 15;

/** Below this a query is not yet worth matching on. */
const MIN_QUERY = 2;

export function rowToChoice(row: GitRepoRow): RepoChoice {
  return {
    key: row.cloneUrl,
    label: row.fullName,
    description: row.private ? 'private' : undefined,
    kind: row.kind,
  };
}

/**
 * The mark for a repo the sheet only has a URL for — a recent one the server
 * has not labeled yet, or a pasted clone URL. github.com is the one host a
 * name alone recognizes; a bare URL row keeps the generic Git mark.
 */
export function kindFromUrl(url: string): GitServiceKind | null {
  const host = /^https?:\/\/([^/]+)/i.exec(url.trim())?.[1]?.toLowerCase();
  return host === 'github.com' ? GitServiceKind.GitHub : null;
}

/** A query that is a clone URL is an instruction, not a search. */
export function urlIn(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.includes('://') || trimmed.startsWith('git@') ? trimmed : null;
}

/** Your own repositories whose name contains the query. */
export function localMatches(owned: RepoChoice[], query: string): RepoChoice[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];

  return owned.filter(r => r.label.toLowerCase().includes(needle)).slice(0, LOCAL_LIMIT);
}

/**
 * Whether to spend a request on this query.
 *
 * Not for a URL (there is nothing to search for), not for a fragment, and not
 * while anything you own still matches — that last one is what makes the search
 * an expansion rather than the first resort.
 */
export function shouldSearch(owned: RepoChoice[], query: string, ownedLoaded: boolean): boolean {
  return (
    ownedLoaded &&
    urlIn(query) === null &&
    query.trim().length >= MIN_QUERY &&
    localMatches(owned, query).length === 0
  );
}

/** A search's rows, minus the ones you own and any duplicates between forges. */
export function remoteMatches(owned: RepoChoice[], found: RepoChoice[]): RepoChoice[] {
  const mine = new Set(owned.map(r => r.key));
  const seen = new Set<string>();

  return found
    .filter(r => !mine.has(r.key) && !seen.has(r.key) && seen.add(r.key))
    .slice(0, REMOTE_LIMIT);
}

export interface Offered {
  /** What the group is: recents, your own, or the wider forges. */
  label: string;
  options: RepoChoice[];
  /** Shown when there is nothing, which is not the same as not having looked. */
  empty: string;
}

/** Everything above, as the one list the sheet renders. */
export function offer({
  query,
  recent,
  owned,
  found,
  searching,
}: {
  query: string;
  recent: RepoChoice[];
  owned: RepoChoice[];
  found: RepoChoice[];
  searching: boolean;
}): Offered {
  const url = urlIn(query);
  if (url !== null) {
    return {
      label: 'clone url',
      options: [{ key: url, label: url, kind: kindFromUrl(url) }],
      empty: '',
    };
  }

  if (query.trim().length < MIN_QUERY) {
    return { label: 'recent', options: recent, empty: 'No recent repositories.' };
  }

  const mine = localMatches(owned, query);
  if (mine.length > 0) return { label: 'your repositories', options: mine, empty: '' };

  return {
    label: searching ? 'searching…' : 'everywhere else',
    options: remoteMatches(owned, found),
    empty: searching ? 'Searching…' : 'Nothing matched.',
  };
}
