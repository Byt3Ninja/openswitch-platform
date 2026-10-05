import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { openOrderStore } from '../src/order-store.mjs';
import { createCheckoutService } from '../src/checkout-service.mjs';
import { createDemoApi } from '../src/demo-api.mjs';

const catalog = [{ id: 'sample', label: 'Simulated sample', amount: 1700, currency: 'GBP' }];
const apiSecret = 'dummy-private-api-key';
const profileSecret = 'dummy-private-profile';
const rawSecret = 'dummy-untrusted-error-secret';
const mainPath = fileURLToPath(new URL('../src/main.mjs', import.meta.url));
const cleanups = new WeakMap();
function cleanup(t, callback) { cleanups.get(t).push(callback); }

async function availablePort() {
  const socket = http.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function directory(t) {
  const result = await fs.mkdtemp(path.join(os.tmpdir(), 'openswitch-http-test-'));
  if (!cleanups.has(t)) {
    cleanups.set(t, []);
    t.after(async () => {
      for (const callback of cleanups.get(t).toReversed()) await callback();
    });
  }
  cleanup(t, () => fs.rm(result, { recursive: true, force: true }));
  return result;
}
function request(origin, route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(origin);
    const req = http.request({ hostname: target.hostname, port: target.port, path: route, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text,
          json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
async function fixture(t, { mode = 'demo', service: suppliedService } = {}) {
  const root = await directory(t);
  const port = await availablePort();
  const config = loadConfig({ MODE: mode, PORT: String(port), STATE_DIR: path.join(root, 'state'),
    API_KEY: apiSecret, PROFILE_ID: profileSecret, PUBLISHABLE_KEY: 'dummy-public-key',
    API_BASE_URL: 'https://api.example.test', SDK_URL: 'https://sdk.example.test/HyperLoader.js',
    SANDBOX_CONFIRMED: 'yes' }, catalog);
  const staticDir = path.join(root, 'public');
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><p>Fixture application</p>');
  await fs.writeFile(path.join(staticDir, 'checkout.mjs'), 'export const fixture = true;');
  await fs.writeFile(path.join(staticDir, 'checkout-controller.mjs'), 'export const controller = true;');
  await fs.writeFile(path.join(staticDir, 'styles.css'), 'body { color: black; }');
  await fs.writeFile(path.join(staticDir, '.env'), apiSecret);
  await fs.writeFile(path.join(staticDir, 'state.json'), profileSecret);
  const store = await openOrderStore({ directory: config.stateDir, namespace: {
    mode, apiOrigin: config.apiBaseUrl, profileId: mode === 'demo' ? null : config.profileId,
  } });
  cleanup(t, () => store.close());
  let created;
  const api = mode === 'demo' ? createDemoApi() : {
    async create(order) { created = order; return { paymentId: order.paymentId, profileId: order.profileId,
      amount: order.amount, currency: order.currency, status: 'requires_payment_method', clientSecret: 'dummy-client-secret' }; },
    async retrieve() { return { paymentId: created.paymentId, profileId: created.profileId, amount: created.amount,
      currency: created.currency, status: 'requires_payment_method', clientSecret: 'dummy-client-secret' }; },
  };
  const service = suppliedService ?? createCheckoutService({ config, store, api });
  const { createServer } = await import('../src/server.mjs');
  const server = createServer({ config, service, staticDir });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  cleanup(t, async () => {
    await new Promise(resolve => server.close(resolve));
  });
  const get = route => request(config.localOrigin, route);
  const initial = await get('/api/config');
  const token = initial.status === 200 ? initial.json().csrfToken : undefined;
  const post = (route, body, changes = {}) => request(config.localOrigin, route, { method: 'POST',
    headers: { origin: config.localOrigin, 'x-csrf-token': token ?? 'absent', 'content-type': 'application/json', ...changes },
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  return { config, staticDir, root, server, get, post, token };
}

// Catches exposing internal configuration or skipping per-process CSRF bootstrap.
test('same-origin config exposes only public fields and an unpredictable process token', async t => {
  const f = await fixture(t);
  const response = await f.get('/api/config');
  assert.equal(response.status, 200);
  const body = response.json();
  assert.deepEqual(Object.keys(body).sort(), ['apiBaseUrl', 'catalog', 'csrfToken', 'localOrigin', 'mode', 'publishableKey', 'sdkUrl']);
  assert.match(body.csrfToken, /^[a-f0-9]{64}$/u);
  assert.equal(body.csrfToken, f.token);
  for (const secret of [apiSecret, profileSecret, f.config.stateDir]) assert.equal(response.text.includes(secret), false);
  const other = await fixture(t);
  assert.notEqual(other.token, f.token);
});

// Catches trusting client totals, redirects, or SDK outcomes instead of persisted server state.
test('real demo order transitions use catalog terms and ignore return query payment claims', async t => {
  const f = await fixture(t);
  const created = await f.post('/api/orders', { catalogId: 'sample' });
  assert.equal(created.status, 201);
  const order = created.json();
  assert.equal(order.amount, 1700);
  assert.equal(order.currency, 'GBP');
  assert.equal(order.status, 'not_created');
  assert.equal(order.simulated, true);
  const started = await f.post(`/api/orders/${order.id}/checkout`, {});
  assert.equal(started.status, 200);
  assert.equal(started.json().status, 'requires_payment_method');
  const returned = await f.get(`/return?order=${order.id}&status=succeeded&client_secret=${rawSecret}`);
  assert.equal(returned.status, 200);
  assert.equal(returned.text, '<!doctype html><p>Fixture application</p>');
  assert.equal((await f.get(`/api/orders/${order.id}`)).json().phase, 'ready');
  const completed = await f.post(`/api/orders/${order.id}/demo-result`, { outcome: 'succeeded' });
  assert.equal(completed.status, 200);
  assert.equal(completed.json().phase, 'paid');
  assert.equal((await f.get(`/api/orders/${order.id}`)).json().simulated, true);
});

// Catches the provider landing being rejected before safe browser recovery runs.
test('provider-style return navigation serves only the shell without trusting queries', async t => {
  let calls = 0;
  const service = Object.fromEntries(['newOrder', 'start', 'status', 'completeDemo'].map(name => [name, async () => { calls++; }]));
  const f = await fixture(t, { service });
  const headers = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  const response = await request(f.config.localOrigin, `/return?status=succeeded&client_secret=${rawSecret}`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.text, '<!doctype html><p>Fixture application</p>');
  assert.equal(response.text.includes(rawSecret), false);
  assert.equal(calls, 0);
});

test('return navigation exception cannot reach APIs, subresources or mutations', async t => {
  const f = await fixture(t);
  const navigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  for (const route of ['/', '/return/', '/%72eturn', '/api/config', '/api/orders/order_one', '/checkout.mjs', '/favicon.ico']) {
    assert.equal((await request(f.config.localOrigin, route, { headers: navigation })).status, 403, route);
  }
  for (const headers of [
    { host: 'attacker.example' }, { origin: 'https://attacker.example' }, { origin: 'null' },
    { 'sec-fetch-mode': 'cors' }, { 'sec-fetch-mode': 'no-cors' }, { 'sec-fetch-mode': undefined },
    { 'sec-fetch-dest': 'iframe' }, { 'sec-fetch-dest': 'script' }, { 'sec-fetch-dest': undefined },
    { 'sec-fetch-site': 'same-site' },
  ]) {
    const combined = { ...navigation, ...headers };
    for (const key of Object.keys(combined)) if (combined[key] === undefined) delete combined[key];
    assert.equal((await request(f.config.localOrigin, '/return', { headers: combined })).status, 403);
  }
  for (const method of ['HEAD', 'POST', 'PUT', 'OPTIONS']) {
    assert.equal((await request(f.config.localOrigin, '/return', { method, headers: {
      ...navigation, origin: f.config.localOrigin, 'x-csrf-token': f.token,
    } })).status, 403, method);
  }
  assert.equal((await f.post('/api/orders', { catalogId: 'sample' }, navigation)).status, 403);
});

test('automatic favicon request is handled with unchanged same-origin security headers', async t => {
  const f = await fixture(t);
  const response = await f.get('/favicon.ico');
  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.match(response.headers['content-security-policy'], /img-src 'self';/u);
  assert.match(response.headers['content-security-policy'], /default-src 'none';/u);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal((await request(f.config.localOrigin, '/favicon.ico', { headers: { host: 'attacker.example' } })).status, 403);
  assert.equal((await f.get('/favicon.ico/../state.json')).status, 404);
});

// Catches sandbox exposing simulation or secrets on general order/status routes.
test('sandbox exposes a client secret only at checkout and has no demo-result route', async t => {
  const f = await fixture(t, { mode: 'sandbox' });
  const order = (await f.post('/api/orders', { catalogId: 'sample' })).json();
  assert.equal('clientSecret' in order, false);
  const checkout = await f.post(`/api/orders/${order.id}/checkout`, {});
  assert.equal(checkout.json().clientSecret, 'dummy-client-secret');
  assert.equal(checkout.json().simulated, false);
  const status = await f.get(`/api/orders/${order.id}`);
  assert.equal(status.text.includes('dummy-client-secret'), false);
  assert.equal((await f.post(`/api/orders/${order.id}/demo-result`, { outcome: 'succeeded' })).status, 404);
});

for (const [name, headers] of [
  ['foreign Host', { host: 'attacker.example' }],
  ['alternate loopback Host', { host: 'localhost:4242' }],
  ['cross-origin', { origin: 'https://attacker.example' }],
  ['null Origin', { origin: 'null' }],
  ['missing Origin', { origin: undefined }],
  ['wrong CSRF', { 'x-csrf-token': 'not-the-token' }],
  ['missing CSRF', { 'x-csrf-token': undefined }],
  ['cross-site Fetch Metadata', { 'sec-fetch-site': 'cross-site' }],
  ['same-site Fetch Metadata', { 'sec-fetch-site': 'same-site' }],
]) {
  // Catches a specific missing local authorization check before creating a durable order.
  test(`mutation rejects ${name}`, async t => {
    const f = await fixture(t);
    const combined = { origin: f.config.localOrigin, 'content-type': 'application/json', 'x-csrf-token': f.token, ...headers };
    for (const key of Object.keys(combined)) if (combined[key] === undefined) delete combined[key];
    const result = await request(f.config.localOrigin, '/api/orders', { method: 'POST', headers: combined,
      body: JSON.stringify({ catalogId: 'sample' }) });
    assert.equal(result.status, 403);
    const state = JSON.parse(await fs.readFile(path.join(f.config.stateDir, 'state.json'), 'utf8'));
    assert.deepEqual(state.orders, {});
  });
}

// Catches CSRF bootstrap reachable under attacker Origin, DNS rebinding, or cross-site metadata.
test('config refuses foreign Host, Origin and Fetch Metadata without releasing the token', async t => {
  const f = await fixture(t);
  for (const headers of [{ host: 'attacker.example' }, { origin: 'https://attacker.example' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    const response = await request(f.config.localOrigin, '/api/config', { headers });
    assert.equal(response.status, 403);
    assert.equal(response.text.includes(f.token), false);
  }
});

for (const [name, body, headers, status] of [
  ['unexpected total', { catalogId: 'sample', amount: 1 }, {}, 400],
  ['missing catalog', {}, {}, 400],
  ['non-string catalog', { catalogId: 1 }, {}, 400],
  ['unknown catalog', { catalogId: 'missing' }, {}, 400],
  ['array', [], {}, 400],
  ['null', 'null', {}, 400],
  ['invalid JSON', '{', {}, 400],
  ['invalid UTF-8', Buffer.from([0xff]), {}, 400],
  ['oversized JSON', ' '.repeat(16 * 1024 + 1), {}, 413],
  ['form content type', { catalogId: 'sample' }, { 'content-type': 'application/x-www-form-urlencoded' }, 415],
]) {
  // Catches a specific malformed input reaching checkout state or overflowing the HTTP body bound.
  test(`order body rejects ${name}`, async t => {
    const f = await fixture(t);
    assert.equal((await f.post('/api/orders', body, headers)).status, status);
  });
}

// Catches permissive checkout/demo bodies and loss of service errors in HTTP translation.
test('strict checkout and completion bodies preserve safe HTTP service statuses', async t => {
  const f = await fixture(t);
  const order = (await f.post('/api/orders', { catalogId: 'sample' })).json();
  assert.equal((await f.post(`/api/orders/${order.id}/checkout`, { paid: true })).status, 400);
  assert.equal((await f.post(`/api/orders/${order.id}/demo-result`, { outcome: 'succeeded' })).status, 409);
  assert.equal((await f.get('/api/orders/missing')).status, 404);
  assert.equal((await f.post(`/api/orders/${order.id}/checkout`, {})).status, 200);
  assert.equal((await f.post(`/api/orders/${order.id}/demo-result`, { outcome: 'paid' })).status, 400);
  assert.equal((await f.post(`/api/orders/${order.id}/demo-result`, { outcome: 'failed', paid: true })).status, 400);
  assert.equal((await f.post(`/api/orders/${order.id}/demo-result`, { outcome: 'cancelled' })).json().phase, 'failed');
});

// Catches checking only Content-Length while allowing an oversized streamed body.
test('chunked request bodies enforce the same 16 KiB bound and permit its exact edge', async t => {
  const f = await fixture(t);
  const value = JSON.stringify({ catalogId: 'sample' });
  const allowed = value + ' '.repeat(16 * 1024 - Buffer.byteLength(value));
  assert.equal((await f.post('/api/orders', allowed, { 'transfer-encoding': 'chunked' })).status, 201);
  assert.equal((await f.post('/api/orders', `${allowed} `, { 'transfer-encoding': 'chunked' })).status, 413);
});

// Catches filesystem discovery, traversal normalization, or accidentally accepting webhooks.
test('only fixed application assets are served and unknown paths never touch files', async t => {
  const f = await fixture(t);
  const read = t.mock.method(fs, 'open', async () => { throw new Error('unexpected filesystem read'); });
  try {
    for (const route of ['/.env', '/state.json', '/state/state.json', '/public/', '/../index.html',
      '/%2e%2e/index.html', '/%2eenv', '/checkout.mjs/../index.html', '/checkout.mjs%00',
      '/public\\index.html', '/unknown', '/webhooks']) {
      const response = await f.get(route);
      assert.equal(response.status, 404, route);
      assert.equal(response.text.includes(apiSecret), false);
      assert.equal(response.text.includes(profileSecret), false);
    }
    assert.equal((await f.post('/webhooks', {})).status, 404);
    assert.equal(read.mock.callCount(), 0);
  } finally { read.mock.restore(); }
  for (const [route, type] of [['/', 'text/html'], ['/checkout.mjs', 'text/javascript'],
    ['/checkout-controller.mjs', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const response = await f.get(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers['content-type'], new RegExp(`^${type}`));
  }
});

// Catches reading a sensitive symlink target even when its filename is allowed.
test('allowed static filenames reject symlinks before any file open', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.staticDir, 'checkout.mjs'));
  await fs.symlink(path.join(f.staticDir, '.env'), path.join(f.staticDir, 'checkout.mjs'));
  const read = t.mock.method(fs, 'open', async () => { throw new Error('unexpected filesystem read'); });
  try {
    const response = await f.get('/checkout.mjs');
    assert.equal(response.status, 404);
    assert.equal(response.text.includes(apiSecret), false);
    assert.equal(read.mock.callCount(), 0);
  } finally { read.mock.restore(); }
});

// Catches following an allowlisted filename through a symlinked public directory.
test('a symlinked static root is rejected before opening the application', async t => {
  const f = await fixture(t);
  await fs.rename(f.staticDir, path.join(f.root, 'moved-public'));
  await fs.symlink(path.join(f.root, 'moved-public'), f.staticDir);
  const read = t.mock.method(fs, 'open', async () => { throw new Error('unexpected filesystem read'); });
  try {
    const response = await f.get('/');
    assert.equal(response.status, 404);
    assert.equal(read.mock.callCount(), 0);
  } finally { read.mock.restore(); }
});

// Catches reflecting raw exception messages or unrecognized error codes to the browser.
test('HTTP errors never expose raw secrets or provider exception codes', async t => {
  const f = await fixture(t, { service: { async newOrder() {
    throw Object.assign(new Error(rawSecret), { code: rawSecret });
  } } });
  const response = await f.post('/api/orders', { catalogId: 'sample' });
  assert.equal(response.status, 500);
  assert.deepEqual(response.json(), { error: 'INTERNAL_ERROR' });
  for (const secret of [apiSecret, profileSecret, rawSecret]) assert.equal(response.text.includes(secret), false);
});

for (const mode of ['demo', 'sandbox']) {
  // Catches unsafe inline/wildcard CSP or missing no-cache/no-sniff protections including failures.
  test(`${mode} response headers allow only the configured execution origins`, async t => {
    const f = await fixture(t, { mode });
    for (const route of ['/', '/api/config', '/unknown']) {
      const response = await f.get(route);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.equal(response.headers['x-frame-options'], 'DENY');
      const csp = response.headers['content-security-policy'];
      assert.match(csp, /default-src 'none'/u);
      assert.match(csp, /style-src 'self'/u);
      assert.match(csp, /frame-ancestors 'none'/u);
      assert.equal(/unsafe-inline|unsafe-eval|\*|data:/u.test(csp), false);
      if (mode === 'demo') {
        assert.match(csp, /script-src 'self';/u);
        assert.match(csp, /connect-src 'self';/u);
        assert.equal(csp.includes('https://'), false);
      } else {
        assert.match(csp, /script-src 'self' https:\/\/sdk\.example\.test;/u);
        assert.match(csp, /connect-src 'self' https:\/\/api\.example\.test;/u);
      }
    }
  });
}

async function startupFixture(t, overrides = {}) {
  const root = await directory(t);
  const port = await availablePort();
  await fs.writeFile(path.join(root, 'catalog.example.json'), JSON.stringify(catalog));
  const env = { MODE: 'demo', PORT: String(port), STATE_DIR: path.join(root, 'state'), ...overrides };
  return { root, port, env };
}

// Catches default startup requiring .env, loading a remote provider in demo, or binding globally.
test('main starts demo without optional .env and binds exclusively to IPv4 loopback', async t => {
  const f = await startupFixture(t);
  const { start } = await import('../src/main.mjs');
  const logs = [];
  const running = await start({ cwd: f.root, env: f.env, log: message => logs.push(message) });
  cleanup(t, () => running.close());
  assert.equal(running.server.address().address, '127.0.0.1');
  assert.equal(running.server.address().port, f.port);
  assert.deepEqual(logs, [`OpenSwitch starter demo http://127.0.0.1:${f.port}`]);
  assert.equal((await request(`http://127.0.0.1:${f.port}`, '/api/config')).json().mode, 'demo');
});

// Catches incorrect .env precedence/parsing or deriving browser-visible values from private secrets.
test('main parses optional .env with Node semantics and environment overrides file values', async t => {
  const f = await startupFixture(t);
  await fs.writeFile(path.join(f.root, '.env'), `MODE=demo\nPORT=1\nAPI_KEY="${apiSecret}#literal"\nPROFILE_ID=${profileSecret}\n`);
  const { start } = await import('../src/main.mjs');
  const logs = [];
  const running = await start({ cwd: f.root, env: f.env, log: value => logs.push(value) });
  cleanup(t, () => running.close());
  assert.equal(running.server.address().port, f.port);
  const response = await request(`http://127.0.0.1:${f.port}`, '/api/config');
  assert.equal(response.text.includes(apiSecret), false);
  assert.equal(logs.join('').includes(profileSecret), false);
});

// Catches starting sandbox before checking deliberate configuration and durable store ownership.
test('startup rejects invalid sandbox, occupied or corrupt state before listening', async t => {
  const { start } = await import('../src/main.mjs');
  const invalid = await startupFixture(t, { MODE: 'sandbox', API_KEY: apiSecret });
  await assert.rejects(start({ cwd: invalid.root, env: invalid.env, log() {} }));
  const f = await startupFixture(t, { MODE: 'sandbox', API_KEY: apiSecret, PUBLISHABLE_KEY: 'dummy-public-key',
    PROFILE_ID: profileSecret, SANDBOX_CONFIRMED: 'yes' });
  const config = loadConfig(f.env, catalog);
  const store = await openOrderStore({ directory: config.stateDir, namespace: {
    mode: 'sandbox', apiOrigin: config.apiBaseUrl, profileId: profileSecret,
  } });
  await assert.rejects(start({ cwd: f.root, env: f.env, log() {} }), { code: 'STORE_LOCKED' });
  await store.close();
  await fs.writeFile(path.join(config.stateDir, 'state.json'), '{ corrupt');
  await assert.rejects(start({ cwd: f.root, env: f.env, log() {} }), { code: 'STORE_CORRUPT' });
  await assert.rejects(request(config.localOrigin, '/api/config'), { code: 'ECONNREFUSED' });
});

// Catches an unsuccessful listen leaving the durable state lock held.
test('failed loopback bind releases its state lock', async t => {
  const f = await startupFixture(t);
  const occupying = http.createServer();
  await new Promise(resolve => occupying.listen(f.port, '127.0.0.1', resolve));
  cleanup(t, () => new Promise(resolve => occupying.close(resolve)));
  const { start } = await import('../src/main.mjs');
  await assert.rejects(start({ cwd: f.root, env: f.env, log() {} }), { code: 'EADDRINUSE' });
  await assert.rejects(fs.stat(path.join(f.env.STATE_DIR, '.lock')), { code: 'ENOENT' });
});

// Catches CLI startup printing a secret-bearing parsing error instead of a redacted failure.
test('CLI rejects invalid startup without exposing secrets in stdout or stderr', async t => {
  const f = await startupFixture(t, { MODE: rawSecret });
  const child = spawn(process.execPath, [mainPath], { cwd: f.root, env: { ...process.env, ...f.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exit = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(exit, 1);
  assert.match(output, /startup failed/iu);
  assert.equal(output.includes(rawSecret), false);
});

// Catches npm's real entry point requiring .env or leaving state occupied after a normal signal.
test('CLI demo startup without .env and graceful termination release state ownership', { timeout: 5000 }, async t => {
  const f = await startupFixture(t);
  const child = spawn(process.execPath, [mainPath], { cwd: f.root, env: { ...process.env, ...f.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup(t, () => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let output = '';
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('CLI exited before listening')));
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes(`http://127.0.0.1:${f.port}`)) resolve();
    });
  });
  assert.equal((await request(`http://127.0.0.1:${f.port}`, '/api/config')).json().mode, 'demo');
  child.kill('SIGTERM');
  assert.deepEqual(await exit, { code: 0, signal: null });
  assert.equal(errors, '');
  await assert.rejects(fs.stat(path.join(f.env.STATE_DIR, '.lock')), { code: 'ENOENT' });
});
