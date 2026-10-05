import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';

const catalog = [
  { id: 'demo-usd', label: 'Simulated USD item', amount: 1250, currency: 'USD' },
  { id: 'demo-gbp', label: 'Simulated GBP item', amount: 900, currency: 'GBP' },
];
const sourceDir = fileURLToPath(new URL('..', import.meta.url));
const sandboxEnv = {
  MODE: 'sandbox',
  API_KEY: 'dummy-api-key',
  PUBLISHABLE_KEY: 'dummy-publishable-key',
  PROFILE_ID: 'dummy-profile',
  SANDBOX_CONFIRMED: 'yes',
  STATE_DIR: path.join(os.tmpdir(), 'openswitch-config-test-state'),
};
const configModule = () => import('../src/config.mjs');

// Wrong defaults would enable a financial mode or make loopback startup unusable.
test('defaults to an offline demo with derived loopback return and external state', async () => {
  const { loadConfig } = await configModule();
  const config = loadConfig({}, catalog);
  assert.equal(config.mode, 'demo');
  assert.equal(config.port, 4242);
  assert.equal(config.localOrigin, 'http://127.0.0.1:4242');
  assert.equal(config.returnUrl, 'http://127.0.0.1:4242/return');
  assert.equal(config.apiBaseUrl, 'https://api.openswitch.io');
  assert.equal(config.sdkUrl, 'https://sdk.openswitch.io/HyperLoader.js');
  assert.equal(config.timeoutMs, 10_000);
  assert.ok(path.isAbsolute(config.stateDir));
  assert.ok(config.stateDir.startsWith(path.resolve(realpathSync(os.tmpdir())) + path.sep));
  assert.equal(config.apiKey, undefined);
});

// Removing any deliberate sandbox gate must make its corresponding case fail.
for (const [name, env] of [
  ['live mode', { MODE: 'live' }],
  ['unknown mode', { MODE: 'mock' }],
  ['sandbox without configuration', { MODE: 'sandbox' }],
  ...['API_KEY', 'PUBLISHABLE_KEY', 'PROFILE_ID', 'SANDBOX_CONFIRMED', 'STATE_DIR'].map(
    key => [`sandbox without ${key}`, { ...sandboxEnv, [key]: '' }],
  ),
  ['sandbox without literal administrator confirmation', { ...sandboxEnv, SANDBOX_CONFIRMED: 'true' }],
  ['blank API credential', { ...sandboxEnv, API_KEY: '   ' }],
]) {
  test(`rejects ${name}`, async () => {
    const { loadConfig } = await configModule();
    assert.throws(() => loadConfig(env, catalog));
  });
}

test('accepts explicitly confirmed sandbox overrides', async () => {
  const { loadConfig } = await configModule();
  const config = loadConfig({
    ...sandboxEnv,
    PORT: '5050',
    LOCAL_ORIGIN: 'http://127.0.0.1:5050',
    API_BASE_URL: 'https://sandbox-api.example.test/',
    SDK_URL: 'https://sandbox-sdk.example.test/HyperLoader.js',
  }, catalog);
  assert.equal(config.mode, 'sandbox');
  assert.equal(config.port, 5050);
  assert.equal(config.apiBaseUrl, 'https://sandbox-api.example.test');
  assert.equal(config.sdkUrl, 'https://sandbox-sdk.example.test/HyperLoader.js');
  assert.equal(config.returnUrl, 'http://127.0.0.1:5050/return');
  assert.equal(config.apiKey, 'dummy-api-key');
  assert.equal(config.profileId, 'dummy-profile');
});

// A denylist or spreading internal config would leak new private fields.
test('public configuration contains only the browser allowlist', async () => {
  const { loadConfig, publicConfig } = await configModule();
  const validConfig = loadConfig(sandboxEnv, catalog);
  const visible = publicConfig({ ...validConfig, clientSecret: 'dummy-client-secret', futureSecret: 'dummy-future-secret' });
  assert.equal('apiKey' in visible, false);
  assert.deepEqual(Object.keys(visible).sort(), ['apiBaseUrl', 'catalog', 'localOrigin', 'mode', 'publishableKey', 'sdkUrl']);
  assert.equal(visible.publishableKey, 'dummy-publishable-key');
  assert.equal(JSON.stringify(visible).includes('dummy-api-key'), false);
  assert.equal(JSON.stringify(visible).includes('dummy-client-secret'), false);
  assert.equal(JSON.stringify(visible).includes('dummy-future-secret'), false);
  assert.deepEqual(visible.catalog, catalog);
});

