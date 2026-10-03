import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutController } from '../public/checkout-controller.mjs';
import { createBrowserApi, createSdkLoader, cleanReturnLocation, saveOrderId, readOrderId } from '../public/checkout.mjs';

const config = {
  mode: 'demo', apiBaseUrl: 'https://api.example.test', sdkUrl: 'https://sdk.example.test/HyperLoader.js',
  localOrigin: 'http://127.0.0.1:4242', csrfToken: 'local-csrf',
  catalog: [
    { id: 'book', label: 'Sample book', amount: 1250, currency: 'USD' },
    { id: 'ticket', label: 'Sample ticket', amount: 900, currency: 'GBP' },
  ],
};
const initialOrder = {
  id: 'order_one', catalogId: 'book', amount: 1250, currency: 'USD',
  paymentId: 'pay_one', phase: 'new', status: 'not_created', simulated: true,
};
const readyOrder = { ...initialOrder, phase: 'ready', status: 'requires_payment_method' };
const paidOrder = { ...initialOrder, phase: 'paid', status: 'succeeded' };
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function setup(overrides = {}) {
  let view;
  let sdkLoads = 0;
  let confirmCalls = 0;
  const mounts = [];
  const widgetsCalls = [];
  const createCalls = [];
  const confirmArguments = [];
  const calls = [];
  const widget = { mount: target => mounts.push(target), unmount() {} };
  const widgets = { create: (...args) => { createCalls.push(args); return widget; } };
  const hyper = {
    widgets: args => { widgetsCalls.push(args); return widgets; },
    ...overrides.hyper,
    confirmPayment: async args => {
      confirmCalls++; confirmArguments.push(args);
      return overrides.hyper?.confirmPayment ? overrides.hyper.confirmPayment(args) : {};
    },
  };
  const api = {
    config: async () => ({ ...config, ...overrides.config }),
    newOrder: async id => { calls.push(['newOrder', id]); return { ...initialOrder, ...overrides.order }; },
    checkout: async id => { calls.push(['checkout', id]); return { ...readyOrder, ...overrides.order, ...overrides.checkout }; },
    status: async id => { calls.push(['status', id]); return { ...readyOrder, ...overrides.order, ...overrides.status }; },
    completeDemo: async (id, outcome) => {
      calls.push(['completeDemo', id, outcome]);
      return { ...initialOrder, status: outcome, phase: outcome === 'succeeded' ? 'paid' : 'failed' };
    },
    ...overrides.api,
  };
  const controller = createCheckoutController({
    api,
    sdkLoader: async options => { sdkLoads++; return overrides.sdkLoader ? overrides.sdkLoader(options) : hyper; },
    render: state => { view = state; },
  });
  return { controller, api, get view() { return view; }, get sdkLoads() { return sdkLoads; },
    get confirmCalls() { return confirmCalls; }, mounts, widgetsCalls, createCalls, confirmArguments, calls };
}
async function sandbox(options = {}) {
  const h = setup({ config: { mode: 'sandbox', publishableKey: 'public-test-key' },
    order: { simulated: false }, checkout: { clientSecret: 'test-client-secret' }, ...options });
  await h.controller.initialize();
  await h.controller.start();
  return h;
}

test('demo starts a simulated order without loading the hosted SDK', async () => {
  const h = setup();
  await h.controller.initialize();
  await h.controller.start();
  assert.equal(h.sdkLoads, 0);
  assert.equal(h.view.mode, 'demo');
  assert.equal(h.view.order.simulated, true);
  assert.equal(h.view.ready, true);
  assert.equal(h.view.paid, false);
  assert.deepEqual(h.calls, [['newOrder', 'book'], ['checkout', 'order_one']]);
});

test('sandbox mounts the standard payment widget with a derived wallet return URL', async () => {
  const h = await sandbox();
  assert.equal(h.sdkLoads, 1);
  assert.deepEqual(h.widgetsCalls, [{ clientSecret: 'test-client-secret' }]);
  assert.deepEqual(h.createCalls, [['payment', { wallets: { walletReturnUrl: 'http://127.0.0.1:4242/return' } }]]);
  assert.deepEqual(h.mounts, ['#payment-widget']);
  assert.equal(h.view.ready, true);
  assert.equal(JSON.stringify(h.view).includes('test-client-secret'), false);
});

