/**
 * Drives the compiled client against a live slopcoder. This is the check that
 * catches what unit tests cannot: a Delta arity mismatch, a camelCase slip, an
 * enum that is a string after all.
 */
const path = require('path');
const DIST = process.env.SCRATCH + '/apidist';
require('module').Module._initPaths();
process.env.NODE_PATH = path.join(process.cwd(), 'node_modules');
require('module').Module._initPaths();

const { Seam } = require(DIST + '/seam.js');
const { SessionHub } = require(DIST + '/hub.js');
const { SessionStream, LiveAccumulator } = require(DIST + '/stream.js');
const { TranscriptFolder } = require(DIST + '/transcript.js');
const { SessionStatus } = require(DIST + '/contracts.js');

const BASE = 'http://127.0.0.1:5199';
const KEY = require(process.env.SCRATCH + '/devicekey.json').fullKey;
const CONNECTION = process.argv[2];

const pass = [], fail = [];
const check = (name, ok, extra = '') => (ok ? pass : fail).push(name + (extra ? ` — ${extra}` : ''));

(async () => {
  const seam = new Seam({ baseUrl: BASE, apiKey: KEY });

  const protocol = await seam.protocol();
  check('GET /protocol returns camelCase fields', typeof protocol?.executor === 'number', JSON.stringify(protocol).slice(0, 60));

  check('the device key reaches the seam', Array.isArray(await seam.sessions()));

  const models = await seam.models();
  check('model candidates come back', models.length > 0, `${models.length} candidate(s)`);
  check('ModelCandidate fields are camelCase', models[0] && 'connectionId' in models[0] && 'modelId' in models[0],
    models[0] ? Object.keys(models[0]).join(',') : 'none');

  // --- create a session the way the app does: no clientWorkspace ---
  const selection = { auto: false, connectionId: CONNECTION, modelId: 'fake-model' };
  const id = await seam.createSession({ selection, initialPrompt: 'say hello' });
  check('createSession returns an id', Boolean(id), String(id));
  if (!id) throw new Error('cannot continue without a session');

  const created = await seam.session(id);
  check('the session is server-sandboxed (no clientWorkspace)', created.clientWorkspace == null);
  check('SessionStatus is numeric on the wire', typeof created.status === 'number', `status=${created.status}`);
  check('ApprovalMode is numeric on the wire', typeof created.approvalMode === 'number', `approvalMode=${created.approvalMode}`);
  check('state carries pendingApprovalIds', Array.isArray(created.pendingApprovalIds));
  check('state carries nextOrdinal', typeof created.nextOrdinal === 'number');

  // --- the live channel ---
  const deltas = [];
  let arity = null;
  const hub = new SessionHub({ baseUrl: BASE, apiKey: KEY });
  hub.addListener(id, (sessionId, state, events, patch) => {
    if (arity === null) arity = arguments_length(sessionId, state, events, patch);
    deltas.push({ state, events, patch });
  });
  function arguments_length(a, b, c, d) {
    return [a, b, c, d].filter(x => x !== undefined).length;
  }

  await hub.start();
  check('the hub accepts the device key', hub.connected);

  const seed = await hub.subscribe(id);
  check('Subscribe returns a seed state', Boolean(seed?.id), seed ? `id=${seed.id}` : 'null');

  await seam.start(id, { prompt: 'say hello', selection });

  // Let the fake provider stream.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    const last = deltas[deltas.length - 1];
    if (last && last.state.status === SessionStatus.Idle && deltas.length > 2) break;
  }

  check('Delta pushes arrived', deltas.length > 0, `${deltas.length} push(es)`);
  check('Delta binds all four arguments', arity === 4, `bound ${arity}`);
  check('at least one push carried a LivePatch', deltas.some(d => d.patch !== null));
  check('at least one push carried events', deltas.some(d => d.events.length > 0));

  // --- reassembly over the real stream ---
  const stream = new SessionStream();
  const accumulator = new LiveAccumulator();
  stream.seed(0, await seam.scrollback(id, 0));
  for (const d of deltas) { stream.apply(d.state, d.events); accumulator.apply(d.patch); }

  const finalState = await seam.session(id);
  const full = await seam.scrollback(id, 0);
  check('the stream held every ordinal', stream.nextOrdinal === finalState.nextOrdinal,
    `local=${stream.nextOrdinal} server=${finalState.nextOrdinal}`);
  check('the accumulator never fell behind', !accumulator.needsSeed);

  const folder = new TranscriptFolder();
  const items = folder.fold(full);
  const kinds = items.map(i => i.kind);
  check('the fold produced a user prompt', kinds.includes('user'), kinds.join(','));
  check('the fold produced assistant text', kinds.includes('text'));

  const text = items.filter(i => i.kind === 'text').map(i => i.text).join('');
  check('the reply text survived the round trip', text.includes('fake provider'), JSON.stringify(text.slice(0, 60)));

  // --- commands ---
  check('steer on an idle session is false, not an error', (await seam.steer(id, { prompt: 'x' })) === false);
  check('presence is accepted', (await seam.presence(id)) === true);
  check('a command on a missing session is false', (await seam.stop('00000000-0000-0000-0000-000000000000')) === false);

  // --- routines ---
  //
  // Fifteen DTOs hand-ported from IAutomationsApi.cs, every one of them read-
  // only and folded server-side, which is exactly the shape a camelCase slip or
  // a numeric enum read as a string hides in: the screen renders, and it renders
  // "undefined".
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const board = await seam.routineBoard(zone);
  check('the board comes back shaped', Array.isArray(board.routines) && Array.isArray(board.failures),
    Object.keys(board).join(','));
  check('the board counts today', typeof board.runsToday === 'number');
  check('the phone ledger is present (RecentRuns)', board.recentRuns !== undefined,
    'null means an older host; the cards\' last runs stand in');

  const status = await seam.routineStatus(zone);
  check('the strip status comes back', typeof status.anyRoutines === 'boolean',
    JSON.stringify(status).slice(0, 80));

  const beat = await seam.heartbeat();
  check('the heartbeat is created on demand', Boolean(beat?.id), beat ? `kind=${beat.kind}` : 'null');
  check('AutomationKind is numeric on the wire', typeof beat?.kind === 'number');
  check('a TimeOnly is a string, not an object',
    beat?.activeHoursStart == null || typeof beat.activeHoursStart === 'string',
    String(beat?.activeHoursStart));

  if (beat) {
    const detail = await seam.routine(beat.id);
    check('a routine detail comes back', Boolean(detail?.routine?.id));
    check('the history strip is padded to 30', detail?.history?.length === 30, `${detail?.history?.length}`);
    check('triggers carry their own stats', Array.isArray(detail?.triggers));

    const runs = await seam.routineRuns(beat.id, 0, 5);
    check('a run page comes back', Array.isArray(runs.runs) && typeof runs.total === 'number');

    // A command answers TextResult: null is success, a string is the problem.
    const problem = await seam.setRoutineEnabled(beat.id, false);
    check('a command answers null when it worked', problem === null, String(problem));
    check('a command on a missing routine is a sentence, not silence',
      (await seam.runRoutineNow('00000000-0000-0000-0000-000000000000')) !== null);
  }

  await hub.stop();

  console.log('\n--- PASS ---');
  for (const p of pass) console.log('  ✓ ' + p);
  if (fail.length) {
    console.log('\n--- FAIL ---');
    for (const f of fail) console.log('  ✗ ' + f);
  }
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