// These URL forms could change the credential destination or bypass local redirects.
for (const variable of ['API_BASE_URL', 'SDK_URL']) {
  for (const value of [
    'http://api.example.test',
    'https://user:pass@api.openswitch.io',
    'https://api.example.test?token=dummy',
    'https://api.example.test#fragment',
    'https://api.example.test?',
    'https://api.example.test#',
    'not-a-url',
    ' https://api.example.test',
  ]) {
    test(`rejects unsafe ${variable}: ${value}`, async () => {
      const { loadConfig } = await configModule();
      assert.throws(() => loadConfig({ ...sandboxEnv, [variable]: value }, catalog));
    });
  }
}

test('rejects an API base containing a path', async () => {
  const { loadConfig } = await configModule();
  assert.throws(() => loadConfig({ ...sandboxEnv, API_BASE_URL: 'https://api.example.test/elsewhere' }, catalog));
});

for (const value of ['0', '-1', '65536', '4.5', '4242junk', 'Infinity', '', ' 4242']) {
  test(`rejects invalid port ${JSON.stringify(value)}`, async () => {
    const { loadConfig } = await configModule();
    assert.throws(() => loadConfig({ PORT: value }, catalog));
  });
}

for (const value of [
  'https://127.0.0.1:4242', 'http://localhost:4242', 'http://example.test:4242',
  'http://127.0.0.1:5050', 'http://127.0.0.1:4242/path',
  'http://user:pass@127.0.0.1:4242', 'http://127.0.0.1:4242?x=y',
]) {
  test(`rejects an unsafe or mismatched local origin ${value}`, async () => {
    const { loadConfig } = await configModule();
    assert.throws(() => loadConfig({ LOCAL_ORIGIN: value }, catalog));
  });
}

test('rejects arbitrary return URL configuration', async () => {
  const { loadConfig } = await configModule();
  assert.throws(() => loadConfig({ RETURN_URL: 'https://attacker.example.test' }, catalog));
});

// Disabling amount/currency validation would accept tampered server-owned products.
for (const [name, item] of [
  ['zero amount', { ...catalog[0], amount: 0 }],
  ['negative amount', { ...catalog[0], amount: -1 }],
  ['unsafe amount', { ...catalog[0], amount: Number.MAX_SAFE_INTEGER + 1 }],
  ['fractional amount', { ...catalog[0], amount: 1.5 }],
  ['string amount', { ...catalog[0], amount: '1250' }],
  ['nonfinite amount', { ...catalog[0], amount: Infinity }],
  ['lowercase currency', { ...catalog[0], currency: 'usd' }],
  ['short currency', { ...catalog[0], currency: 'US' }],
  ['invalid currency', { ...catalog[0], currency: '12$' }],
  ['missing label', { ...catalog[0], label: '' }],
  ['invalid ID', { ...catalog[0], id: '../item' }],
]) {
  test(`rejects catalog ${name}`, async () => {
    const { loadConfig } = await configModule();
    assert.throws(() => loadConfig({}, [item]));
  });
}

test('rejects duplicate catalog IDs', async () => {
  const { loadConfig } = await configModule();
  assert.throws(() => loadConfig({}, [catalog[0], { ...catalog[1], id: catalog[0].id }]));
});

test('rejects missing or empty catalogs', async () => {
  const { loadConfig } = await configModule();
  for (const value of [undefined, null, {}, []]) assert.throws(() => loadConfig({}, value));
});

test('catalog sanitization drops unknown properties and isolates caller mutation', async () => {
  const { loadConfig } = await configModule();
  const input = [{ ...catalog[0], privateMetadata: 'dummy-secret' }];
  const config = loadConfig({}, input);
  input[0].amount = 1;
  assert.deepEqual(config.catalog, [catalog[0]]);
});

for (const value of [sourceDir, path.join(sourceDir, 'state'), 'relative/state']) {
  test(`rejects state path inside source or without an absolute path: ${value}`, async () => {
    const { loadConfig } = await configModule();
    assert.throws(() => loadConfig({ ...sandboxEnv, STATE_DIR: value }, catalog));
  });
}

test('rejects a state symlink resolving inside packaged source', async () => {
  const { loadConfig } = await configModule();
  const temp = mkdtempSync(path.join(os.tmpdir(), 'openswitch-config-symlink-'));
  try {
    symlinkSync(sourceDir, path.join(temp, 'source'), 'dir');
    assert.throws(() => loadConfig({ ...sandboxEnv, STATE_DIR: path.join(temp, 'source', 'state') }, catalog));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('configuration errors omit rejected credentials and URL secrets', async () => {
  const { loadConfig } = await configModule();
  assert.throws(
    () => loadConfig({ ...sandboxEnv, API_BASE_URL: 'https://user:dummy-url-secret@api.example.test' }, catalog),
    error => !String(error).includes('dummy-url-secret') && !String(error).includes('dummy-api-key'),
  );
});
