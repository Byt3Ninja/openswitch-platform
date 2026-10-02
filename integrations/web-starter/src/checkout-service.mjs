import { randomUUID } from 'node:crypto';

const statuses = new Set([
  'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'processing',
  'requires_customer_action', 'requires_merchant_action', 'requires_payment_method',
  'requires_confirmation', 'requires_capture', 'partially_captured',
  'partially_captured_and_capturable', 'partially_authorized_and_requires_capture',
  'partially_captured_and_processing', 'conflicted', 'expired', 'review',
]);
const failedStatuses = new Set(['failed', 'cancelled', 'cancelled_post_capture', 'expired']);
const outcomes = new Set(['succeeded', 'failed', 'cancelled']);

function checkoutError(code) {
  return Object.assign(new Error(code), { code });
}

/**
 * Public views are flat {id,catalogId,amount,currency,paymentId,phase,status,simulated}.
 * Only start() may additionally return clientSecret, and only for sandbox sessions.
 * returnUrl/profileId stay internal; status() never returns a client secret.
 */
export function createCheckoutService({ config, store, api }) {
  if (!['demo', 'sandbox'].includes(config.mode)) throw checkoutError('CHECKOUT_INVALID_CONFIGURATION');
  const demo = config.mode === 'demo';
  const profileId = demo ? null : config.profileId;
  const pending = new Map();
  const secrets = new Map();

  function serialize(id, operation) {
    const previous = pending.get(id) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    pending.set(id, result);
    result.finally(() => { if (pending.get(id) === result) pending.delete(id); }).catch(() => {});
    return result;
  }
  function view(order, clientSecret) {
    return {
      id: order.id, catalogId: order.catalogId, amount: order.amount, currency: order.currency,
      paymentId: order.paymentId, phase: order.phase,
      status: order.paymentStatus ?? (order.phase === 'new' ? 'not_created' : order.phase),
      simulated: demo,
      ...(!demo && clientSecret ? { clientSecret } : {}),
    };
  }
  async function getOrder(id) {
    const order = await store.get(id);
    if (!order) throw checkoutError('CHECKOUT_ORDER_NOT_FOUND');
    const product = config.catalog.find(item => item.id === order.catalogId);
    if (!product || product.amount !== order.amount || product.currency !== order.currency ||
        order.profileId !== profileId || order.returnUrl !== config.returnUrl) {
      throw checkoutError('CHECKOUT_ORDER_CONFLICT');
    }
    return order;
  }
  function match(order, payment, creating = false) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment) ||
        payment.paymentId !== order.paymentId || payment.profileId !== (demo ? undefined : order.profileId) ||
        payment.amount !== order.amount || payment.currency !== order.currency || !statuses.has(payment.status) ||
        (demo ? payment.simulated !== true || payment.clientSecret !== undefined : payment.simulated === true) ||
        (payment.clientSecret !== undefined && (typeof payment.clientSecret !== 'string' || !payment.clientSecret.trim())) ||
        (!demo && creating && !payment.clientSecret)) throw checkoutError('CHECKOUT_PAYMENT_MISMATCH');
    if (!demo && payment.clientSecret) secrets.set(order.id, payment.clientSecret);
  }
  async function apply(order, status) {
    const updated = {
      ...order, paymentStatus: status,
      phase: status === 'succeeded' ? 'paid' : failedStatuses.has(status) ? 'failed' : 'ready',
    };
    await store.save(updated);
    if (updated.phase === 'paid' || updated.phase === 'failed') secrets.delete(order.id);
    return updated;
  }
  async function reconcile(order) {
    if (demo) {
      // The simulator has no durable API history; recovered sessions are synthesized
      // entirely from their persisted local identity and explicitly labeled outcome.
      if (order.phase === 'creating' || order.phase === 'uncertain') {
        return apply(order, order.paymentStatus ?? 'requires_payment_method');
      }
      return order;
    }
    let payment;
    try {
      payment = await api.retrieve(order.paymentId);
    } catch {
      if (order.phase !== 'paid' && order.phase !== 'failed') await store.save({ ...order, phase: 'uncertain' });
      throw checkoutError('CHECKOUT_RECONCILIATION_REQUIRED');
    }
    match(order, payment);
    return apply(order, payment.status);
  }
  return {
    async newOrder(catalogId) {
      const product = config.catalog.find(item => item.id === catalogId);
      if (!product) throw checkoutError('CHECKOUT_UNKNOWN_PRODUCT');
      const order = {
        id: `order_${randomUUID()}`, catalogId: product.id, amount: product.amount, currency: product.currency,
        profileId, paymentId: `pay_${randomUUID()}`, returnUrl: config.returnUrl, phase: 'new',
      };
      await store.save(order);
      return view(order);
    },
    start(id) {
      return serialize(id, async () => {
        let order = await getOrder(id);
        if (order.phase !== 'new') {
          // A definitive creation rejection never starts another upstream payment.
          if (order.phase !== 'failed') order = await reconcile(order);
          const secret = secrets.get(id);
          if (!demo && order.phase === 'ready' && !secret) throw checkoutError('CHECKOUT_SESSION_UNAVAILABLE');
          return view(order, secret);
        }
        order = { ...order, phase: 'creating' };
        await store.save(order);
        let payment;
        try {
          payment = await api.create({ ...order, profileId: demo ? undefined : order.profileId });
          match(order, payment, true);
        } catch (error) {
          const uncertain = error.code === 'CHECKOUT_PAYMENT_MISMATCH' || error.ambiguous !== false;
          await store.save(uncertain ? { ...order, phase: 'uncertain' } :
            { ...order, phase: 'failed', paymentStatus: 'failed' });
          throw checkoutError(uncertain ? 'CHECKOUT_UNCERTAIN' : 'CHECKOUT_FAILED');
        }
        // Even a create response saying succeeded cannot fulfil a real order.
        if (!demo && payment.status === 'succeeded') {
          order = await reconcile(order);
        } else {
          order = await apply(order, payment.status);
        }
        return view(order, secrets.get(id));
      });
    },
    status(id) {
      return serialize(id, async () => {
        let order = await getOrder(id);
        if (order.phase !== 'new' && order.phase !== 'failed') order = await reconcile(order);
        return view(order);
      });
    },
    completeDemo(id, outcome) {
      return serialize(id, async () => {
        if (!demo) throw checkoutError('CHECKOUT_DEMO_ONLY');
        if (!outcomes.has(outcome)) throw checkoutError('CHECKOUT_INVALID_OUTCOME');
        const order = await getOrder(id);
        if (order.phase === 'new') throw checkoutError('CHECKOUT_NOT_STARTED');
        if (order.phase === 'paid' || order.phase === 'failed') {
          if (order.paymentStatus !== outcome) throw checkoutError('CHECKOUT_DEMO_FINAL');
          return view(order);
        }
        return view(await apply(order, outcome));
      });
    },
  };
}