test('double confirmation produces one SDK financial submission', async () => {
  const pending = deferred();
  const h = await sandbox({ hyper: { confirmPayment: async () => pending.promise } });
  const first = h.controller.confirm();
  await h.controller.confirm();
  assert.equal(h.confirmCalls, 1);
  assert.equal(h.view.submitting, true);
  pending.resolve({ payment: { status: 'succeeded' } });
  await first;
  assert.equal(h.view.paid, false);
  await h.controller.confirm();
  assert.equal(h.confirmCalls, 1);
});

test('confirm passes widgets and return URL through the hosted SDK interface', async () => {
  const h = await sandbox();
  await h.controller.confirm();
  assert.equal(h.confirmCalls, 1);
  assert.deepEqual(h.confirmArguments[0].confirmParams, { return_url: 'http://127.0.0.1:4242/return' });
  assert.equal(h.confirmArguments[0].redirect, 'if_required');
  assert.equal(typeof h.confirmArguments[0].widgets.create, 'function');
});

test('SDK success cannot mark a pending backend order paid', async () => {
  const h = await sandbox({ hyper: { confirmPayment: async () => ({ status: 'succeeded' }) } });
  await h.controller.confirm();
  assert.equal(h.view.paid, false);
  assert.equal(h.view.uncertain, true);
  assert.equal(h.view.order.status, 'requires_payment_method');
});

test('only a matched authoritative succeeded order becomes paid', async () => {
  const h = await sandbox({ status: { phase: 'paid', status: 'succeeded' } });
  await h.controller.confirm();
  assert.equal(h.view.paid, true);
  assert.equal(h.view.uncertain, false);
});

for (const mismatch of [
  { id: 'order_other' }, { paymentId: 'pay_other' }, { catalogId: 'ticket' },
  { amount: 900 }, { currency: 'GBP' }, { simulated: true }, { phase: 'ready' },
]) {
  test(`mismatched backend success stays unpaid: ${Object.keys(mismatch)[0]}`, async () => {
    const h = await sandbox({ status: { phase: 'paid', status: 'succeeded', ...mismatch } });
    await h.controller.refreshStatus();
    assert.equal(h.view.paid, false);
    assert.equal(h.view.uncertain, true);
    assert.equal(typeof h.view.error, 'string');
  });
}

test('SDK load failure stays unpaid and exposes no raw secret-bearing error', async () => {
  const h = await sandbox({ sdkLoader: async () => { throw new Error('raw test-client-secret'); } });
  assert.equal(h.view.paid, false);
  assert.equal(h.view.ready, false);
  assert.equal(typeof h.view.error, 'string');
  assert.equal(JSON.stringify(h.view).includes('test-client-secret'), false);
  assert.equal(h.view.submitting, false);
});

test('uncertain SDK failure blocks repeat confirmation and offers reconciliation', async () => {
  const h = await sandbox({ hyper: { confirmPayment: async () => { throw new Error('raw test-client-secret'); } } });
  await h.controller.confirm();
  assert.equal(h.view.uncertain, true);
  assert.equal(h.view.canConfirm, false);
  assert.equal(h.view.canRefresh, true);
  assert.equal(JSON.stringify(h.view).includes('test-client-secret'), false);
});

test('late status for a previous order cannot replace a newly selected catalog', async () => {
  const h = setup();
  await h.controller.initialize();
  await h.controller.start();
  const old = deferred();
  h.api.status = async () => old.promise;
  const refresh = h.controller.refreshStatus();
  h.controller.selectCatalog('ticket');
  old.resolve(paidOrder);
  await refresh;
  assert.equal(h.view.selectedCatalogId, 'ticket');
  assert.equal(h.view.order, null);
  assert.equal(h.view.paid, false);
});

test('configured second currency determines the order without fixed payment methods', async () => {
  const ticket = { ...initialOrder, id: 'order_ticket', catalogId: 'ticket', amount: 900, currency: 'GBP', paymentId: 'pay_ticket' };
  const h = setup({ api: {
    newOrder: async id => { assert.equal(id, 'ticket'); return ticket; },
    checkout: async () => ({ ...ticket, phase: 'ready', status: 'requires_payment_method' }),
  } });
  await h.controller.initialize();
  h.controller.selectCatalog('ticket');
  await h.controller.start();
  assert.equal(h.view.order.currency, 'GBP');
  assert.equal(h.view.order.amount, 900);
});

