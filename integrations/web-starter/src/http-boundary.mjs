import { timingSafeEqual } from 'node:crypto';

const bodyLimit = 16 * 1024;
const httpErrors = new Set(['FORBIDDEN', 'BAD_REQUEST', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'NOT_FOUND']);
const serviceStatuses = {
  CHECKOUT_UNKNOWN_PRODUCT: 400, CHECKOUT_INVALID_OUTCOME: 400,
  CHECKOUT_ORDER_NOT_FOUND: 404, CHECKOUT_DEMO_ONLY: 404,
  CHECKOUT_NOT_STARTED: 409, CHECKOUT_DEMO_FINAL: 409, CHECKOUT_ORDER_CONFLICT: 409,
  CHECKOUT_UNCERTAIN: 409, CHECKOUT_RECONCILIATION_REQUIRED: 409, CHECKOUT_SESSION_UNAVAILABLE: 409,
  CHECKOUT_FAILED: 502, CHECKOUT_PAYMENT_MISMATCH: 502,
};
const boundaryStatuses = { FORBIDDEN: 403, BAD_REQUEST: 400, PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415, NOT_FOUND: 404 };

export function boundaryError(code) { return Object.assign(new Error(code), { code }); }

/** Single-user local authorization only. Production consumers must authenticate
 * their users and enforce merchant/order ownership before invoking this service.
 */
export function guardRequest(request, { config, csrfToken, mutation = false }) {
  const { headers } = request;
  const host = new URL(config.localOrigin).host;
  if (headers.host !== host ||
      (headers.origin !== undefined && headers.origin !== config.localOrigin) ||
      (headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(headers['sec-fetch-site']))) {
    throw boundaryError('FORBIDDEN');
  }
  if (mutation) {
    const token = headers['x-csrf-token'];
    if (headers.origin !== config.localOrigin || typeof token !== 'string' ||
        Buffer.byteLength(token) !== Buffer.byteLength(csrfToken) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(csrfToken))) throw boundaryError('FORBIDDEN');
  }
}

export function securityHeaders(config) {
  const sandbox = config.mode === 'sandbox';
  const sdkOrigin = sandbox ? new URL(config.sdkUrl).origin : '';
  const apiOrigin = sandbox ? new URL(config.apiBaseUrl).origin : '';
  const csp = [
    "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", `script-src 'self'${sandbox ? ` ${sdkOrigin}` : ''}`,
    "style-src 'self'", `connect-src 'self'${sandbox ? ` ${apiOrigin}` : ''}`,
    `frame-src ${sandbox ? [...new Set([sdkOrigin, apiOrigin])].join(' ') : "'none'"}`,
    "img-src 'self'",
  ].join('; ') + ';';
  return {
    'content-security-policy': csp, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  };
}

export async function readJsonBody(request, fields) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    request.resume();
    throw boundaryError('UNSUPPORTED_MEDIA_TYPE');
  }
  if (Number(request.headers['content-length']) > bodyLimit) {
    request.resume();
    throw boundaryError('PAYLOAD_TOO_LARGE');
  }
  const data = await new Promise((resolve, reject) => {
    let size = 0;
    let exceeded = false;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > bodyLimit) {
        exceeded = true;
        chunks.length = 0;
        reject(boundaryError('PAYLOAD_TOO_LARGE'));
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks, size)); });
    request.on('error', () => reject(boundaryError('BAD_REQUEST')));
    request.on('aborted', () => reject(boundaryError('BAD_REQUEST')));
  });
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { throw boundaryError('BAD_REQUEST'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw boundaryError('BAD_REQUEST');
  }
  return value;
}

/** Never forward exception messages, upstream payloads, or unknown codes. */
export function errorResponse(error) {
  const code = error?.code;
  if (httpErrors.has(code)) return { status: boundaryStatuses[code], body: { error: code } };
  if (Object.hasOwn(serviceStatuses, code)) return { status: serviceStatuses[code], body: { error: code } };
  return { status: 500, body: { error: 'INTERNAL_ERROR' } };
}
