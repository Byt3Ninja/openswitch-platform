import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentApi } from '../src/payment-api.mjs';
import { createDemoApi } from '../src/demo-api.mjs';
import { createFakeApi, sendJson } from './support/fake-api.mjs';

const order = {
  id: 'order_dummy', catalogId: 'sample', amount: 1250, currency: 'USD',
  profileId: 'pro_dummy', paymentId: 'pay_dummy',
  returnUrl: 'http://127.0.0.1:4242/return', phase: 'creating',
};
const paymentBody = {
  payment_id: 'pay_dummy', profile_id: 'pro_dummy', amount: 1250, currency: 'USD',
  status: 'requires_payment_method', client_secret: 'dummy-client-secret',
  merchant_id: 'merchant_dummy', capture_method: 'automatic', confirm: false,
  return_url: 'http://127.0.0.1:4242/return', connector: null,
  amount_capturable: 0, amount_received: null, net_amount: 1250,
};
const normalized = {
  paymentId: 'pay_dummy', profileId: 'pro_dummy', amount: 1250, currency: 'USD',
  status: 'requires_payment_method', clientSecret: 'dummy-client-secret',
};

async function withApi(t, respond, options = {}) {
  const fake = await createFakeApi(respond);
  t.after(() => fake.close());
  return {
    fake,
    api: createPaymentApi({ baseUrl: fake.baseUrl, apiKey: 'dummy-secret', timeoutMs: 1000, ...options }),
  };
}

function safeError(code, ambiguous) {
  return error => {
    assert.equal(error.code, code);
    assert.equal(error.ambiguous, ambiguous);
    for (const secret of ['dummy-secret', 'dummy-client-secret', 'private-provider-payload']) {
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(String(error).includes(secret), false);
      assert.equal(error.stack.includes(secret), false);
    }
    assert.deepEqual(Object.keys(error).sort(), ['ambiguous', 'code']);
    return true;
  };
}

// Break caught: a provider-specific, browser-controlled or confirmed create request.
test('creates from server order values with stable identity and no provider selection', async t => {
  const { fake, api } = await withApi(t, (_, response) => sendJson(response, paymentBody));
  assert.deepEqual(await api.create({ ...order, connector: 'ignored', payment_method: 'ignored' }), normalized);
  const recorded = fake.requests[0];
  assert.equal(recorded.method, 'POST');
  assert.equal(recorded.path, '/payments');
  assert.deepEqual(recorded.body, {
    payment_id: 'pay_dummy', amount: 1250, currency: 'USD', profile_id: 'pro_dummy',
    capture_method: 'automatic', confirm: false, return_url: 'http://127.0.0.1:4242/return',
  });
  assert.equal('connector' in recorded.body, false);
  assert.equal(recorded.headers['api-key'], 'dummy-secret');
  assert.equal(recorded.headers['content-type'], 'application/json');
  assert.equal(recorded.headers.accept, 'application/json');
  assert.equal(fake.requests.length, 1);
});

// Break caught: IDs become path/query instructions or retrieval leaks raw fields.
test('encodes the entire retrieval ID and normalizes an authoritative terminal response', async t => {
  const id = 'pay/a ?#%';
  const { fake, api } = await withApi(t, (_, response) => sendJson(response, {
    ...paymentBody, payment_id: id, status: 'succeeded', client_secret: null,
  }));
  assert.deepEqual(await api.retrieve(id), {
    paymentId: id, profileId: 'pro_dummy', amount: 1250, currency: 'USD', status: 'succeeded',
  });
  assert.equal(fake.requests[0].method, 'GET');
  assert.equal(fake.requests[0].path, '/payments/pay%2Fa%20%3F%23%25');
  assert.equal(fake.requests[0].body, undefined);
  assert.equal(fake.requests[0].headers['api-key'], 'dummy-secret');
});

// Break caught: fetch follows a redirect and forwards the merchant credential.
test('refuses redirects without contacting the redirect target', async t => {
  const target = await createFakeApi((_, response) => sendJson(response, paymentBody));
  t.after(() => target.close());
  const { api, fake } = await withApi(t, (_, response) => {
    response.writeHead(307, { location: `${target.baseUrl}/stolen` });
    response.end();
  });
  await assert.rejects(api.create(order), safeError('API_TRANSPORT_ERROR', true));
  assert.equal(target.requests.length, 0);
  assert.equal(fake.requests.length, 1);
});