test('double start creates one local order and never retries ambiguous checkout', async () => {
  const pending = deferred();
  const h = setup({ api: { checkout: async () => { await pending.promise; throw new Error('raw test-client-secret'); } } });
  await h.controller.initialize();
  const first = h.controller.start();
  await h.controller.start();
  pending.resolve();
  await first;
  await h.controller.start();
  assert.equal(h.calls.filter(([name]) => name === 'newOrder').length, 1);
  assert.equal(h.view.uncertain, true);
  assert.equal(JSON.stringify(h.view).includes('test-client-secret'), false);
});

test('demo completion is visibly simulated and reconciled through the backend', async () => {
  const h = setup({ status: { phase: 'paid', status: 'succeeded' } });
  await h.controller.initialize();
  await h.controller.start();
  await h.controller.completeDemo('succeeded');
  assert.equal(h.sdkLoads, 0);
  assert.equal(h.view.paid, true);
  assert.equal(h.view.order.simulated, true);
  assert.deepEqual(h.calls.slice(-2), [['completeDemo', 'order_one', 'succeeded'], ['status', 'order_one']]);
});

test('sandbox cannot invoke the demo outcome route', async () => {
  const h = await sandbox();
  await h.controller.completeDemo('succeeded');
  assert.equal(h.calls.some(([name]) => name === 'completeDemo'), false);
  assert.equal(h.view.paid, false);
});

test('return recovery retrieves only the opaque local order and ignores browser result', async () => {
  const h = setup({ status: { phase: 'paid', status: 'succeeded' } });
  await h.controller.initialize();
  await h.controller.restoreOrder('order_one');
  assert.equal(h.view.paid, true);
  assert.equal(h.view.order.id, 'order_one');
  assert.deepEqual(h.calls, [['status', 'order_one']]);
  assert.equal(h.sdkLoads, 0);
});

test('return recovery rejects a wrong order identity or catalog financial terms', async () => {
  for (const status of [{ id: 'order_other' }, { amount: 1 }]) {
    const h = setup({ status: { phase: 'paid', status: 'succeeded', ...status } });
    await h.controller.initialize();
    await h.controller.restoreOrder('order_one');
    assert.equal(h.view.paid, false);
    assert.equal(h.view.uncertain, true);
  }
});

test('late SDK loading does not mount after switching catalog', async () => {
  const pending = deferred();
  const h = setup({ config: { mode: 'sandbox', publishableKey: 'public-test-key' }, order: { simulated: false },
    checkout: { clientSecret: 'test-client-secret' }, sdkLoader: async () => pending.promise });
  await h.controller.initialize();
  const start = h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  h.controller.selectCatalog('ticket');
  pending.resolve({ widgets: () => { throw new Error('obsolete SDK mounted'); } });
  await start;
  assert.equal(h.view.selectedCatalogId, 'ticket');
  assert.equal(h.view.error, null);
});

test('browser API sends only the contracted payload and local CSRF headers', async () => {
  const requests = [];
  const api = createBrowserApi(async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => url === '/api/config' ? config : readyOrder };
  });
  await api.config();
  await api.newOrder('book');
  await api.checkout('order_one');
  await api.status('order_one');
  await api.completeDemo('order_one', 'cancelled');
  assert.deepEqual(requests.map(([url]) => url), [
    '/api/config', '/api/orders', '/api/orders/order_one/checkout', '/api/orders/order_one', '/api/orders/order_one/demo-result',
  ]);
  for (const index of [1, 2, 4]) {
    const request = requests[index][1];
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.equal(request.headers['x-csrf-token'], 'local-csrf');
    assert.equal(request.headers.Origin, undefined); // The browser supplies Origin.
    assert.equal(request.credentials, 'same-origin');
  }
  assert.equal(requests[1][1].body, '{"catalogId":"book"}');
  assert.equal(requests[2][1].body, '{}');
  assert.equal(requests[4][1].body, '{"outcome":"cancelled"}');
});

