import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDemoApi } from '../src/demo-api.mjs';
import { openOrderStore } from '../src/order-store.mjs';
import { createCheckoutService } from '../src/checkout-service.mjs';

const catalog = [
  { id: 'sample', label: 'Simulated sample', amount: 1700, currency: 'GBP' },
  { id: 'second', label: 'Another simulation', amount: 2900, currency: 'USD' },
];
const config = {
  mode: 'sandbox', apiBaseUrl: 'https://api.example.test', profileId: 'test-profile',
  returnUrl: 'http://127.0.0.1:4242/return', catalog,
};
async function fixture(t, overrides = {}) {
  const cfg = { ...config, ...overrides };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openswitch-service-test-'));
  const namespace = { mode: cfg.mode, apiOrigin: cfg.apiBaseUrl, profileId: cfg.mode === 'demo' ? null : cfg.profileId };
  const stores = [];
  const reopen = async () => {
    const store = await openOrderStore({ directory, namespace });
    stores.push(store);
    return store;
  };
  const store = await reopen();
  t.after(async () => {
    for (const store of stores) await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const service = api => createCheckoutService({ config: cfg, store, api });
  return { config: cfg, directory, store, reopen, service };
}
function payment(order, changes = {}) {
  return {
    paymentId: order.paymentId, profileId: order.profileId, amount: order.amount,
    currency: order.currency, status: 'requires_payment_method', clientSecret: 'dummy-client-secret',
    ...changes,
  };
}
function apiError(code, ambiguous) { return Object.assign(new Error('dummy-raw-secret'), { code, ambiguous }); }

// Catches requesting a payment before its stable identity is on durable storage.
test('the creating identity is persisted before the API and concurrent starts create once', async t => {
  const f = await fixture(t);
  let createCalls = 0;
  let saved;
  const api = {
    async create(order) {
      createCalls++;
      const disk = JSON.parse(await fs.readFile(path.join(f.directory, 'state.json'), 'utf8'));
      saved = Object.values(disk.orders).find(value => value.id === order.id);
      assert.equal(saved.phase, 'creating');
      assert.equal(saved.paymentId, order.paymentId);
      return payment(order);
    },
    async retrieve(id) { assert.equal(id, saved.paymentId); return payment(saved); },
  };
  const service = f.service(api);
  const order = await service.newOrder('sample');
  const [first, second] = await Promise.all([service.start(order.id), service.start(order.id)]);
  assert.equal(createCalls, 1);
  assert.equal((await f.store.get(order.id)).paymentId, saved.paymentId);
  assert.equal(first.clientSecret, 'dummy-client-secret');
  assert.equal(second.paymentId, first.paymentId);
  assert.equal(first.phase, 'ready');
  const status = await service.status(order.id);
  assert.equal('clientSecret' in status, false);
  assert.equal('profileId' in status, false);
  assert.equal('returnUrl' in status, false);
  assert.equal((await fs.readFile(path.join(f.directory, 'state.json'), 'utf8')).includes('dummy-client-secret'), false);
});

// Catches touching the API after a failed durable transition.
test('failed persistence of creating prevents a network request', async t => {
  const f = await fixture(t);
  let calls = 0;
  const service = f.service({ async create() { calls++; }, async retrieve() { calls++; } });
  const order = await service.newOrder('sample');
  const rename = t.mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('injected rename failure'), { code: 'EACCES' });
  });
  await assert.rejects(service.start(order.id), { code: 'STORE_WRITE_FAILED' });
  rename.mock.restore();
  assert.equal(calls, 0);
  assert.equal((await f.store.get(order.id)).phase, 'new');
});

