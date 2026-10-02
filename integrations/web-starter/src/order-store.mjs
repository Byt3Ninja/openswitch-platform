import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** @typedef {{mode:'demo'|'sandbox', apiOrigin:string, profileId:string|null}} Namespace */
/** @typedef {{id:string, catalogId:string, amount:number, currency:string,
 * profileId:string|null, paymentId:string, returnUrl:string,
 * phase:'new'|'creating'|'uncertain'|'ready'|'paid'|'failed', paymentStatus?:string}} Order */

const phases = new Set(['new', 'creating', 'uncertain', 'ready', 'paid', 'failed']);
const paymentStatuses = new Set([
  'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'processing',
  'requires_customer_action', 'requires_merchant_action', 'requires_payment_method',
  'requires_confirmation', 'requires_capture', 'partially_captured',
  'partially_captured_and_capturable', 'partially_authorized_and_requires_capture',
  'partially_captured_and_processing', 'conflicted', 'expired', 'review',
]);
const identityFields = ['id', 'catalogId', 'amount', 'currency', 'profileId', 'paymentId', 'returnUrl'];
const orderFields = new Set([...identityFields, 'phase', 'paymentStatus']);

function storeError(code, message = code) {
  return Object.assign(new Error(message), { code });
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
function profile(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255 &&
    value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value);
}
function validNamespace(namespace) {
  try {
    const url = new URL(namespace.apiOrigin);
    return record(namespace) && Object.keys(namespace).length === 3 &&
      url.protocol === 'https:' && url.origin === namespace.apiOrigin &&
      ((namespace.mode === 'demo' && namespace.profileId === null) ||
        (namespace.mode === 'sandbox' && profile(namespace.profileId)));
  } catch { return false; }
}
function validOrder(order, namespace) {
  if (!record(order) || Object.keys(order).some(key => !orderFields.has(key)) ||
      !identifier(order.id) || !identifier(order.catalogId) || !identifier(order.paymentId) ||
      !Number.isSafeInteger(order.amount) || order.amount <= 0 ||
      typeof order.currency !== 'string' || !/^[A-Z]{3}$/u.test(order.currency) ||
      order.profileId !== namespace.profileId || !phases.has(order.phase) ||
      (order.paymentStatus !== undefined && !paymentStatuses.has(order.paymentStatus))) return false;
  try {
    const url = new URL(order.returnUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
        url.pathname !== '/return' || url.search || url.hash) return false;
  } catch { return false; }
  if (order.phase === 'paid' && order.paymentStatus !== 'succeeded') return false;
  if (order.phase !== 'paid' && order.paymentStatus === 'succeeded') return false;
  if (['new', 'creating'].includes(order.phase) && order.paymentStatus !== undefined) return false;
  if (order.phase === 'ready' && order.paymentStatus === undefined) return false;
  return true;
}
async function syncDirectory(directory) {
  const handle = await fs.open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } catch (error) {
    // Some platforms do not support syncing a directory handle.
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF'].includes(error.code)) throw error;
  } finally { await handle.close(); }
}

/** Exclusive single-process store. A stale .lock is deliberately never reclaimed.
 * Recovery: verify every process using this directory is stopped, back up the
 * directory, then manually remove only .lock. Keep state.json and reconcile
 * creating/uncertain identities; removing state can cause duplicate payments.
 * @returns {Promise<{get(id:string):Promise<Order|undefined>, save(order:Order):Promise<void>, close():Promise<void>}>}
 */
export async function openOrderStore({ directory, namespace }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) ||
      path.resolve(directory) === path.parse(directory).root || !validNamespace(namespace)) {
    throw storeError('STORE_INVALID_CONFIGURATION');
  }
  namespace = { mode: namespace.mode, apiOrigin: namespace.apiOrigin, profileId: namespace.profileId };
  const statePath = path.join(directory, 'state.json');
  const lockPath = path.join(directory, '.lock');
  let lock;
  const token = randomUUID();
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw storeError('STORE_UNSAFE_PATH');
    await fs.chmod(directory, 0o700);
    lock = await fs.open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await lock.writeFile(JSON.stringify({ pid: process.pid, token }));
    await lock.sync();
    await syncDirectory(directory);
  } catch (error) {
    if (lock) {
      await lock.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    }
    if (error.code === 'EEXIST' || error.code === 'ELOOP') {
      throw storeError('STORE_LOCKED', 'State ownership is locked. Verify all processes using this directory are stopped, make a backup, then manually remove only .lock; preserve state.json and reconcile existing payment IDs.');
    }
    if (error.code?.startsWith('STORE_')) throw error;
    throw storeError('STORE_OPEN_FAILED');
  }

  async function readState(allowMissing = false) {
    let handle;
    let state;
    try {
      handle = await fs.open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 16 * 1024 * 1024) throw storeError('STORE_CORRUPT');
      await handle.chmod(0o600);
      state = JSON.parse(await handle.readFile('utf8'));
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return undefined;
      throw storeError('STORE_CORRUPT');
    } finally { await handle?.close(); }
    if (!record(state) || Object.keys(state).length !== 3 || state.version !== 1 ||
        !validNamespace(state.namespace) || !record(state.orders)) throw storeError('STORE_CORRUPT');
    if (state.namespace.mode !== namespace.mode || state.namespace.apiOrigin !== namespace.apiOrigin ||
        state.namespace.profileId !== namespace.profileId) throw storeError('STORE_NAMESPACE_MISMATCH');
    if (Object.entries(state.orders).some(([id, order]) => !validOrder(order, namespace) || id !== order.id)) {
      throw storeError('STORE_CORRUPT');
    }
    return state;
  }

  async function writeState(state) {
    const temporary = path.join(directory, `.state-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, statePath);
      await syncDirectory(directory);
    } catch {
      throw storeError('STORE_WRITE_FAILED');
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw storeError('STORE_WRITE_FAILED'); });
    }
  }

  try {
    if (!await readState(true)) await writeState({ version: 1, namespace, orders: {} });
  } catch (error) {
    await lock.close();
    await fs.unlink(lockPath);
    throw error;
  }

  let queue = Promise.resolve();
  let closed = false;
  let closing;
  function enqueue(operation) {
    if (closed) return Promise.reject(storeError('STORE_CLOSED'));
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  return {
    get(id) {
      return enqueue(async () => {
        if (!identifier(id)) throw storeError('STORE_INVALID_ORDER');
        const state = await readState();
        return Object.hasOwn(state.orders, id) ? structuredClone(state.orders[id]) : undefined;
      });
    },
    save(order) {
      // Snapshot input before awaiting any operation; callers cannot alter queued writes.
      if (!validOrder(order, namespace)) return Promise.reject(storeError('STORE_INVALID_ORDER'));
      const snapshot = structuredClone(order);
      return enqueue(async () => {
        const state = await readState();
        const existing = Object.hasOwn(state.orders, snapshot.id) ? state.orders[snapshot.id] : undefined;
        if (existing && identityFields.some(key => existing[key] !== snapshot[key])) throw storeError('STORE_ORDER_CONFLICT');
        Object.defineProperty(state.orders, snapshot.id, { value: snapshot, enumerable: true, configurable: true, writable: true });
        await writeState(state);
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = queue.then(async () => {
        await lock.close();
        const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        if (owner.token !== token) throw storeError('STORE_LOCK_CHANGED');
        await fs.unlink(lockPath);
        await syncDirectory(directory);
      }).catch(() => { throw storeError('STORE_CLOSE_FAILED'); });
      return closing;
    },
  };
}
