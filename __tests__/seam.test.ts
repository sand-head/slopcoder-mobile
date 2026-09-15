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

  /**
   * `/git/repos` answers `{repos, errors}` because a fan-out across forges can
   * half-fail. `/git/repos/search` is best-effort and answers the rows bare.
   * Reading the second as the first yielded `undefined.repos`, so every search
   * in the attach sheet came back empty and it only ever showed the
   * repositories recent sessions had used.
   */
  it('reads a repository search as the bare array the endpoint returns', async () => {
    const rows = [{ fullName: 'a/b', cloneUrl: 'https://x/a/b.git', kind: 1, private: false }];
    fetchMock.mockReturnValue(reply(200, rows));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await expect(seam.searchRepos('b')).resolves.toEqual(rows);
    expect(fetchMock.mock.calls[0][0]).toBe('https://s/api/seam/git/repos/search?q=b');
  });

  /** The listing it is not: this one really does wrap its rows. */
  it('reads a repository listing as an object, errors and all', async () => {
    fetchMock.mockReturnValue(reply(200, { repos: [], errors: ['github: 503'] }));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await expect(seam.repos()).resolves.toEqual({ repos: [], errors: ['github: 503'] });
  });

  it('reads a 404 as null, not as a failure', async () => {
    fetchMock.mockReturnValue(reply(404));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await expect(seam.session('gone')).resolves.toBeNull();
  });

  /**
   * The server's record is `ImageAttachment(MediaType, Base64Data)`, so the
   * JSON says `base64Data`. The type used to say `base64`, which nothing sent
   * until now; a wrong name here is an image the model never sees.
   */
  it('sends images inline under the names the server reads', async () => {
    fetchMock.mockReturnValue(reply(200));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await seam.start('abc', {
      prompt: 'what is this',
      selection: { auto: true, connectionId: null, modelId: null },
      images: [{ mediaType: 'image/jpeg', base64Data: 'QUJD' }],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://s/api/seam/sessions/abc/start');
    expect(JSON.parse(init.body).images).toEqual([{ mediaType: 'image/jpeg', base64Data: 'QUJD' }]);
  });

  it('reads a 404 on a command as "no longer applicable"', async () => {
    fetchMock.mockReturnValue(reply(404));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    // Steering a turn that already ended, or answering a resolved approval.
    await expect(seam.steer('abc', { prompt: 'x' })).resolves.toBe(false);
  });

  /**
   * A save answers with a result rather than a TextResult, because it may
   * mint a webhook secret and this is the one moment it is readable.
   */
  it('reads a create as the save result it is, secrets and all', async () => {
    const result = { error: null, webhooks: [{ automationId: 'a', triggerId: 't', secret: 's3' }] };
    fetchMock.mockReturnValue(reply(200, result));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    const draft = { name: 'x', prompt: 'y', triggers: [] } as never;
    await expect(seam.createRoutine(draft)).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://s/api/seam/automations/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'x', prompt: 'y', triggers: [] });
  });

  it('words a 404 on an update rather than saving into the void', async () => {
    fetchMock.mockReturnValue(reply(404));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await expect(seam.updateRoutine('gone', {} as never)).resolves.toEqual({
      error: 'That routine is gone.',
      webhooks: [],
    });
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
  });

  it('sends a schedule to be read in the phone zone', async () => {
    fetchMock.mockReturnValue(reply(200, { ok: true, cron: '0 7 * * 1-5' }));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await seam.parseSchedule('every weekday at 7am', 'Europe/Berlin');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://s/api/seam/automations/schedule');
    expect(JSON.parse(init.body)).toEqual({ text: 'every weekday at 7am', timeZoneId: 'Europe/Berlin' });
  });

  it('sends a description to be drafted', async () => {
    fetchMock.mockReturnValue(reply(200, { ok: false, error: 'no model' }));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    const result = await seam.draftRoutine('check the deploy each morning');

    expect(result.ok).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      description: 'check the deploy each morning',
      timeZoneId: null,
    });
  });

  it('rotates a webhook secret at the trigger, not the routine', async () => {
    fetchMock.mockReturnValue(reply(200, { error: null, webhooks: [] }));
    const seam = new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });

    await seam.rotateWebhookSecret('a', 't');

    expect(fetchMock.mock.calls[0][0]).toBe('https://s/api/seam/automations/a/webhooks/t/rotate');
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

