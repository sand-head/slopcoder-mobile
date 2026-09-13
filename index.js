/**
 * First import wins, and this one has to be first.
 *
 * React Native ships a hand-rolled `URL` whose properties are getters with no
 * setters (`Libraries/Blob/URL.js` — only `search` can be assigned). SignalR
 * builds its negotiate address by mutating one:
 *
 *     negotiateUrl.pathname += "/negotiate";   // HttpConnection.js
 *
 * which on a phone throws `TypeError: Cannot assign to property 'pathname'
 * which has only a getter` before a single byte is sent. The hub then never
 * connects, on any transport, and the app sits behind "Reconnecting to live
 * updates…" forever. Node's `URL` is spec-compliant, so `scripts/wire-check.cjs`
 * and every unit test pass while the app is dead in the water — this cost three
 * TestFlight builds to find.
 *
 * `react-native-url-polyfill` replaces the global with a real one. It is pure
 * JavaScript: no pods, no Gradle, nothing for CI to link.
 */
import 'react-native-url-polyfill/auto';

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
