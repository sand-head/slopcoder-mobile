/**
 * What a link in a transcript points at, decided without touching navigation.
 *
 * The agent writes links in the web's own spelling — `/artifacts/{id}`, the
 * route its publish tool hands back — and the cockpit catches those in
 * `app.js` and opens its artifact panel. A phone has no origin for a relative
 * path to resolve against, so without this the markdown renderer handed
 * `/artifacts/…` to `Linking.openURL`, which rejected it, and the rejection
 * went nowhere: the tap did nothing at all.
 *
 * Same-host links (relative, or absolute on the server this app is signed in
 * to) become the app's own screens; the deep-link scheme does too; any other
 * http(s) link goes to the system browser; everything else is refused, out
 * loud, by the caller.
 */

export type LinkTarget =
  | { kind: 'artifact'; id: string; version: number | null }
  | { kind: 'session'; id: string }
  | { kind: 'routine'; id: string }
  | { kind: 'external'; url: string }
  | { kind: 'unsupported'; url: string };

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ARTIFACT = new RegExp(`^/?artifacts/(${GUID})/?$`, 'i');
const SESSION = new RegExp(`^/?session/(${GUID})/?$`, 'i');
const ROUTINE = new RegExp(`^/?routines/(${GUID})/?$`, 'i');

/** `scheme://host[:port]`, lowercased, or null when the base is not a URL. */
function originOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : null;
}

/** Path and query of an app route, split. Fragments are dropped. */
function split(rest: string): { path: string; query: string } {
  const noHash = rest.split('#', 1)[0];
  const q = noHash.indexOf('?');
  return q < 0 ? { path: noHash, query: '' } : { path: noHash.slice(0, q), query: noHash.slice(q + 1) };
}

function versionOf(query: string): number | null {
  for (const pair of query.split('&')) {
    const [key, value] = pair.split('=', 2);
    if (key === 'v' && value && /^\d{1,6}$/.test(value)) {
      const n = Number(value);
      return n >= 1 ? n : null;
    }
  }
  return null;
}

/** An app route's path (with or without its leading slash), or null when it is none of ours. */
function route(path: string, query: string): LinkTarget | null {
  let m = ARTIFACT.exec(path);
  if (m) return { kind: 'artifact', id: m[1].toLowerCase(), version: versionOf(query) };
  m = SESSION.exec(path);
  if (m) return { kind: 'session', id: m[1].toLowerCase() };
  m = ROUTINE.exec(path);
  if (m) return { kind: 'routine', id: m[1].toLowerCase() };
  return null;
}

/**
 * Decide where `href` goes. `baseUrl` is the signed-in server (the seam's own
 * base URL, path included when the app is served under one).
 */
export function resolveLink(href: string, baseUrl: string | null): LinkTarget {
  const url = href.trim();
  if (url.length === 0) return { kind: 'unsupported', url };

  // The app's own scheme: slopcoder://artifacts/{id}, the same routes.
  const scheme = /^slopcoder:\/\/(.*)$/i.exec(url);
  if (scheme) {
    const { path, query } = split(scheme[1]);
    return route(path, query) ?? { kind: 'unsupported', url };
  }

  if (/^https?:\/\//i.test(url)) {
    const server = trimBase(baseUrl);
    const baseOrigin = server ? originOf(server) : null;
    if (server && baseOrigin && originOf(url) === baseOrigin) {
      // Strip the origin, then the base path if the server lives under one.
      let rest = url.slice(baseOrigin.length);
      const basePath = server.slice(baseOrigin.length);
      if (basePath && rest.toLowerCase().startsWith(basePath.toLowerCase())) rest = rest.slice(basePath.length);
      const { path, query } = split(rest);
      const target = route(path, query);
      if (target) return target;
    }
    return { kind: 'external', url };
  }

  if (/^mailto:/i.test(url)) return { kind: 'external', url };

  // Anything with a scheme we do not know is refused, not guessed at.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { kind: 'unsupported', url };

  // Relative: the web's own spelling, `/artifacts/{id}` or `artifacts/{id}`.
  const { path, query } = split(url);
  const target = route(path, query);
  if (target) return target;
  // Some other page of the server: open it in the browser rather than drop it.
  const server = trimBase(baseUrl);
  if (server && url.startsWith('/') && !url.startsWith('//')) return { kind: 'external', url: `${server}${url}` };
  return { kind: 'unsupported', url };
}

function trimBase(baseUrl: string | null): string | null {
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null;
}

/** One piece of a string: plain text, or a link and where it goes. */
export type TextSegment = { text: string; href: null } | { text: string; href: string };

/**
 * Links inside tool-result text, which is plain text rather than markdown:
 * absolute http(s) URLs, the deep-link scheme, and the web's relative
 * `/artifacts/{id}`, `/session/{id}` and `/routines/{id}` routes. Trailing
 * sentence punctuation stays outside the link.
 */
const LINKS = new RegExp(
  `(?:https?://[^\\s<>"'\`]+|slopcoder://[^\\s<>"'\`]+|/?(?:artifacts|session|routines)/${GUID}(?:\\?v=\\d+)?)`,
  'gi',
);

export function linkSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINKS)) {
    let link = match[0];
    const trailing = /[.,;:!?)\]}]+$/.exec(link);
    if (trailing) link = link.slice(0, link.length - trailing[0].length);
    if (link.length === 0) continue;
    const start = match.index ?? 0;
    // A relative route has to start a word: `foo/artifacts/…` is somebody's
    // path, not our link. (Checked by hand: no lookbehind, for older engines.)
    if (!/^[a-z]+:/i.test(link) && start > 0 && /[\w/.:-]/.test(text[start - 1])) continue;
    if (start > last) segments.push({ text: text.slice(last, start), href: null });
    segments.push({ text: link, href: link });
    last = start + link.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), href: null });
  return segments;
}