// Break caught: raw API bodies or credentials escape through error serialization.
for (const [status, code, ambiguous] of [
  [401, 'API_UNAUTHORIZED', false], [404, 'API_NOT_FOUND', false],
  [422, 'API_HTTP_ERROR', false], [500, 'API_HTTP_ERROR', true],
  [409, 'API_HTTP_ERROR', true],
]) {
  test(`sanitizes HTTP ${status} and classifies create uncertainty`, async t => {
    const { fake, api } = await withApi(t, (_, response) => sendJson(response, {
      error: { message: 'dummy-secret dummy-client-secret private-provider-payload' },
    }, status));
    await assert.rejects(api.create(order), safeError(code, ambiguous));
    assert.equal(fake.requests.length, 1);
  });
}

// Break caught: response validation accepts a missing session or invalid payment contract.
const malformed = [
  ['null body', null], ['array body', []], ['missing payment ID', { ...paymentBody, payment_id: undefined }],
  ['numeric ID', { ...paymentBody, payment_id: 42 }], ['wrong ID', { ...paymentBody, payment_id: 'pay_other' }],
  ['missing profile', { ...paymentBody, profile_id: undefined }],
  ['wrong profile', { ...paymentBody, profile_id: 'pro_other' }],
  ['string amount', { ...paymentBody, amount: '1250' }], ['unsafe amount', { ...paymentBody, amount: 2 ** 53 }],
  ['wrong amount', { ...paymentBody, amount: 900 }], ['wrong currency', { ...paymentBody, currency: 'GBP' }],
  ['lowercase currency', { ...paymentBody, currency: 'usd' }], ['unknown status', { ...paymentBody, status: 'paid' }],
  ['missing client secret', { ...paymentBody, client_secret: undefined }],
  ['blank client secret', { ...paymentBody, client_secret: '' }],
  ['object client secret', { ...paymentBody, client_secret: { token: 'dummy-client-secret' } }],
];
for (const [label, body] of malformed) {
  test(`rejects malformed create success: ${label}`, async t => {
    const { api } = await withApi(t, (_, response) => sendJson(response, body));
    await assert.rejects(api.create(order), safeError('API_INVALID_RESPONSE', true));
  });
}

test('rejects a successful HTTP API error envelope safely', async t => {
  const { api } = await withApi(t, (_, response) => sendJson(response, {
    ...paymentBody, error: { message: 'dummy-secret private-provider-payload' },
  }));
  await assert.rejects(api.create(order), safeError('API_ERROR', true));
});

for (const [label, contentType, text] of [
  ['non-JSON media type', 'text/html', 'dummy-secret private-provider-payload'],
  ['invalid JSON', 'application/json', '{dummy-client-secret'],
]) {
  test(`rejects ${label} as an uncertain create response`, async t => {
    const { api } = await withApi(t, (_, response) => {
      response.writeHead(200, { 'content-type': contentType });
      response.end(text);
    });
    await assert.rejects(api.create(order), safeError('API_INVALID_RESPONSE', true));
  });
}

for (const declaredLength of [true, false]) {
  test(`caps ${declaredLength ? 'declared' : 'streaming'} responses at 1 MiB`, async t => {
    const { api } = await withApi(t, (_, response) => {
      const body = JSON.stringify({ ...paymentBody, padding: 'x'.repeat(1024 * 1024) });
      response.writeHead(200, {
        'content-type': 'application/json',
        ...(declaredLength ? { 'content-length': Buffer.byteLength(body) } : {}),
      });
      response.write(body.slice(0, 100));
      response.end(body.slice(100));
    });
    await assert.rejects(api.create(order), safeError('API_RESPONSE_TOO_LARGE', true));
  });
}