for (const initialPhase of ['creating', 'uncertain']) {
  // Catches repeating an ambiguous financial create after process restart.
  test(`restart of ${initialPhase} retrieves the original ID and never creates on not-found`, async t => {
    const f = await fixture(t);
    let original;
    const service = f.service({ async create(order) { original = order; throw apiError('API_TIMEOUT', true); } });
    const order = await service.newOrder('sample');
    if (initialPhase === 'uncertain') await assert.rejects(service.start(order.id), { code: 'CHECKOUT_UNCERTAIN' });
    else {
      original = await f.store.get(order.id);
      await f.store.save({ ...original, phase: 'creating' });
    }
    await f.store.close();
    const store = await f.reopen();
    let creates = 0;
    const ids = [];
    const recovered = createCheckoutService({ config: f.config, store, api: {
      async create() { creates++; },
      async retrieve(id) { ids.push(id); throw apiError('API_NOT_FOUND', false); },
    } });
    for (let i = 0; i < 2; i++) await assert.rejects(recovered.start(order.id), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
    assert.equal(creates, 0);
    assert.deepEqual(ids, [original.paymentId, original.paymentId]);
    assert.equal((await store.get(order.id)).paymentId, original.paymentId);
    assert.equal((await store.get(order.id)).phase, 'uncertain');
  });
}

// Catches losing a successful payment's client secret across a restart or leaking it through status.
test('ready restart retrieves the same payment and obtains session data only for start', async t => {
  const f = await fixture(t);
  let created;
  const first = f.service({ async create(order) { created = order; return payment(order); } });
  const order = await first.newOrder('sample');
  await first.start(order.id);
  await f.store.close();
  const store = await f.reopen();
  let creates = 0;
  const recovered = createCheckoutService({ config: f.config, store, api: {
    async create() { creates++; }, async retrieve(id) { assert.equal(id, created.paymentId); return payment(created); },
  } });
  assert.equal((await recovered.start(order.id)).clientSecret, 'dummy-client-secret');
  assert.equal(creates, 0);
  assert.equal('clientSecret' in await recovered.status(order.id), false);
});

for (const change of [
  { amount: 1 }, { currency: 'USD' }, { profileId: 'other-profile' }, { paymentId: 'other-payment' },
  { status: 'invented' }, { simulated: true },
]) {
  // Catches trusting a provider success for a different order or invalid payment.
  test(`retrieval mismatch ${Object.keys(change)[0]} stays unpaid`, async t => {
    const f = await fixture(t);
    let original;
    const service = f.service({
      async create(order) { original = order; return payment(order); },
      async retrieve() { return payment(original, { status: 'succeeded', ...change }); },
    });
    const order = await service.newOrder('sample');
    await service.start(order.id);
    await assert.rejects(service.status(order.id), { code: 'CHECKOUT_PAYMENT_MISMATCH' });
    assert.notEqual((await f.store.get(order.id)).phase, 'paid');
  });
}

for (const [status, phase] of [['succeeded', 'paid'], ['failed', 'failed'], ['requires_capture', 'ready'], ['processing', 'ready']]) {
  // Catches declaring authorization/capture-pending or provider failure fulfilled.
  test(`matched retrieval ${status} yields ${phase}`, async t => {
    const f = await fixture(t);
    let original;
    const service = f.service({
      async create(order) { original = order; return payment(order); },
      async retrieve() { return payment(original, { status }); },
    });
    const order = await service.newOrder('sample');
    await service.start(order.id);
    assert.equal((await service.status(order.id)).phase, phase);
    assert.equal((await f.store.get(order.id)).phase, phase);
  });
}

// Catches fulfilling from create alone rather than authoritative retrieval.
test('a succeeded creation must be reconciled by retrieval before paid', async t => {
  const f = await fixture(t);
  let original;
  const service = f.service({
    async create(order) { original = order; return payment(order, { status: 'succeeded' }); },
    async retrieve() { return payment(original, { status: 'processing' }); },
  });
  const order = await service.newOrder('sample');
  assert.equal((await service.start(order.id)).phase, 'ready');
  assert.notEqual((await f.store.get(order.id)).phase, 'paid');
});

// Catches automatically retrying a definitive creation rejection and raw API error leaks.
test('definitive create failure is unpaid and subsequent start never creates again', async t => {
  const f = await fixture(t);
  let calls = 0;
  const service = f.service({ async create() { calls++; throw apiError('API_UNAUTHORIZED', false); } });
  const order = await service.newOrder('sample');
  await assert.rejects(service.start(order.id), error => {
    assert.equal(error.code, 'CHECKOUT_FAILED');
    assert.equal(`${error.message}${JSON.stringify(error)}`.includes('dummy-raw-secret'), false);
    return true;
  });
  assert.equal((await service.start(order.id)).phase, 'failed');
  assert.equal(calls, 1);
  assert.equal((await f.store.get(order.id)).phase, 'failed');
});

// Catches querying a definitively rejected create and accidentally fulfilling it later.
test('definitively rejected creation remains unpaid through status reconciliation', async t => {
  const f = await fixture(t);
  let original;
  let retrieves = 0;
  const service = f.service({
    async create(order) { original = order; throw apiError('API_UNAUTHORIZED', false); },
    async retrieve() { retrieves++; return payment(original, { status: 'succeeded' }); },
  });
  const order = await service.newOrder('sample');
  await assert.rejects(service.start(order.id), { code: 'CHECKOUT_FAILED' });
  assert.equal((await service.status(order.id)).phase, 'failed');
  assert.equal(retrieves, 0);
});

// Catches corrupted/mismatched create responses discarding ambiguity and permitting another create.
test('a mismatched creation is uncertain and recovers exclusively by the persisted ID', async t => {
  const f = await fixture(t);
  let original;
  let creates = 0;
  const service = f.service({
    async create(order) { creates++; original = order; return payment(order, { amount: 1 }); },
    async retrieve(id) { assert.equal(id, original.paymentId); return payment(original); },
  });
  const order = await service.newOrder('sample');
  await assert.rejects(service.start(order.id), { code: 'CHECKOUT_UNCERTAIN' });
  assert.equal((await f.store.get(order.id)).phase, 'uncertain');
  assert.equal((await service.start(order.id)).paymentId, original.paymentId);
  assert.equal(creates, 1);
});

// Catches existing identities silently acquiring edited catalog/config terms.
test('changed catalog financial values reject existing orders', async t => {
  const f = await fixture(t);
  const first = f.service({});
  const order = await first.newOrder('sample');
  const changed = createCheckoutService({ config: { ...f.config, catalog: [{ ...catalog[0], amount: 999 }] }, store: f.store, api: {} });
  await assert.rejects(changed.start(order.id), { code: 'CHECKOUT_ORDER_CONFLICT' });
  await assert.rejects(changed.status(order.id), { code: 'CHECKOUT_ORDER_CONFLICT' });
  assert.equal((await f.store.get(order.id)).amount, 1700);
  await assert.rejects(first.newOrder('absent'), { code: 'CHECKOUT_UNKNOWN_PRODUCT' });
});

// Catches reusing a previous customer's order when a fresh browser session is requested.
test('explicit new orders have independent server-owned identities and catalog currency', async t => {
  const f = await fixture(t);
  const service = f.service({});
  const first = await service.newOrder('sample');
  const second = await service.newOrder('sample');
  const anotherCurrency = await service.newOrder('second');
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.paymentId, second.paymentId);
  assert.equal(anotherCurrency.amount, 2900);
  assert.equal(anotherCurrency.currency, 'USD');
  assert.equal((await service.status(first.id)).phase, 'new');
  await assert.rejects(service.start('order_absent'), { code: 'CHECKOUT_ORDER_NOT_FOUND' });
});

