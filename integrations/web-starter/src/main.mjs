import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { loadConfig } from './config.mjs';
import { openOrderStore } from './order-store.mjs';
import { createDemoApi } from './demo-api.mjs';
import { createPaymentApi } from './payment-api.mjs';
import { createCheckoutService } from './checkout-service.mjs';
import { createServer } from './server.mjs';

/** Read optional developer .env without installing a parser or mutating process.env. */
async function environment(cwd, env) {
  let file = {};
  try { file = parseEnv(await fs.readFile(path.join(cwd, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('STARTUP_ENV_INVALID'); }
  return { ...file, ...env };
}

/** Validate configuration, claim validated durable state, then bind loopback.
 * No network request is made by constructing either payment adapter.
 */
export async function start({ cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  const catalog = JSON.parse(await fs.readFile(path.join(cwd, 'catalog.example.json'), 'utf8'));
  const config = loadConfig(await environment(cwd, env), catalog);
  const store = await openOrderStore({ directory: config.stateDir, namespace: {
    mode: config.mode, apiOrigin: new URL(config.apiBaseUrl).origin,
    profileId: config.mode === 'demo' ? null : config.profileId,
  } });
  let server;
  try {
    const api = config.mode === 'demo' ? createDemoApi() : createPaymentApi({
      baseUrl: config.apiBaseUrl, apiKey: config.apiKey, timeoutMs: config.timeoutMs,
    });
    const service = createCheckoutService({ config, store, api });
    server = createServer({ config, service });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await store.close();
    throw error;
  }
  let closing;
  const close = () => {
    closing ??= new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      .then(() => store.close());
    return closing;
  };
  log(`OpenSwitch starter ${config.mode} ${config.localOrigin}`);
  return { server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const running = await start();
    const shutdown = async () => {
      try { await running.close(); }
      catch { console.error('OpenSwitch starter shutdown failed; inspect local state ownership.'); process.exitCode = 1; }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    // Config, filesystem and parser errors may contain private input: log no raw error.
    console.error('OpenSwitch starter startup failed; verify configuration and local state ownership.');
    process.exitCode = 1;
  }
}
