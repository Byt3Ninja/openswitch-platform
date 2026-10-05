function demoError(code) {
  return Object.assign(new Error(code), { code, ambiguous: false });
}

/** Credential-free in-memory sessions. Demo completion and restart recovery
 * belong to the durable checkout service, never to this adapter.
 * @returns {import('./payment-api.mjs').PaymentApi}
 */
export function createDemoApi() {
  const payments = new Map();
  return {
    async create(order) {
      if (!order || typeof order.paymentId !== 'string' || !order.paymentId.trim() ||
          !Number.isSafeInteger(order.amount) || order.amount <= 0 ||
          typeof order.currency !== 'string' || !/^[A-Z]{3}$/u.test(order.currency) ||
          (order.profileId !== undefined && (typeof order.profileId !== 'string' || !order.profileId.trim()))) {
        throw demoError('API_INVALID_REQUEST');
      }
      const existing = payments.get(order.paymentId);
      if (existing && (existing.profileId !== order.profileId || existing.amount !== order.amount || existing.currency !== order.currency)) {
        throw demoError('API_INVALID_REQUEST');
      }
      if (!existing) {
        payments.set(order.paymentId, {
          paymentId: order.paymentId,
          profileId: order.profileId,
          amount: order.amount,
          currency: order.currency,
          status: 'requires_payment_method',
          simulated: true,
        });
      }
      return { ...payments.get(order.paymentId) };
    },
    async retrieve(paymentId) {
      const payment = payments.get(paymentId);
      if (!payment) throw demoError('API_NOT_FOUND');
      return { ...payment };
    },
  };
}