test('browser API suppresses raw failure response and request exception messages', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, json: async () => ({ error: 'test-client-secret' }) }),
    async () => { throw new Error('test-client-secret'); },
  ]) {
    const api = createBrowserApi(fetchImpl);
    await assert.rejects(api.config(), error => !error.message.includes('test-client-secret'));
  }
});

test('return URL query and fragment are cleared without reading payment results', () => {
  const history = { replaceState: (...args) => { history.args = args; } };
  const location = { pathname: '/return', search: '?client_secret=test-client-secret&status=succeeded', hash: '#succeeded' };
  cleanReturnLocation(location, history);
  assert.deepEqual(history.args, [null, '', '/return']);
});

test('session storage persists only opaque order identity', () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key), removeItem: key => values.delete(key) };
  saveOrderId(storage, { ...readyOrder, clientSecret: 'test-client-secret' });
  assert.deepEqual([...values.values()], ['order_one']);
  assert.equal(readOrderId(storage), 'order_one');
  saveOrderId(storage, null);
  assert.equal(values.size, 0);
});

test('invalid stored identity and unavailable storage do not break checkout', () => {
  assert.equal(readOrderId({ getItem: () => '?client_secret=test-client-secret' }), null);
  const broken = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); }, removeItem() { throw new Error('disabled'); } };
  assert.equal(readOrderId(broken), null);
  assert.doesNotThrow(() => saveOrderId(broken, initialOrder));
});

test('hosted loader is sandbox-only and initializes Hyper with the configured endpoint', async () => {
  const scripts = [];
  const hyperCalls = [];
  const hyper = { widgets() {}, confirmPayment() {} };
  const document = { createElement: () => ({}), head: { append: script => { scripts.push(script); queueMicrotask(() => script.onload()); } } };
  const window = { Hyper: (...args) => { hyperCalls.push(args); return hyper; } };
  const loader = createSdkLoader({ document, window, timeoutMs: 100 });
  await assert.rejects(loader(config));
  assert.equal(scripts.length, 0);
  const loaded = await loader({ ...config, mode: 'sandbox', publishableKey: 'public-test-key' });
  assert.equal(loaded, hyper);
  assert.equal(scripts[0].src, 'https://sdk.example.test/HyperLoader.js');
  assert.deepEqual(hyperCalls, [['public-test-key', { customBackendUrl: 'https://api.example.test' }]]);
});

test('blocked or stalled hosted loader rejects with a bounded safe error', async () => {
  for (const blocked of [true, false]) {
    const document = { createElement: () => ({ remove() {} }), head: { append: script => { if (blocked) queueMicrotask(() => script.onerror()); } } };
    const loader = createSdkLoader({ document, window: {}, timeoutMs: 5 });
    await assert.rejects(loader({ ...config, mode: 'sandbox', publishableKey: 'public-test-key' }), error =>
      !error.message.includes('public-test-key') && !error.message.includes('https://'));
  }
});

test('malformed backend order identity never enables checkout or persistence', async () => {
  for (const field of ['id', 'paymentId']) {
    const h = setup({ order: { [field]: undefined } });
    await h.controller.initialize();
    await h.controller.start();
    assert.equal(h.view.order, null);
    assert.equal(h.view.ready, false);
    assert.equal(h.view.uncertain, true);
  }
});

test('a later unverifiable status hides a previously verified paid display', async () => {
  const h = setup({ status: { phase: 'paid', status: 'succeeded' } });
  await h.controller.initialize();
  await h.controller.restoreOrder('order_one');
  assert.equal(h.view.paid, true);
  h.api.status = async () => ({ ...paidOrder, paymentId: 'pay_wrong' });
  await h.controller.refreshStatus();
  assert.equal(h.view.paid, false);
  assert.equal(h.view.uncertain, true);
});

test('browser refuses non-string route or storage identity', async () => {
  let requests = 0;
  const api = createBrowserApi(async () => { requests++; return { ok: true, json: async () => readyOrder }; });
  assert.throws(() => api.status(undefined));
  assert.equal(requests, 0);
  const storage = { setItem() { throw new Error('must not store'); }, removeItem() { storage.removed = true; } };
  saveOrderId(storage, { id: undefined });
  assert.equal(storage.removed, true);
});
