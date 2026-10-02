import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openOrderStore } from '../src/order-store.mjs';

const moduleUrl = new URL('../src/order-store.mjs', import.meta.url);
const opened = new Map();
async function open(options) {
  const store = await openOrderStore(options);
  opened.get(options.directory)?.push(store);
  return store;
}
const namespace = { mode: 'sandbox', apiOrigin: 'https://api.example.test', profileId: 'test-profile' };
const order = {
  id: 'order_example', catalogId: 'sample', amount: 1700, currency: 'GBP',
  profileId: 'test-profile', paymentId: 'pay_example',
  returnUrl: 'http://127.0.0.1:4242/return', phase: 'new',
};
async function directory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openswitch-store-test-'));
  opened.set(directory, []);
  t.after(async () => {
    for (const store of opened.get(directory)) await store.close();
    opened.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

// Catches changing filesystem-root permissions or writing state there from bad configuration.
test('filesystem root is rejected before any filesystem mutation', async t => {
  let calls = 0;
  const mkdir = t.mock.method(fs, 'mkdir', async () => {
    calls++;
    throw Object.assign(new Error('filesystem must not be touched'), { code: 'EACCES' });
  });
  await assert.rejects(open({ directory: path.parse(os.tmpdir()).root, namespace }), { code: 'STORE_INVALID_CONFIGURATION' });
  mkdir.mock.restore();
  assert.equal(calls, 0);
});

// Catches lost persistence, permissive modes, and accidental mutable references.
test('orders survive close and reopen with private state permissions', async t => {
  const dir = await directory(t);
  let store = await open({ directory: dir, namespace });
  await store.save(order);
  const retrieved = await store.get(order.id);
  retrieved.amount = 1;
  assert.equal((await store.get(order.id)).amount, 1700);
  await store.close();
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(dir, 'state.json'))).mode & 0o777, 0o600);
  store = await open({ directory: dir, namespace });
  t.after(() => store.close());
  assert.deepEqual(await store.get(order.id), order);
  assert.equal(await store.get('order_absent'), undefined);
});

for (const changed of [
  { mode: 'demo', profileId: null },
  { apiOrigin: 'https://other.example.test' },
  { profileId: 'other-profile' },
]) {
  // Catches reusing payment identity in another environment or merchant profile.
  test(`state rejects namespace change ${Object.keys(changed).join(',')}`, async t => {
    const dir = await directory(t);
    const store = await open({ directory: dir, namespace });
    await store.save(order);
    await store.close();
    await assert.rejects(open({ directory: dir, namespace: { ...namespace, ...changed } }), { code: 'STORE_NAMESPACE_MISMATCH' });
    const original = await open({ directory: dir, namespace });
    t.after(() => original.close());
    assert.equal((await original.get(order.id)).paymentId, 'pay_example');
  });
}