/**
 * The routines half of the seam, whose paths still say `automations` — the
 * entities kept that name when the screens took the new one.
 *
 * Two shapes here are easy to get wrong and silent when you do: a command
 * answers `TextResult`, where a *null* value is success and a string is the
 * problem to show, and the enable/disable routes carry the boolean in the path
 * behind a `:bool` constraint.
 */
describe('routines', () => {
  const seam = () => new Seam({ baseUrl: 'https://s', apiKey: 'slop_k' });
  const url = () => fetchMock.mock.calls[0][0] as string;

  it('asks for the board in the phone own zone, so "today" means today here', async () => {
    fetchMock.mockReturnValue(reply(200, { routines: [], failures: [] }));
    await seam().routineBoard('Europe/Berlin');

    expect(url()).toBe('https://s/api/seam/automations/board?tz=Europe%2FBerlin');
  });

  /** No zone at all beats a wrong one: the server then counts in UTC and says so. */
  it('leaves the zone off entirely when the phone could not name it', async () => {
    fetchMock.mockReturnValue(reply(200, {}));
    await seam().routineStatus(undefined);

    expect(url()).toBe('https://s/api/seam/automations/status');
  });

  it('answers an empty board rather than null when there is nothing', async () => {
    fetchMock.mockReturnValue(reply(404));

    await expect(seam().routineBoard()).resolves.toEqual(
      expect.objectContaining({ routines: [], failures: [], heartbeat: null }),
    );
  });

  /** `{value: null}` is the server saying it worked, not saying nothing. */
  it('reads a command answer as the problem or as silence', async () => {
    fetchMock.mockReturnValue(reply(200, { value: null }));
    await expect(seam().runRoutineNow('r1')).resolves.toBeNull();

    fetchMock.mockReturnValue(reply(200, { value: 'The session is busy.' }));
    await expect(seam().runRoutineNow('r1')).resolves.toBe('The session is busy.');
  });

  /**
   * A 404 here is "no such routine, or not yours" — deliberately the same
   * answer. Letting it fall through as a null would report a routine that does
   * not exist as having been started.
   */
  it('does not report a missing routine as a command that worked', async () => {
    fetchMock.mockReturnValue(reply(404));
    await expect(seam().runRoutineNow('gone')).resolves.toBe('That routine is gone.');
  });

  it('puts the switch position in the path, where the route expects it', async () => {
    fetchMock.mockReturnValue(reply(200, { value: null }));
    await seam().setRoutineEnabled('r1', false);

    expect(url()).toBe('https://s/api/seam/automations/r1/enabled/false');
  });

  it('sends a prompt in the body, not in a URL', async () => {
    fetchMock.mockReturnValue(reply(200, { value: null }));
    await seam().setRoutinePrompt('r1', 'Check the queue.');

    expect(url()).toBe('https://s/api/seam/automations/r1/prompt');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ value: 'Check the queue.' });
  });

  it('pages a run log, and the run under one of its rows', async () => {
    fetchMock.mockReturnValue(reply(200, { runs: [], total: 0 }));
    await seam().routineRuns('r1', 30, 30);
    expect(url()).toBe('https://s/api/seam/automations/r1/runs/page?skip=30&take=30');

    fetchMock.mockReset();
    fetchMock.mockReturnValue(reply(200, {}));
    await seam().routineRun('r1', 'run9');
    expect(url()).toBe('https://s/api/seam/automations/r1/runs/run9');
  });
});
