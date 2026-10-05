const safeId = /^[A-Za-z0-9_-]{1,128}$/u;
const terminalFailure = new Set(['failed', 'cancelled', 'cancelled_post_capture', 'expired']);
const phases = new Set(['new', 'creating', 'ready', 'uncertain', 'paid', 'failed']);
const publicFields = ['id', 'catalogId', 'amount', 'currency', 'paymentId', 'phase', 'status', 'simulated'];

/** The backend owns payment truth; SDK/browser results never fulfil an order. */
export function createCheckoutController({ api, sdkLoader, render }) {
  let config;
  let selectedCatalogId;
  let order = null;
  let epoch = 0;
  let busy = null;
  let error = null;
  let uncertain = false;
  let attempted = false;
  let restored = false;
  let widgetReady = false;
  let hyper;
  let widgets;
  let widget;

  function emit() {
    const paid = !uncertain && order?.phase === 'paid' && order.status === 'succeeded';
    const terminal = !uncertain && (paid || order?.phase === 'failed');
    render({
      mode: config?.mode, catalog: config?.catalog ?? [], selectedCatalogId,
      order: order ? { ...order } : null, paid: Boolean(paid), terminal: Boolean(terminal),
      ready: Boolean(order?.phase === 'ready' && (config.mode === 'demo' || widgetReady)),
      submitting: busy !== null, busy, error, uncertain, restored,
      canStart: Boolean(config && (!order || order.phase === 'new') && !busy && !uncertain),
      canConfirm: Boolean(config?.mode === 'sandbox' && widgetReady && order?.phase === 'ready' && !busy && !uncertain && !attempted),
      canCompleteDemo: Boolean(config?.mode === 'demo' && order?.phase === 'ready' && !busy && !uncertain),
      canRefresh: Boolean(order && !busy),
    });
  }

  function detach() {
    // Cleanup is best effort; a third-party exception must never reach browser output.
    try { widget?.unmount?.(); } catch {}
    widget = undefined;
    widgets = undefined;
    hyper = undefined;
    widgetReady = false;
  }

  function validate(view, expected = order, id = expected?.id) {
    const product = config.catalog.find(item => item.id === view?.catalogId);
    if (!view || !product || typeof view.id !== 'string' || typeof view.paymentId !== 'string' ||
        !safeId.test(view.id) || !safeId.test(view.paymentId) ||
        (id && view.id !== id) || view.amount !== product.amount || view.currency !== product.currency ||
        view.simulated !== (config.mode === 'demo') || !phases.has(view.phase) || typeof view.status !== 'string' ||
        (view.phase === 'paid') !== (view.status === 'succeeded') ||
        (view.phase === 'failed' && !terminalFailure.has(view.status)) ||
        (expected && ['id', 'catalogId', 'amount', 'currency', 'paymentId', 'simulated'].some(key => view[key] !== expected[key]))) {
      throw new Error('ORDER_MISMATCH');
    }
    return Object.fromEntries(publicFields.map(key => [key, view[key]]));
  }

  async function retrieve(token) {
    const current = order;
    const view = await api.status(current.id);
    if (token !== epoch) return;
    order = validate(view, current);
    uncertain = order.phase === 'uncertain' || order.phase === 'creating' ||
      (config.mode === 'sandbox' && order.phase === 'ready' && (attempted || restored));
    if (order.phase === 'paid' || order.phase === 'failed') detach();
  }

  async function run(operation, message, action) {
    if (busy) return;
    const token = epoch;
    busy = operation;
    error = null;
    emit();
    try { await action(token); }
    catch {
      if (token !== epoch) return;
      error = message;
      uncertain = true;
      // Never copy SDK/provider exceptions, results or client secrets into rendered state.
    } finally {
      if (token === epoch) { busy = null; emit(); }
    }
  }

  const controller = {
    async initialize() {
      if (config || busy) return;
      await run('initializing', 'Configuration could not be loaded. Reload this local page to reconnect.', async () => {
        const loaded = await api.config();
        if (!['demo', 'sandbox'].includes(loaded.mode) || !Array.isArray(loaded.catalog) || !loaded.catalog.length) {
          throw new Error('INVALID_CONFIG');
        }
        config = loaded;
        selectedCatalogId = config.catalog[0].id;
        uncertain = false;
      });
    },

    selectCatalog(id) {
      if (!config?.catalog.some(item => item.id === id)) return;
      epoch++;
      detach();
      selectedCatalogId = id;
      order = null;
      busy = null;
      error = null;
      uncertain = false;
      attempted = false;
      restored = false;
      emit();
    },

    async start() {
      if (!config || (order && order.phase !== 'new') || busy || uncertain) return;
      await run('starting', 'Checkout could not be prepared. Check order status before taking another payment action.', async token => {
        if (!order) {
          const created = await api.newOrder(selectedCatalogId);
          if (token !== epoch) return;
          const checkedOrder = validate(created, null);
          if (checkedOrder.catalogId !== selectedCatalogId) throw new Error('ORDER_MISMATCH');
          order = checkedOrder;
        }
        // Authoritatively recovered new orders have never prepared a payment.
        // Explicit preparation retains their identity and can mount a new form.
        restored = false;
        // Render the opaque order ID before starting the payment so return recovery can persist it.
        emit();
        const session = await api.checkout(order.id);
        if (token !== epoch) return;
        const checked = validate(session);
        if (checked.phase === 'paid') { await retrieve(token); return; }
        order = checked;
        uncertain = ['uncertain', 'creating'].includes(order.phase);
        if (config.mode === 'demo' || order.phase !== 'ready') return;
        if (typeof session.clientSecret !== 'string' || !session.clientSecret.trim()) throw new Error('SESSION_UNAVAILABLE');
        const loaded = await sdkLoader(config);
        if (token !== epoch) return;
        hyper = loaded;
        widgets = hyper.widgets({ clientSecret: session.clientSecret });
        widget = widgets.create('payment', { wallets: { walletReturnUrl: `${config.localOrigin}/return` } });
        widget.mount('#payment-widget');
        widgetReady = true;
      });
    },

    async confirm() {
      if (busy || uncertain || attempted || !widgetReady || order?.phase !== 'ready') return;
      attempted = true;
      await run('confirming', 'Payment outcome is uncertain. Check order status; do not submit again.', async token => {
        uncertain = true;
        emit();
        const result = await hyper.confirmPayment({
          widgets, confirmParams: { return_url: `${config.localOrigin}/return` }, redirect: 'if_required',
        });
        if (token !== epoch) return;
        if (result?.error) throw new Error('SDK_CONFIRMATION_FAILED');
        await retrieve(token);
      });
    },

    async refreshStatus() {
      if (!order || busy) return;
      await run('refreshing', 'Order status could not be verified. Check status again or reconcile with your administrator before another payment action.', retrieve);
    },

    async restoreOrder(id) {
      if (!config || busy || typeof id !== 'string' || !safeId.test(id)) return;
      epoch++;
      detach();
      order = null;
      attempted = false;
      restored = true;
      uncertain = true;
      await run('restoring', 'Saved order could not be verified. Ask your administrator to reconcile it before starting another payment.', async token => {
        const view = await api.status(id);
        if (token !== epoch) return;
        order = validate(view, null, id);
        selectedCatalogId = order.catalogId;
        uncertain = ['creating', 'uncertain'].includes(order.phase) || (config.mode === 'sandbox' && order.phase === 'ready');
      });
    },

    async completeDemo(outcome) {
      if (config?.mode !== 'demo' || busy || uncertain || order?.phase !== 'ready' ||
          !['succeeded', 'failed', 'cancelled'].includes(outcome)) return;
      await run('simulating', 'Simulated result could not be verified. Check the local order status.', async token => {
        const result = await api.completeDemo(order.id, outcome);
        if (token !== epoch) return;
        validate(result);
        await retrieve(token);
      });
    },
  };
  emit();
  return controller;
}
