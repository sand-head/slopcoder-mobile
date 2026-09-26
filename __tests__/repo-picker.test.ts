/**
 * The attach sheet has to offer the same repositories the cockpit does.
 *
 * It did not: the app asked the server on every query of two characters or
 * more, never listed the repositories you own at all, and parsed the search's
 * answer as `{repos: […]}` when the endpoint returns the rows bare — so every
 * search resolved to an empty list and the only thing the sheet ever showed was
 * the handful of repositories recent sessions had used.
 *
 * These are the rules from `AttachPicker.razor`, which is the side that was
 * right.
 */
import {
  kindFromUrl,
  localMatches,
  offer,
  remoteMatches,
  rowToChoice,
  shouldSearch,
  urlIn,
  type RepoChoice,
} from '../src/api/repoPicker';
import { GitServiceKind } from '../src/api/contracts';

const owned: RepoChoice[] = [
  { key: 'https://git.sand.town/sand_head/slopcoder.git', label: 'sand_head/slopcoder' },
  { key: 'https://git.sand.town/sand_head/slopedit.git', label: 'sand_head/slopedit' },
  { key: 'https://github.com/sand-head/slopcoder-mobile.git', label: 'sand-head/slopcoder-mobile' },
];

const recent: RepoChoice[] = [{ key: owned[0].key, label: owned[0].label }];

describe('what the sheet offers', () => {
  it('shows recent repositories before anything is typed', () => {
    const shown = offer({ query: '', recent, owned, found: [], searching: false });

    expect(shown.label).toBe('recent');
    expect(shown.options).toEqual(recent);
  });

  /** The list the app never had. This is the whole bug report. */
  it('matches the repositories you own, locally', () => {
    const shown = offer({ query: 'slop', recent, owned, found: [], searching: false });

    expect(shown.options.map(r => r.label)).toEqual([
      'sand_head/slopcoder',
      'sand_head/slopedit',
      'sand-head/slopcoder-mobile',
    ]);
    expect(shouldSearch(owned, 'slop', true)).toBe(false);
  });

  it('is not case-sensitive, and ignores the spaces around a query', () => {
    expect(localMatches(owned, '  SLOPEDIT ').map(r => r.label)).toEqual(['sand_head/slopedit']);
  });

  it('waits for a second character before matching anything', () => {
    expect(localMatches(owned, 's')).toEqual([]);
    expect(shouldSearch(owned, 's', true)).toBe(false);
  });

  /**
   * The search is the expansion, not the first resort: one request, and only
   * once nothing of yours matched.
   */
  it('only asks the server when nothing of yours matches', () => {
    expect(shouldSearch(owned, 'torvalds', true)).toBe(true);
    expect(shouldSearch(owned, 'slopcoder', true)).toBe(false);
  });

  /** Before they arrive, "nothing of yours matched" is not a fact yet. */
  it('does not search while your own repositories are still loading', () => {
    expect(shouldSearch(owned, 'torvalds', false)).toBe(false);
  });

  it('drops what you already own, and duplicates between forges', () => {
    const found: RepoChoice[] = [
      { key: owned[0].key, label: owned[0].label },
      { key: 'https://github.com/torvalds/linux.git', label: 'torvalds/linux' },
      { key: 'https://github.com/torvalds/linux.git', label: 'torvalds/linux' },
    ];

    expect(remoteMatches(owned, found).map(r => r.label)).toEqual(['torvalds/linux']);
  });

  it('says it is searching rather than that nothing matched', () => {
    const shown = offer({ query: 'torvalds', recent, owned, found: [], searching: true });

    expect(shown.empty).toBe('Searching…');
    expect(offer({ query: 'torvalds', recent, owned, found: [], searching: false }).empty).toBe(
      'Nothing matched.',
    );
  });

  /** A pasted clone URL is an instruction, not a search. */
  it.each([
    'https://github.com/torvalds/linux.git',
    'git@github.com:torvalds/linux.git',
    'ssh://git@example.com/x.git',
  ])('offers %s as itself', url => {
    expect(urlIn(url)).toBe(url);

    const shown = offer({ query: url, recent, owned, found: [], searching: false });
    expect(shown.options).toEqual([{ key: url, label: url, kind: kindFromUrl(url) }]);
    // And there is nothing to search a forge for.
    expect(shouldSearch(owned, url, true)).toBe(false);
  });

  it('treats an ordinary query as a search, not a URL', () => {
    expect(urlIn('sand_head/slopcoder')).toBeNull();
  });

  it('attaches by clone url, and says when a repository is private', () => {
    const row = {
      fullName: 'sand_head/slopcoder',
      cloneUrl: 'https://git.sand.town/sand_head/slopcoder.git',
      kind: GitServiceKind.Forgejo,
      private: true,
    };

    // The key is what a session is attached to; the label is only for reading.
    expect(rowToChoice(row)).toEqual({
      key: row.cloneUrl,
      label: row.fullName,
      description: 'private',
      kind: GitServiceKind.Forgejo,
    });
    expect(rowToChoice({ ...row, private: false }).description).toBeUndefined();
  });

  /**
   * The mark beside a pasted URL. github.com is the one host a URL names on
   * its own; a Forgejo host belongs to whichever connection names it, which
   * the server resolves for labeled rows — a bare pasted URL keeps the
   * generic Git mark rather than guessing.
   */
  it.each([
    ['https://github.com/torvalds/linux.git', GitServiceKind.GitHub],
    ['https://github.com/torvalds/linux', GitServiceKind.GitHub],
    ['git@github.com:torvalds/linux.git', null],
    ['https://git.sand.town/sand_head/slopcoder.git', null],
  ])('marks %s', (url, kind) => {
    expect(kindFromUrl(url)).toBe(kind);
  });
});
