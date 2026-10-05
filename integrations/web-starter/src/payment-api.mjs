/**
 * @typedef {{paymentId:string, profileId:string|undefined, amount:number,
 * currency:string, status:string, clientSecret?:string, simulated?:boolean}} Payment
 * @typedef {{create(order:object):Promise<Payment>, retrieve(paymentId:string):Promise<Payment>}} PaymentApi
 */

const responseLimit = 1024 * 1024;
const statuses = new Set([
  'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'processing',
  'requires_customer_action', 'requires_merchant_action', 'requires_payment_method',
  'requires_confirmation', 'requires_capture', 'partially_captured',
  'partially_captured_and_capturable', 'partially_authorized_and_requires_capture',
  'partially_captured_and_processing', 'conflicted', 'expired', 'review',
]);

/** Errors carry no request, response, URL, credentials or underlying cause. */
class PaymentApiError extends Error {
  constructor(code, ambiguous) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

function apiError(code, ambiguous = false) {
  return new PaymentApiError(code, ambiguous);
}

function nonblank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validId(value) {
  return nonblank(value) && value.length <= 255 && value.isWellFormed() &&
    value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validMoney(amount, currency) {
  return Number.isSafeInteger(amount) && amount > 0 && typeof currency === 'string' && /^[A-Z]{3}$/u.test(currency);
}

function validReturnUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === '/return';
  } catch {
    return false;
  }
}

function normalize(body, paymentId, order) {
  const ambiguous = Boolean(order);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError('API_INVALID_RESPONSE', ambiguous);
  if (Object.hasOwn(body, 'error')) throw apiError('API_ERROR', ambiguous);
  if (!validId(body.payment_id) || body.payment_id !== paymentId || !validId(body.profile_id) ||
      !validMoney(body.amount, body.currency) || !statuses.has(body.status) ||
      (body.client_secret != null && !nonblank(body.client_secret)) ||
      (order && (!nonblank(body.client_secret) || body.profile_id !== order.profileId ||
        body.amount !== order.amount || body.currency !== order.currency))) {
    throw apiError('API_INVALID_RESPONSE', ambiguous);
  }
  return {
    paymentId: body.payment_id,
    profileId: body.profile_id,
    amount: body.amount,
    currency: body.currency,
    status: body.status,
    ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
  };
}

async function readJson(response, ambiguous) {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > responseLimit) throw apiError('API_RESPONSE_TOO_LARGE', ambiguous);
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/u.test(type ?? '')) {
    throw apiError('API_INVALID_RESPONSE', ambiguous);
  }
  if (!response.body) throw apiError('API_INVALID_RESPONSE', ambiguous);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) throw apiError('API_RESPONSE_TOO_LARGE', ambiguous);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch {
    throw apiError('API_INVALID_RESPONSE', ambiguous);
  }
}

/** Supported v1 payment API. HTTPS is enforced by startup configuration;
 * the constructor also accepts HTTP loopback for local boundary tests.
 * @returns {PaymentApi}
 */
export function createPaymentApi({ baseUrl, apiKey, timeoutMs, fetchImpl = globalThis.fetch }) {
  let origin;
  try {
    if (typeof baseUrl !== 'string' || /\s|\\|[?#]/u.test(baseUrl)) throw new Error();
    const url = new URL(baseUrl);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
        url.username || url.password || url.pathname !== '/') throw new Error();
    origin = url.origin;
    if (!nonblank(apiKey) || /[\r\n]/u.test(apiKey) || !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 || timeoutMs > 2147483647 || typeof fetchImpl !== 'function') throw new Error();
  } catch {
    throw apiError('API_INVALID_REQUEST');
  }

  async function request(method, paymentId, order) {
    const creating = method === 'POST';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${origin}/payments${creating ? '' : `/${encodeURIComponent(paymentId)}`}`, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' },
        ...(creating ? { body: JSON.stringify({
          payment_id: paymentId,
          amount: order.amount,
          currency: order.currency,
          profile_id: order.profileId,
          capture_method: 'automatic',
          confirm: false,
          return_url: order.returnUrl,
        }) } : {}),
      });
      if (!response.ok) {
        const code = response.status === 401 ? 'API_UNAUTHORIZED' :
          response.status === 404 ? 'API_NOT_FOUND' : 'API_HTTP_ERROR';
        // A duplicate/conflict or infrastructure error may follow an accepted create.
        const uncertain = creating && (response.status >= 500 || response.status < 400 ||
          [408, 409, 425, 429].includes(response.status));
        throw apiError(code, uncertain);
      }
      return normalize(await readJson(response, creating), paymentId, order);
    } catch (error) {
      if (controller.signal.aborted) throw apiError('API_TIMEOUT', creating);
      // Only errors created here cross the boundary; underlying transport errors are discarded.
      if (error instanceof PaymentApiError) throw error;
      throw apiError('API_TRANSPORT_ERROR', creating);
    } finally {
      clearTimeout(timer);
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => {});
      }
    }
  }

  return {
    async create(order) {
      if (!order || !validId(order.paymentId) || !validId(order.profileId) ||
          !validMoney(order.amount, order.currency) || !validReturnUrl(order.returnUrl)) {
        throw apiError('API_INVALID_REQUEST');
      }
      return request('POST', order.paymentId, order);
    },
    async retrieve(paymentId) {
      if (!validId(paymentId)) throw apiError('API_INVALID_REQUEST');
      return request('GET', paymentId);
    },
  };
}