for (const outcome of ['succeeded', 'failed', 'cancelled']) {
  // Catches simulated outcomes lost or replaced by adapter history on restart.
  test(`demo ${outcome} survives restart without API history`, async t => {
    const f = await fixture(t, { mode: 'demo', profileId: undefined });
    const service = f.service(createDemoApi());
    const order = await service.newOrder('sample');
    assert.equal((await service.start(order.id)).simulated, true);
    const result = await service.completeDemo(order.id, outcome);
    assert.equal(result.status, outcome);
    assert.equal(result.simulated, true);
    assert.equal('clientSecret' in result, false);
    await f.store.close();
    const store = await f.reopen();
    const recovered = createCheckoutService({ config: f.config, store, api: {
      async create() { assert.fail('demo restart must synthesize locally'); },
      async retrieve() { assert.fail('demo status must use persisted simulation'); },
    } });
    const status = await recovered.status(order.id);
    assert.equal(status.status, outcome);
    assert.equal(status.phase, outcome === 'succeeded' ? 'paid' : 'failed');
    assert.equal(status.simulated, true);
    assert.equal((await recovered.start(order.id)).status, outcome);
  });
}

// Catches crash-recovered demo orders depending on volatile adapter history.
test('demo creating recovery is an explicitly simulated local session', async t => {
  const f = await fixture(t, { mode: 'demo', profileId: undefined });
  const service = f.service(createDemoApi());
  const order = await service.newOrder('sample');
  await f.store.save({ ...await f.store.get(order.id), phase: 'creating' });
  await f.store.close();
  const store = await f.reopen();
  const recovered = createCheckoutService({ config: f.config, store, api: {} });
  assert.equal((await recovered.start(order.id)).status, 'requires_payment_method');
  assert.equal((await recovered.completeDemo(order.id, 'succeeded')).simulated, true);
});

// Catches accepting demo completion for real orders or invalid/unstarted simulations.
test('simulated completion is restricted to started demo orders and valid outcomes', async t => {
  const f = await fixture(t);
  const service = f.service({});
  const order = await service.newOrder('sample');
  await assert.rejects(service.completeDemo(order.id, 'succeeded'), { code: 'CHECKOUT_DEMO_ONLY' });
  const demo = await fixture(t, { mode: 'demo', profileId: undefined });
  const simulated = demo.service(createDemoApi());
  const newOrder = await simulated.newOrder('sample');
  await assert.rejects(simulated.completeDemo(newOrder.id, 'succeeded'), { code: 'CHECKOUT_NOT_STARTED' });
  await simulated.start(newOrder.id);
  await assert.rejects(simulated.completeDemo(newOrder.id, 'invented'), { code: 'CHECKOUT_INVALID_OUTCOME' });
  await simulated.completeDemo(newOrder.id, 'succeeded');
  await assert.rejects(simulated.completeDemo(newOrder.id, 'failed'), { code: 'CHECKOUT_DEMO_FINAL' });
  assert.equal((await simulated.status(newOrder.id)).phase, 'paid');
});
