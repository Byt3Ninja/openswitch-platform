import { createCheckoutController } from './checkout-controller.mjs';

const storageKey = 'openswitch.localOrderId';
const safeId = /^[A-Za-z0-9_-]{1,128}$/u;

/** Same-origin local API only. Browser-generated Origin complements server CSRF checks. */
export function createBrowserApi(fetchImpl = globalThis.fetch) {
  let csrfToken;
  async function request(url, payload) {
    try {
      const mutation = payload !== undefined;
      const response = await fetchImpl(url, {
        method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
        ...(mutation ? { headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch { throw new Error('LOCAL_REQUEST_FAILED'); }
  }
  function orderPath(id) {
    if (typeof id !== 'string' || !safeId.test(id)) throw new Error('INVALID_ORDER_ID');
    return `/api/orders/${id}`;
  }
  return {
    async config() {
      const config = await request('/api/config');
      csrfToken = config.csrfToken;
      const { csrfToken: _privateToken, ...publicConfig } = config;
      return publicConfig;
    },
    newOrder: catalogId => request('/api/orders', { catalogId }),
    checkout: id => request(`${orderPath(id)}/checkout`, {}),
    status: id => request(orderPath(id)),
    completeDemo: (id, outcome) => request(`${orderPath(id)}/demo-result`, { outcome }),
  };
}

/** Remote code loads only after explicit sandbox configuration and checkout start. */
export function createSdkLoader({ document = globalThis.document, window = globalThis.window, timeoutMs = 10_000 } = {}) {
  let loading;
  return async config => {
    if (config.mode !== 'sandbox') throw new Error('SDK_SANDBOX_ONLY');
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(fail, timeoutMs);
        function fail() {
          clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          script.remove?.();
          reject(new Error('SDK_UNAVAILABLE'));
        }
        script.async = true;
        script.src = config.sdkUrl;
        script.referrerPolicy = 'no-referrer';
        script.onerror = fail;
        script.onload = () => {
          clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          if (typeof window.Hyper !== 'function') { fail(); return; }
          resolve(window.Hyper);
        };
        document.head.append(script);
      });
    }
    try {
      const Hyper = await loading;
      const hyper = Hyper(config.publishableKey, { customBackendUrl: config.apiBaseUrl });
      if (typeof hyper?.widgets !== 'function' || typeof hyper?.confirmPayment !== 'function') throw new Error();
      return hyper;
    } catch { throw new Error('SDK_UNAVAILABLE'); }
  };
}

export function cleanReturnLocation(location, history) {
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);
}

export function saveOrderId(storage, order) {
  try {
    if (order && typeof order.id === 'string' && safeId.test(order.id)) storage.setItem(storageKey, order.id);
    else storage.removeItem(storageKey);
  } catch {}
}

export function readOrderId(storage) {
  try {
    const id = storage.getItem(storageKey);
    return typeof id === 'string' && safeId.test(id) ? id : null;
  } catch { return null; }
}

function formatAmount(amount, currency) {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return `${formatter.format(amount / (10 ** digits))} (${currency})`;
}

function statusText(state) {
  const prefix = state.mode === 'demo' ? 'Simulated: ' : '';
  if (state.busy === 'initializing') return 'Loading local configuration…';
  if (state.busy === 'starting') return `${prefix}preparing checkout…`;
  if (state.busy === 'confirming') return 'Confirming with the hosted SDK…';
  if (state.busy === 'simulating') return 'Saving a simulated result…';
  if (state.busy === 'refreshing' || state.busy === 'restoring') return `${prefix}checking backend order status…`;
  if (state.paid) return `${prefix}payment succeeded. Verified by the local backend.`;
  if (state.order?.phase === 'failed') return `${prefix}${state.order.status === 'cancelled' ? 'checkout cancelled' : 'payment failed'}.`;
  if (state.uncertain) return `${prefix}outcome unverified. Check status before another payment action.`;
  if (state.ready) return `${prefix}checkout ready.`;
  if (state.order?.phase === 'ready') return `${prefix}checkout session saved. The hosted form is unavailable; check status or contact your administrator.`;
  if (state.order?.phase === 'new') return `${prefix}order saved. Checkout has not started.`;
  return state.mode ? 'Select a catalog item to begin.' : 'Connecting to this local example…';
}

async function boot() {
  // Remove redirect parameters before any config/status request; none are trusted or stored.
  cleanReturnLocation(window.location, window.history);
  let storage;
  try { storage = window.sessionStorage; } catch {}
  const savedOrderId = readOrderId(storage);
  const returning = window.location.pathname === '/return';
  const byId = id => document.getElementById(id);
  const catalog = byId('catalog');
  const start = byId('start');
  const confirm = byId('confirm');
  const refresh = byId('refresh');
  let catalogSignature;
  let state;

  const controller = createCheckoutController({
    api: createBrowserApi(), sdkLoader: createSdkLoader(),
    render(view) {
      state = view;
      const signature = JSON.stringify(view.catalog);
      if (signature !== catalogSignature) {
        catalogSignature = signature;
        catalog.replaceChildren(...view.catalog.map(item => {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = `${item.label} — ${formatAmount(item.amount, item.currency)}`;
          return option;
        }));
      }
      if (view.selectedCatalogId) catalog.value = view.selectedCatalogId;
      catalog.disabled = !view.mode || view.submitting || (view.uncertain && !view.terminal);
      const selected = view.catalog.find(item => item.id === view.selectedCatalogId);
      byId('amount').textContent = selected ? formatAmount(selected.amount, selected.currency) : '—';
      byId('mode').textContent = view.mode === 'demo' ? 'Local demo · simulated' : view.mode === 'sandbox' ? 'Sandbox · hosted SDK' : 'Loading mode';
      byId('mode-description').textContent = view.mode === 'demo'
        ? 'Every result is simulated. No provider requests, remote SDK or card details are used.'
        : view.mode === 'sandbox'
          ? 'Configured sandbox checkout. Payment methods are supplied by the hosted SDK. Backend verification is required for every outcome.'
          : 'Waiting for the local server configuration.';
      byId('status').textContent = statusText(view);
      byId('status').dataset.tone = view.paid ? 'success' : view.uncertain || view.order?.phase === 'failed' ? 'attention' : 'neutral';
      byId('error').textContent = view.error ?? '';
      byId('error').hidden = !view.error;
      byId('order-details').hidden = !view.order;
      byId('order-id').textContent = view.order?.id ?? '';
      byId('payment-id').textContent = view.order?.paymentId ?? '';
      byId('backend-status').textContent = view.order ? `${view.mode === 'demo' ? 'Simulated · ' : ''}${view.order.status}` : '';
      if (view.order) saveOrderId(storage, view.order);
      byId('checkout-region').setAttribute('aria-busy', String(view.submitting));
      start.hidden = Boolean(view.order);
      start.disabled = !view.canStart;
      start.textContent = view.busy === 'starting' ? 'Preparing checkout…' : view.mode === 'sandbox' ? 'Prepare sandbox checkout' : 'Start simulated checkout';
      confirm.hidden = !(view.mode === 'sandbox' && view.order && !view.terminal);
      confirm.disabled = !view.canConfirm;
      confirm.textContent = view.busy === 'confirming' ? 'Confirming…' : 'Confirm sandbox payment';
      refresh.hidden = !view.order;
      refresh.disabled = !view.canRefresh;
      refresh.textContent = view.busy === 'refreshing' ? 'Checking status…' : 'Check order status';
      byId('demo-controls').hidden = !(view.mode === 'demo' && view.order && !view.terminal);
      for (const button of document.querySelectorAll('[data-outcome]')) button.disabled = !view.canCompleteDemo;
      byId('new-order').hidden = !view.terminal;
      byId('new-order').disabled = view.submitting;
      byId('payment-widget-region').hidden = view.mode !== 'sandbox' || !view.order || view.terminal;
      byId('recovery-note').hidden = !view.restored || view.mode !== 'sandbox' || view.terminal;
    },
  });
  catalog.addEventListener('change', () => {
    saveOrderId(storage, null);
    controller.selectCatalog(catalog.value);
  });
  start.addEventListener('click', () => controller.start());
  confirm.addEventListener('click', () => controller.confirm());
  refresh.addEventListener('click', () => controller.refreshStatus());
  for (const button of document.querySelectorAll('[data-outcome]')) {
    button.addEventListener('click', () => controller.completeDemo(button.dataset.outcome));
  }
  byId('new-order').addEventListener('click', () => {
    saveOrderId(storage, null);
    controller.selectCatalog(state.selectedCatalogId);
    catalog.focus();
  });
  await controller.initialize();
  if (savedOrderId) await controller.restoreOrder(savedOrderId);
  else if (returning) {
    byId('return-note').hidden = false;
    // No query-based identity/status fallback and no automatic creation on return.
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  boot().catch(() => {
    const error = document.getElementById('error');
    if (error) { error.hidden = false; error.textContent = 'This local checkout could not be loaded. Reload the page or check the local server.'; }
  });
}
