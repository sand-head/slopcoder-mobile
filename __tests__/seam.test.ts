/**
 * The HTTP contract's sharp edges: the header that is not optional, and the
 * status codes that mean something other than "it broke".
 */
import { Seam, SignedOutError, CLIENT_HEADER, parsePairingUri } from '../src/api/seam';

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