// Catches lock acquisition races across independent processes, not just objects.
test('another process cannot own an active state directory', async t => {
  const dir = await directory(t);
  const store = await open({ directory: dir, namespace });
  t.after(() => store.close());
  assert.equal((await fs.stat(path.join(dir, '.lock'))).mode & 0o777, 0o600);
  const source = `import {openOrderStore} from ${JSON.stringify(moduleUrl.href)};
    try { const store = await openOrderStore({directory:process.argv[1],namespace:JSON.parse(process.argv[2])}); await store.close(); process.exitCode=2; }
    catch(error) { process.stdout.write(error.code ?? 'UNKNOWN'); }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, dir, JSON.stringify(namespace)]);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0);
  assert.equal(output, 'STORE_LOCKED');
});

// Catches unsafe automatic stale-lock removal.
test('a stale lock fails closed with a manual recovery procedure', async t => {
  const dir = await directory(t);
  const canary = '{"pid":999999999,"token":"stale-test-lock"}';
  await fs.writeFile(path.join(dir, '.lock'), canary);
  await assert.rejects(open({ directory: dir, namespace }), error => {
    assert.equal(error.code, 'STORE_LOCKED');
    assert.match(error.message, /stopped/iu);
    assert.match(error.message, /backup/iu);
    assert.match(error.message, /manually/iu);
    return true;
  });
  assert.equal(await fs.readFile(path.join(dir, '.lock'), 'utf8'), canary);
});

// Catches truncated/corrupt state being silently replaced by an empty database.
test('corrupt state is rejected at startup and during reads', async t => {
  const dir = await directory(t);
  const store = await open({ directory: dir, namespace });
  await store.save(order);
  await fs.writeFile(path.join(dir, 'state.json'), '{broken');
  await assert.rejects(store.get(order.id), { code: 'STORE_CORRUPT' });
  await store.close();
  await assert.rejects(open({ directory: dir, namespace }), { code: 'STORE_CORRUPT' });
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), '{broken');
});

// Catches a valid JSON envelope containing an invalid order leaking an unchecked exception.
test('null order records are rejected as corrupt durable state', async t => {
  const dir = await directory(t);
  const store = await open({ directory: dir, namespace });
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ version: 1, namespace, orders: { order_example: null } }));
  await assert.rejects(store.get('order_example'), { code: 'STORE_CORRUPT' });
  await store.close();
  await assert.rejects(open({ directory: dir, namespace }), { code: 'STORE_CORRUPT' });
});

// Catches trusting a persisted paid phase without the exact successful payment status.
test('a paid phase without succeeded status is corrupt', async t => {
  const dir = await directory(t);
  const store = await open({ directory: dir, namespace });
  await store.save(order);
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ version: 1, namespace, orders: { order_example: { ...order, phase: 'paid', paymentStatus: 'requires_capture' } } }));
  await assert.rejects(store.get(order.id), { code: 'STORE_CORRUPT' });
});

// Catches rename failure committing an unpersisted in-memory update.
test('an atomic rename failure leaves the last persisted order recoverable', async t => {
  const dir = await directory(t);
  const store = await open({ directory: dir, namespace });
  t.after(() => store.close());
  await store.save(order);
  const before = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
  // Inject a syscall failure only; temp-file writes, fsync and cleanup stay real.
  const rename = t.mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('injected rename failure'), { code: 'EACCES' });
  });
  await assert.rejects(store.save({ ...order, phase: 'creating' }), { code: 'STORE_WRITE_FAILED' });
  rename.mock.restore();
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), before);
  assert.equal((await store.get(order.id)).phase, 'new');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['.lock', 'state.json']);
});

// Catches writes of sensitive fields and mutation of an established financial identity.
test('the store rejects secrets and changed order identity', async t => {
  const dir = await directory(t);
  const store = await open({ directory: dir, namespace });
  t.after(() => store.close());
  await store.save(order);
  await assert.rejects(store.save({ ...order, clientSecret: 'dummy-client-secret' }), { code: 'STORE_INVALID_ORDER' });
  await assert.rejects(store.save({ ...order, paymentId: 'replacement-payment' }), { code: 'STORE_ORDER_CONFLICT' });
  assert.equal((await fs.readFile(path.join(dir, 'state.json'), 'utf8')).includes('dummy-client-secret'), false);
});

// Catches state/lock paths following links outside the private directory.
test('state directory and state file symlinks fail closed', async t => {
  const dir = await directory(t);
  const linkedDir = path.join(dir, 'linked');
  await fs.symlink(dir, linkedDir);
  await assert.rejects(open({ directory: linkedDir, namespace }), { code: 'STORE_UNSAFE_PATH' });
  const stateDir = path.join(dir, 'private');
  await fs.mkdir(stateDir);
  await fs.writeFile(path.join(dir, 'external'), 'canary');
  await fs.symlink(path.join(dir, 'external'), path.join(stateDir, 'state.json'));
  await assert.rejects(open({ directory: stateDir, namespace }), { code: 'STORE_CORRUPT' });
  assert.equal(await fs.readFile(path.join(dir, 'external'), 'utf8'), 'canary');
});
