// The test server (playwright.config.ts webServer) runs the app's own Vite
// config with a dependency cache of its own, so it never re-optimises
// node_modules/.vite under the dev servers you run by hand (a different path
// spelling, an npm install or a config edit would), nor they under it.
import type { ConfigEnv, UserConfig } from 'vite';
import appConfig from '../vite.config';

export default (env: ConfigEnv): UserConfig => ({
  ...(appConfig as (env: ConfigEnv) => UserConfig)(env),
  cacheDir: 'node_modules/.vite-e2e',
});
