import http from 'node:http';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { publicConfig } from './config.mjs';
import { boundaryError, guardRequest, securityHeaders, readJsonBody, errorResponse } from './http-boundary.mjs';

const staticPaths = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/return', ['index.html', 'text/html; charset=utf-8']],
  ['/checkout.mjs', ['checkout.mjs', 'text/javascript; charset=utf-8']],
  ['/checkout-controller.mjs', ['checkout-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const defaultStaticDir = fileURLToPath(new URL('../public/', import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
function orderView(order, clientSecret = false) {
  const result = {};
  for (const field of ['id', 'catalogId', 'amount', 'currency', 'paymentId', 'phase', 'status', 'simulated']) {
    result[field] = order[field];
  }
  if (clientSecret && typeof order.clientSecret === 'string') result.clientSecret = order.clientSecret;
  return result;
}
async function serveStatic(response, staticDir, filename, contentType) {
  let handle;
  try {
    const root = await fs.lstat(staticDir);
    if (!root.isDirectory() || root.isSymbolicLink()) throw boundaryError('NOT_FOUND');
    const file = path.join(staticDir, filename);
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw boundaryError('NOT_FOUND');
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile()) throw boundaryError('NOT_FOUND');
    const data = await handle.readFile();
    response.writeHead(200, { 'content-type': contentType });
    response.end(data);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw boundaryError('NOT_FOUND');
    throw error;
  } finally { await handle?.close(); }
}

/** Fixed application assets and guarded local JSON routes; no webhook receiver.
 * The caller must bind the returned server to 127.0.0.1, as main.mjs does.
 */
export function createServer({ config, service, staticDir = defaultStaticDir }) {
  const csrfToken = randomBytes(32).toString('hex');
  const headers = securityHeaders(config);
  const server = http.createServer(async (request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    try {
      const mutation = !['GET', 'HEAD'].includes(request.method);
      guardRequest(request, { config, csrfToken, mutation });
      // Compare the raw path; URL normalization must never convert a traversal
      // request into an allowlisted file. Query values have no payment authority.
      const route = request.url?.split('?')[0];
      if (typeof route !== 'string' || !route.startsWith('/') || /[%\\#]/u.test(route)) throw boundaryError('NOT_FOUND');
      if (request.method === 'GET' && route === '/api/config') {
        return json(response, 200, { ...publicConfig(config), csrfToken });
      }
      // Browsers request this automatically; an empty response needs no asset
      // discovery and does not expand the static file or CSP allowlists.
      if (request.method === 'GET' && route === '/favicon.ico') {
        response.writeHead(204);
        return response.end();
      }
      if (request.method === 'GET' && staticPaths.has(route)) {
        const [filename, contentType] = staticPaths.get(route);
        return await serveStatic(response, staticDir, filename, contentType);
      }
      if (request.method === 'POST' && route === '/api/orders') {
        const body = await readJsonBody(request, ['catalogId']);
        if (typeof body.catalogId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(body.catalogId)) throw boundaryError('BAD_REQUEST');
        return json(response, 201, orderView(await service.newOrder(body.catalogId)));
      }
      const match = /^\/api\/orders\/([A-Za-z0-9_-]{1,128})(?:\/(checkout|demo-result))?$/u.exec(route);
      if (match) {
        const [, id, action] = match;
        if (request.method === 'GET' && !action) return json(response, 200, orderView(await service.status(id)));
        if (request.method === 'POST' && action === 'checkout') {
          await readJsonBody(request, []);
          return json(response, 200, orderView(await service.start(id), config.mode === 'sandbox'));
        }
        if (request.method === 'POST' && action === 'demo-result' && config.mode === 'demo') {
          const body = await readJsonBody(request, ['outcome']);
          if (!['succeeded', 'failed', 'cancelled'].includes(body.outcome)) throw boundaryError('BAD_REQUEST');
          return json(response, 200, orderView(await service.completeDemo(id, body.outcome)));
        }
      }
      throw boundaryError('NOT_FOUND');
    } catch (error) {
      request.resume();
      if (!response.headersSent) {
        const { status, body } = errorResponse(error);
        json(response, status, body);
      } else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
