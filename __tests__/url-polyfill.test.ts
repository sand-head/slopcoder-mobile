/**
 * The bug that made the phone's transcript dead for three TestFlight builds.
 *
 * SignalR builds its negotiate address by mutating a `URL`:
 *
 *     negotiateUrl.pathname += "/negotiate";
 *
 * React Native's own `URL` is a hand-rolled thing whose properties are getters
 * with no setters, so that line throws `TypeError: Cannot assign to property
 * 'pathname' which has only a getter` before a single byte reaches the server.
 * The hub never connects, on any transport, and the only symptom is a banner
 * saying "Reconnecting to live updates…".
 *
 * **Nothing on a desk can see this.** Node's `URL` is spec-compliant, so
 * `wire-check.cjs` drives the real client against a real server and passes,
 * and every unit suite here passes, while the app is dead in the water. That is
 * why the test is written from both ends: what React Native provides, and what
 * the app does about it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const ENTRY = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const POLYFILL = 'react-native-url-polyfill/auto';

describe('the URL polyfill', () => {
  it('is imported before anything else the app loads', () => {
    const imports = [...ENTRY.matchAll(/^import\s.*?['"](.+?)['"];?$/gm)].map(m => m[1]);

    // First, not merely present: `App` reaches the hub through its own imports,
    // and a polyfill installed after that has already lost the race.
    expect(imports[0]).toBe(POLYFILL);
  });

  it('ships in the app, not only on this machine', () => {
    // A devDependency would pass every check here and be absent from the bundle.
    expect(PACKAGE.dependencies).toHaveProperty('react-native-url-polyfill');
    expect(PACKAGE.devDependencies ?? {}).not.toHaveProperty('react-native-url-polyfill');
  });

  it('accepts the assignment React Native refuses', () => {
    const { URL: Polyfilled } = require('react-native-url-polyfill');

    const url = new Polyfilled('https://slop.example/hubs/session');
    url.pathname += '/negotiate';

    expect(url.toString()).toBe('https://slop.example/hubs/session/negotiate');
  });

  /**
   * The canary. If this ever fails it is good news, not bad: React Native has
   * grown a `pathname` setter and the polyfill above may be droppable. Check
   * `Libraries/Blob/URL.js` before deleting anything — `search` has had a
   * setter for a while and `pathname` has not, so a partial fix is likelier
   * than a complete one.
   */
  it('is still needed, because React Native has no pathname setter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      // Deep on purpose: React Native installs this as a global rather than
      // exporting it, and under Jest the global is Node's, which would prove
      // nothing at all.
      // eslint-disable-next-line @react-native/no-deep-imports
      require('react-native/Libraries/Blob/URL').URL.prototype,
      'pathname',
    );

    expect(descriptor?.get).toBeInstanceOf(Function);
    expect(descriptor?.set).toBeUndefined();
  });
});