// Break caught: timeout is reported definitive, or the financial request is retried.
for (const duringBody of [false, true]) {
  test(`timeout ${duringBody ? 'during body' : 'before headers'} preserves uncertainty without retry`, async t => {
    const { fake, api } = await withApi(t, (_, response) => {
      if (duringBody) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{');
      }
    }, { timeoutMs: 40 });
    await assert.rejects(api.create(order), safeError('API_TIMEOUT', true));
    const requestCountAfterTimeout = fake.requests.length;
    assert.equal(requestCountAfterTimeout, 1);
  });
}

test('sanitizes transport failures without retaining a secret-bearing cause', async t => {
  const { api } = await withApi(t, () => {}, {
    fetchImpl: async () => { throw new Error('dummy-secret private-provider-payload'); },
  });
  await assert.rejects(api.create(order), safeError('API_TRANSPORT_ERROR', true));
});

// Break caught: a transport library's structured error is mistaken for our sanitized error.
test('sanitizes transport errors even when they contain code and ambiguity properties', async t => {
  const { api } = await withApi(t, () => {}, {
    fetchImpl: async () => {
      throw Object.assign(new Error('dummy-secret private-provider-payload'), {
        code: 'RAW_TRANSPORT', ambiguous: false, response: 'dummy-client-secret',
      });
    },
  });
  await assert.rejects(api.create(order), safeError('API_TRANSPORT_ERROR', true));
});

test('rejects retrieval identity mismatch without marking a create outcome uncertain', async t => {
  const { api } = await withApi(t, (_, response) => sendJson(response, { ...paymentBody, payment_id: 'pay_other' }));
  await assert.rejects(api.retrieve('pay_dummy'), safeError('API_INVALID_RESPONSE', false));
});

test('allows requires_capture on retrieval without claiming success or requiring a session secret', async t => {
  const { api } = await withApi(t, (_, response) => sendJson(response, {
    ...paymentBody, status: 'requires_capture', client_secret: null,
  }));
  assert.equal((await api.retrieve('pay_dummy')).status, 'requires_capture');
});

test('rejects invalid server order input before making a payment call', async t => {
  const { api, fake } = await withApi(t, (_, response) => sendJson(response, paymentBody));
  for (const change of [{ amount: 0 }, { profileId: undefined }, { paymentId: '' }, { currency: 'usd' }, { returnUrl: 'javascript:alert(1)' }]) {
    await assert.rejects(api.create({ ...order, ...change }), safeError('API_INVALID_REQUEST', false));
  }
  assert.equal(fake.requests.length, 0);
});

// Break caught: dot segments change the requested resource, or malformed Unicode reaches URL encoding.
test('rejects unsafe retrieval IDs before sending any request', async t => {
  const { api, fake } = await withApi(t, (_, response) => sendJson(response, paymentBody));
  for (const id of ['', '.', '..', '\ud800', 'pay\nunsafe']) {
    await assert.rejects(api.retrieve(id), safeError('API_INVALID_REQUEST', false));
  }
  assert.equal(fake.requests.length, 0);
});

// Break caught: offline demonstration reaches the network, invents real credentials or leaks mutable state.
test('demo uses supplied payment IDs and labels states without fetching', async t => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Unexpected network'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const api = createDemoApi();
  const demoOrder = { ...order, profileId: undefined };
  const created = await api.create(demoOrder);
  assert.deepEqual(created, {
    paymentId: 'pay_dummy', profileId: undefined, amount: 1250, currency: 'USD',
    status: 'requires_payment_method', simulated: true,
  });
  created.status = 'succeeded';
  assert.equal((await api.retrieve('pay_dummy')).status, 'requires_payment_method');
  assert.equal((await api.retrieve('pay_dummy')).simulated, true);
  assert.equal('clientSecret' in created, false);
  assert.equal(calls, 0);
});

test('demo keeps identity stable and refuses conflicting reuse', async () => {
  const api = createDemoApi();
  await api.create(order);
  assert.equal((await api.create(order)).paymentId, 'pay_dummy');
  await assert.rejects(api.create({ ...order, amount: 900 }), safeError('API_INVALID_REQUEST', false));
  await assert.rejects(api.retrieve('pay_unknown'), safeError('API_NOT_FOUND', false));
});
