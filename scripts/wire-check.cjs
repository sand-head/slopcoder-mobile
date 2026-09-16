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
  check('model candidates come back as a list', Array.isArray(models), `${models.length} candidate(s)`);
  if (CONNECTION) {
    check('model candidates come back', models.length > 0, `${models.length} candidate(s)`);
    check('ModelCandidate fields are camelCase', models[0] && 'connectionId' in models[0] && 'modelId' in models[0],
      models[0] ? Object.keys(models[0]).join(',') : 'none');
  }

  // A provider connection is the argument; without one the session half is
  // skipped and the routines half — which needs no model — still runs.
  let hub = null;
  if (CONNECTION) {
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
  hub = new SessionHub({ baseUrl: BASE, apiKey: KEY });
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
  }

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

  // --- authoring ---
  //
  // The editor's writes are where a shape slip costs the most: a TimeOnly the
  // server will not parse, a new trigger sent with "" for an id, an enum as a
  // word. Create one with a schedule and a webhook, read it back, update it,
  // rotate the secret, delete it.
  const read = await seam.parseSchedule('every weekday at 7am', zone);
  check('a schedule is read server-side', read.ok === true && typeof read.cron === 'string', JSON.stringify(read).slice(0, 80));
  check('a schedule nobody can read says why', (await seam.parseSchedule('whenever', zone)).ok === false);

  const channels = await seam.channels();
  check('channels come back as a list', Array.isArray(channels));

  const draft = {
    name: 'wire-check routine',
    prompt: 'say NO_REPLY',
    cronExpression: read.cron,
    timeZoneId: read.zone ?? zone,
    enabled: false,
    facet: 'execute',
    model: null,
    repoUrls: [],
    continuity: false,
    activeHoursStart: '08:00:00',
    activeHoursEnd: '22:30:00',
    deliveryKind: 0,
    deliveryTargetId: null,
    triggers: [
      { kind: 2, channelId: null, match: '', secret: null, id: '00000000-0000-0000-0000-000000000000', enabled: true },
    ],
    scheduleEnabled: true,
    nodeIds: [],
  };
  const created = await seam.createRoutine(draft);
  check('a create is accepted', created.error === null, String(created.error));
  check('a new webhook mints a secret, readable once', created.webhooks.length === 1 && typeof created.webhooks[0].secret === 'string');
  const createdId = created.webhooks[0]?.automationId;
  if (createdId) {
    const stored = (await seam.routines()).find(a => a.id === createdId);
    check('the routine reads back', Boolean(stored));
    check('a TimeOnly round-trips as HH:mm:ss', stored?.activeHoursStart === '08:00:00', String(stored?.activeHoursStart));
    check('the trigger got an id', stored?.triggers[0]?.id && stored.triggers[0].id !== draft.triggers[0].id);

    const updated = await seam.updateRoutine(createdId, {
      ...draft,
      name: 'wire-check routine (edited)',
      triggers: stored.triggers.map(t => ({ ...t, secret: null })),
    });
    check('an update is accepted', updated.error === null, String(updated.error));
    check('an update keeps the webhook, minting nothing', updated.webhooks.length === 0);

    const rotated = await seam.rotateWebhookSecret(createdId, stored.triggers[0].id);
    check('rotating mints one secret', rotated.error === null && rotated.webhooks.length === 1, String(rotated.error));

    check('a refused draft is a sentence', (await seam.updateRoutine(createdId, { ...draft, name: '' })).error !== null);
    check('the routine deletes', (await seam.deleteRoutine(createdId)) === true);
    check('deleting again is false, not an error', (await seam.deleteRoutine(createdId)) === false);
  }
  // The server words this one itself ("No such automation."), as a result
  // rather than a 404; the client's own wording is for a 404 it never sends.
  const missing = await seam.updateRoutine('00000000-0000-0000-0000-000000000000', draft);
  check('an update of a missing routine is a sentence', typeof missing.error === 'string', String(missing.error));

  // The describe-first draft needs a model; with none the answer is an
  // honest ok:false, which is the shape the editor handles.
  const drafted = await seam.draftRoutine('every weekday morning say hello', zone);
  check('a draft answers with its shape', typeof drafted.ok === 'boolean' && Array.isArray(drafted.triggers),
    drafted.ok ? `drafted by ${drafted.draftedBy}` : String(drafted.error));

  // --- the settings pages' seam: every group /settings/* edits ---
  //
  // What this half proves is the shape of each answer — a `{value}` on a PUT,
  // a `{id, error}` on a create, a 204 on a switch — and that a secret never
  // comes back. Each write is undone before the next check.

  const facetName = 'wire-check-facet';
  const facetBody = '---\ndescription: wire check\ntools-allow: read_file\n---\nYou only read.';
  const facetCheck = await seam.checkFacet(facetName, facetBody);
  check('a facet is checked by the real parser', facetCheck.error === null && facetCheck.toolsAllowed === 1, JSON.stringify(facetCheck));
  check('a facet with no frontmatter fence says why', (await seam.checkFacet(facetName, 'no fence')).error !== null);
  await seam.saveFacet(facetName, facetBody);
  const facets = await seam.userFacets();
  const facet = facets.find(f => f.name === facetName);
  check('a saved facet lists with its content', Boolean(facet) && facet.content === facetBody);
  check('the facet catalog now offers it', (await seam.facets()).some(f => f.name === facetName));
  if (facet) check('a facet deletes', (await seam.deleteFacet(facet.id)) === true);
  check('deleting a missing facet is false', (await seam.deleteFacet('00000000-0000-0000-0000-000000000000')) === false);

  const skillProblem = await seam.saveSkill('wire-check-skill', '---\nname: wire-check-skill\ndescription: a check\n---\nSteps.');
  check('a skill save answers null when it worked', skillProblem === null, String(skillProblem));
  check('a skill the parser refuses is a sentence', typeof (await seam.saveSkill('wire-check-bad', 'no frontmatter')) === 'string');
  const skill = (await seam.skills()).find(s => s.name === 'wire-check-skill');
  check('the skill lists', Boolean(skill));
  if (skill) check('the skill deletes', (await seam.deleteSkill(skill.id)) === true);

  await seam.saveMemory({ repoKey: '', name: 'wire-check-memory', description: 'a check', content: 'remember this', pinned: true });
  const memory = (await seam.memories()).find(m => m.name === 'wire-check-memory');
  check('a memory entry lists with its pin', Boolean(memory) && memory.pinned === true && memory.repoKey === '');
  if (memory) check('the memory entry deletes', (await seam.deleteMemory(memory.id)) === true);

  const hooksBefore = await seam.hooks();
  await seam.saveHooks('{"stop":[{"command":"true"}]}');
  check('hooks round-trip as a TextResult', (await seam.hooks()) === '{"stop":[{"command":"true"}]}');
  await seam.saveHooks(hooksBefore ?? '');
  const rules = 'rules:\n  - action: allow\n    tool: run_bash\n    executable: git\n';
  const rulesCheck = await seam.checkPermissions(rules);
  check('permission rules are checked server-side', rulesCheck.error === null && rulesCheck.ruleCount === 1, JSON.stringify(rulesCheck));
  check('bad YAML says why', (await seam.checkPermissions('rules: [')).error !== null);
  const permsBefore = await seam.permissions();
  await seam.savePermissions(rules);
  check('permission rules round-trip', (await seam.permissions()) === rules);
  await seam.savePermissions(permsBefore ?? '');

  const defaults = await seam.terminalDefaults();
  check('terminal defaults come back', Boolean(defaults) && typeof defaults.shell === 'string', JSON.stringify(defaults));
  await seam.saveTerminalPrefs('ripgrep', 'fish');
  const prefs = await seam.terminalPrefs();
  check('terminal prefs round-trip', prefs.shell === 'fish' && prefs.packages === 'ripgrep', JSON.stringify(prefs));
  await seam.saveTerminalPrefs(null, null);

  const mcp = await seam.createMcpServer({ displayName: 'wire-check-mcp', kind: 0, command: 'npx', args: ['-y', 'x'], url: null, secrets: { TOKEN: 's3cret' } });
  check('an mcp create answers {id, error}', typeof mcp.id === 'string' && mcp.error === null, JSON.stringify(mcp));
  if (mcp.id) {
    const listed = (await seam.mcpServers()).find(s => s.id === mcp.id);
    check('the mcp server lists with hasSecrets and never the secret', Boolean(listed) && listed.hasSecrets === true && !JSON.stringify(listed).includes('s3cret'));
    check('McpTransportKind is numeric on the wire', typeof listed?.kind === 'number');
    check('an mcp update answers null when it worked', (await seam.updateMcpServer(mcp.id, { displayName: 'wire-check-mcp', kind: 0, command: 'npx', args: [], url: null, secrets: null })) === null);
    check('an mcp switch lands', (await seam.setMcpServerEnabled(mcp.id, false)) === true);
    check('the mcp server deletes', (await seam.deleteMcpServer(mcp.id)) === true);
  }
  check('an mcp update of a missing id is a sentence', typeof (await seam.updateMcpServer('00000000-0000-0000-0000-000000000000', { displayName: 'x', kind: 0, command: 'x', args: [], url: null, secrets: null })) === 'string');

  const node = await seam.createNode({ name: 'wire-check-node', host: '127.0.0.1', port: 22, username: 'nobody', privateKeyPem: null });
  check('a generated node answers its authorized_keys line', typeof node.id === 'string' && typeof node.authorizedKeysLine === 'string', JSON.stringify(node).slice(0, 80));
  if (node.id) {
    const listed = (await seam.nodes()).find(n => n.id === node.id);
    check('the node lists with a public key and no fingerprint yet', Boolean(listed) && listed.publicKey.length > 0 && listed.hostKeyFingerprint === null);
    check('NodeKeyKind is numeric on the wire', typeof listed?.keyKind === 'number');
    check('a node update answers null when it worked', (await seam.updateNode(node.id, { name: 'wire-check-node', host: '127.0.0.1', port: 2222, username: 'nobody', privateKeyPem: null })) === null);
    const rotated = await seam.regenerateNodeKey(node.id);
    check('a new key answers a new line', typeof rotated.authorizedKeysLine === 'string' && rotated.authorizedKeysLine !== node.authorizedKeysLine, String(rotated.error));
    const test = await seam.testNode(node.id);
    check('a node test answers {ok, detail}', typeof test.ok === 'boolean' && typeof test.detail === 'string', test.detail.slice(0, 60));
    check('resetting an absent pin still lands', typeof (await seam.resetNodeHostKeyPin(node.id)) === 'boolean');
    check('the node deletes', (await seam.deleteNode(node.id)) === true);
  }

  const chan = await seam.createChannel({ kind: 1, displayName: 'wire-check-ntfy', secret: null, settings: JSON.stringify({ server: 'https://ntfy.sh', topic: 'wire-check-topic' }), enabled: false });
  check('a channel create answers null when it worked', chan === null, String(chan));
  const channel = (await seam.channels()).find(c => c.displayName === 'wire-check-ntfy');
  check('the channel lists with its settings blob', Boolean(channel) && JSON.parse(channel.settings).topic === 'wire-check-topic');
  if (channel) {
    check('a channel update answers null', (await seam.updateChannel(channel.id, { kind: 1, displayName: 'wire-check-ntfy', secret: null, settings: channel.settings, enabled: false })) === null);
    check('a channel switch answers a TextResult', (await seam.setChannelEnabled(channel.id, false)) === null);
    check('pairing a delivery-only channel is a sentence', typeof (await seam.pairChannel(channel.id, '000000')) === 'string');
    check('the channel deletes', (await seam.deleteChannel(channel.id)) === true);
  }

  const minted = await seam.mintApiKey('wire-check key');
  check('a minted key comes back once, with its summary', Boolean(minted) && minted.fullKey.startsWith('slop_') && minted.key.prefix.length > 0);
  if (minted) {
    check('the key lists by prefix only', (await seam.apiKeys()).some(k => k.id === minted.key.id && !JSON.stringify(k).includes(minted.fullKey)));
    check('the key revokes', (await seam.revokeApiKey(minted.key.id)) === true);
  }
  const pairing = await seam.startPairing();
  check('a pairing code is issued with an expiry', Boolean(pairing) && pairing.code.length > 0 && !Number.isNaN(Date.parse(pairing.expiresAt)));

  const connections = await seam.connections();
  check('connections list', Array.isArray(connections));
  check('ProviderKind is numeric on the wire', connections.length === 0 || typeof connections[0].kind === 'number');
  if (CONNECTION) {
    const models = await seam.connectionModels(CONNECTION);
    check('a connection lists its models', models.length > 0 && typeof models[0].id === 'string', JSON.stringify(models[0]));
    check('a model switch lands', (await seam.setModelEnabled(CONNECTION, models[0].id, false)) === true);
    check('the disabled list reads it back', (await seam.disabledModels(CONNECTION)).includes(models[0].id));
    check('a model switch lands again', (await seam.setModelEnabled(CONNECTION, models[0].id, true)) === true);
    check('a tier grade lands', (await seam.setModelTier(CONNECTION, models[0].id, 3)) === true);
    const tiers = await seam.connectionTiers(CONNECTION);
    check('tiers come back as a map of numbers', tiers[models[0].id] === 3, JSON.stringify(tiers));
    check('a tier clears', (await seam.setModelTier(CONNECTION, models[0].id, null)) === true);
    check('a connection switch lands', (await seam.setConnectionEnabled(CONNECTION, true)) === true);
  }
  check('git connections list', Array.isArray(await seam.gitConnections()));
  check('git apps list', Array.isArray(await seam.gitApps()));
  const codex = await seam.codexStart();
  check('a codex start answers its shape (an error is fine without the network)', 'deviceAuthId' in codex && typeof codex.interval === 'string', JSON.stringify(codex).slice(0, 80));
  check('a codex import of garbage is a sentence', typeof (await seam.codexImport('not json')) === 'string');

  if (hub) await hub.stop();

  console.log('\n--- PASS ---');
  for (const p of pass) console.log('  ✓ ' + p);
  if (fail.length) {
    console.log('\n--- FAIL ---');
    for (const f of fail) console.log('  ✗ ' + f);
  }
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
