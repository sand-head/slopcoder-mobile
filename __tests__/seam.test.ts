/**
 * The HTTP contract's sharp edges: the header that is not optional, and the
 * status codes that mean something other than "it broke".
 */
import {
  Seam,
  SeamError,
  SignedOutError,
  OfflineError,
  CLIENT_HEADER,
  parsePairingUri,
} from '../src/api/seam';

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function reply(status: number, body?: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  });
}

beforeEach(() => fetchMock.mockReset());

describe('Seam', () => {
  it('sends the header SameOriginFilter demands on a mutation', async () => {
    fetchMock.mockReturnValue(reply(204));
    const seam = new Seam({ baseUrl: 'https://slop.example.com', apiKey: 'slop_k' });

    await seam.stop('abc');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers[CLIENT_HEADER]).toBe('1');
    expect(init.headers.Authorization).toBe('Bearer slop_k');
  });

  it('trims a trailing slash off the server so URLs do not double up', async () => {
    fetchMock.mockReturnValue(reply(200, []));
    const seam = new Seam({ baseUrl: 'https://slop.example.com/', apiKey: 'slop_k' });

    await seam.sessions();

    expect(fetchMock.mock.calls[0][0]).toBe('https://slop.example.com/api/seam/sessions/');
  });

  it('reads a 404 as null, not as a failure', async () => {
    fetchMock.mockReturnValue(reply(404));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await expect(seam.session('gone')).resolves.toBeNull();
  });

  it('reads a 404 on a command as "no longer applicable"', async () => {
    fetchMock.mockReturnValue(reply(404));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    // Steering a turn that already ended, or answering a resolved approval.
    await expect(seam.steer('abc', { prompt: 'x' })).resolves.toBe(false);
  });

  it('signs out on a 401 rather than retrying', async () => {
    fetchMock.mockReturnValue(reply(401));
    const onSignedOut = jest.fn();
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_dead', onSignedOut });

    await expect(seam.sessions()).rejects.toBeInstanceOf(SignedOutError);
    expect(onSignedOut).toHaveBeenCalled();
  });
});

describe('reachability', () => {
  /** What fetch throws when there is no route, no DNS, or no listener. */
  const networkFailure = () => Promise.reject(new TypeError('Network request failed'));

  it('reports a dead server as unreachable, not as a server error', async () => {
    fetchMock.mockImplementation(networkFailure);
    const seam = new Seam({ baseUrl: 'https://nope.invalid', apiKey: 'slop_k' });

    await expect(seam.sessions()).rejects.toBeInstanceOf(OfflineError);
  });

  it('says something a person can act on', async () => {
    fetchMock.mockImplementation(networkFailure);
    const seam = new Seam({ baseUrl: 'https://nope.invalid', apiKey: 'slop_k' });

    // Not "TypeError: Network request failed", which is what leaks out of fetch.
    await expect(seam.sessions()).rejects.toThrow(/could not reach/i);
  });

  it('tells the app when it goes down and when it comes back', async () => {
    const seen: boolean[] = [];
    const seam = new Seam({
      baseUrl: 'https://s',
      apiKey: 'slop_k',
      onReachable: r => seen.push(r),
    });

    fetchMock.mockImplementation(networkFailure);
    await seam.sessions().catch(() => {});

    fetchMock.mockImplementation(() => reply(200, []));
    await seam.sessions();

    expect(seen).toEqual([false, true]);
  });

  it('counts a 500 as reached — the server is there and unhappy', async () => {
    const seen: boolean[] = [];
    fetchMock.mockImplementation(() => reply(500));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k', onReachable: r => seen.push(r) });

    await expect(seam.sessions()).rejects.toBeInstanceOf(SeamError);
    expect(seen).toEqual([true]);
  });

  it('does not call an abort a dead server', async () => {
    // A cancelled request is a screen changing its mind, and treating it as an
    // outage would flash the banner every time one unmounts mid-fetch.
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockImplementation(() => Promise.reject(abort));
    const seen: boolean[] = [];
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k', onReachable: r => seen.push(r) });

    await expect(seam.sessions()).rejects.toThrow('aborted');
    expect(seen).toEqual([]);
  });
});

describe('parsePairingUri', () => {
  it('reads what the settings page draws', () => {
    expect(
      parsePairingUri('slopcoder://pair?server=https%3A%2F%2Fslop.example.com&code=NDYZ9J5M'),
    ).toEqual({ server: 'https://slop.example.com', code: 'NDYZ9J5M' });
  });

  it('refuses a QR that is not ours', () => {
    expect(parsePairingUri('https://example.com')).toBeNull();
    expect(parsePairingUri('slopcoder://pair?code=ONLY')).toBeNull();
  });
});
