# Integration contract

The customer/application backend owns its order, calls the supported OpenSwitch v1 payment API, and gives the browser only the session needed by the hosted SDK. OpenSwitch routes to the configured connector/provider. No provider branch or fixed method list is required in the generic checkout.

## Implemented local flow

The server reads `catalog.example.json`: unique product IDs, labels, positive safe integer amounts in currency minor units, and three-letter uppercase currency codes. The browser submits only a catalog ID. The backend selects amount, currency, profile and return URL, generates stable order/payment IDs, and persists their association before any network call. For a two-decimal currency, 1250 means 12.50; do not assume every currency has two decimals. Validate currency exponent, supported amount bounds and provider support separately for the actual deployment.

| Local route | Responsibility |
| --- | --- |
| `GET /api/config` | Public allowlisted config and local CSRF token |
| `POST /api/orders` with `{ "catalogId": "demo-usd" }` | Persist server-owned order identity |
| `POST /api/orders/{id}/checkout` with `{}` | Prepare the existing order once; sandbox session may include a client secret |
| `GET /api/orders/{id}` | Retrieve/reconcile backend status, with no client secret in the response |
| `POST /api/orders/{id}/demo-result` | Simulated outcome, available only in demo |
| `GET /return` | Serve the checkout page; discard query/fragment claims and recover the saved local order ID |

Local mutations require the exact Origin and `x-csrf-token` from `/api/config`; the browser adapter supplies them. Use `127.0.0.1`, not a different hostname. `PORT` defaults to 4242; `LOCAL_ORIGIN`, if provided, must be `http://127.0.0.1:<PORT>` exactly. `RETURN_URL` is rejected. Server order views expose `id`, `catalogId`, `amount`, `currency`, `paymentId`, `phase`, `status`, and `simulated`. Only sandbox checkout preparation may additionally expose `clientSecret`.

A provider's cross-site return is allowed only as an exact-Host `GET /return` with Fetch Metadata `cross-site`, `navigate`, and `document`. A supplied Origin still must match the local origin. This serves only the static page: it reflects no query values and performs no payment operation. APIs/config, mutations, other paths, iframe/subresource requests and other methods retain the local guards. The browser then removes return query/fragment claims and retrieves only its saved local order identity. The browser's automatic `GET /favicon.ico` receives an empty 204 response under the same guards and CSP.

## Sandbox payment API and hosted SDK

`API_BASE_URL` must be an HTTPS origin without credentials, query or fragment. The default is `https://api.openswitch.io`. `SDK_URL` defaults to `https://sdk.openswitch.io/HyperLoader.js` and requires HTTPS without credentials, query or fragment. Defaults are addresses, not test-mode proof. `API_KEY` is server-only; `PUBLISHABLE_KEY` can initialize the browser SDK. `PROFILE_ID` selects the verified profile inside the merchant scope available to the API key. Ordinary merchant keys may cover multiple profiles: passing a profile is not an authorization boundary. Use separate credentials/state where appropriate and enforce customer/profile ownership on the backend.

The API adapter sends `api-key` authentication and JSON to `POST /payments`, using the persisted `payment_id`, catalog `amount`/`currency`, verified `profile_id`, `capture_method: "automatic"`, `confirm: false` and server-owned `return_url`. It retrieves using `GET /payments/{payment_id}`. It validates payment ID, profile, amount, currency and status; malformed or mismatched creation outcomes are uncertain. Calls are bounded to ten seconds with no automatic financial retry and no generic idempotency-header guarantee.

The browser loads the configured hosted loader only after sandbox preparation, then reuses the standard interface:

```js
const hyper = Hyper(publishableKey, { customBackendUrl: apiBaseUrl });
const widgets = hyper.widgets({ clientSecret });
const payment = widgets.create('payment', {
  wallets: { walletReturnUrl: `${localOrigin}/return` }
});
payment.mount('#payment-widget');
await hyper.confirmPayment({
  widgets,
  confirmParams: { return_url: `${localOrigin}/return` },
  redirect: 'if_required'
});
// Then ask the backend to retrieve and match the saved payment.
```

This is the interface used by the reference code and offline contract tests, not proof of compatibility with every hosted deployment. The [compatibility record](compatibility.md) distinguishes source expectations from real browser/provider acceptance. React, Vue or other applications can load the same hosted loader, mount into an owned DOM node and unmount the payment element on cleanup; bind handlers and duplicate-submit guards to the component lifecycle. No untested framework npm package or version pin is required by this guide.

## Uncertain outcomes and recovery

The backend serializes operations for an order and records `creating` before a create call. A timeout, ambiguous HTTP failure or invalid response leaves an uncertain outcome. Disable repeat submission; retrieve the persisted payment ID and reconcile before another financial action. A failed retrieval or 404 after an uncertain create is not permission to create a replacement. Escalate unresolved outcomes to an operator. Browser confirmation results and redirects never authorize fulfilment.

Client secrets stay in server/browser memory; only an opaque local order ID enters sessionStorage. On reload/return, status is checked without creating another payment. If the backend confirms the saved order is still `new` (no payment preparation ever started), the user may explicitly prepare that same order/payment identity. Duplicate clicks do not replace the order. Recovered `creating`/`uncertain` orders remain restricted to reconciliation, and an already-prepared sandbox checkout cannot silently reconstruct its old hosted form. Use backend reconciliation and an explicitly designed session-resumption policy. Changing catalog values, mode, API origin or profile against existing state can produce a conflict; use deliberate separate state namespaces rather than rewriting records to make them match.

## Local state recovery and capacity

The file store is for a small single-process local example. It claims `<state-directory>/.lock` and never automatically reclaims a stale lock. After an abrupt termination, recover using this procedure:

1. Identify the exact state directory from the effective `STATE_DIR` (process environment overrides the local `.env`). Sandbox requires this absolute path. If demo has no override, resolve the default using `node --input-type=module -e 'import os from "node:os"; import path from "node:path"; console.log(path.join(os.tmpdir(), "openswitch-web-starter-demo"))'` in the same runtime environment.
2. Stop and verify all processes using that directory, including any other terminal/session running the starter. Inspect `.lock` locally for its recorded PID and check that process and its owner. A PID alone can be reused and does not establish staleness. If ownership is uncertain, stop and investigate; never reclaim a lock belonging to a running process.
3. Back up the entire confirmed state directory to a separate private location while all owners are stopped. Keep its restrictive permissions and treat the backup as private payment metadata.
4. Only after those checks, manually remove that directory's stale `.lock`. Preserve `state.json` exactly. Never delete/reset state, remove active locks or switch sandbox state directories to bypass recovery: losing the mapping can cause duplicate payments.
5. Restart with the same mode, API origin, profile, catalog terms and state directory. Reconcile existing `creating`/`uncertain` payment IDs through backend status retrieval. A not-found or failed retrieval does not permit a replacement create; escalate unresolved outcomes to the administrator.

The serialized UTF-8 `state.json` has a **16 MiB (16,777,216 bytes)** read/write ceiling. There is no automatic retention or record deletion. Writes exceeding that ceiling are rejected before replacing the last readable state. Monitor its size during extended local use and stop new payment work before reaching capacity. A rejected write has a safe generic HTTP error; it is not proof that a prior provider request failed. If recording a larger status fails after an ambiguous create, the original durable `creating` identity survives; restart/reconciliation still targets that payment and never creates a replacement. Reconciliation can also fail to persist while at capacity. Back up the state and have an administrator preserve/migrate the mappings into the customer's reviewed durable store before resuming work. Do not delete orders or reset sandbox state to make space. Reclaiming a stale lock does not resolve capacity.

## Customer production backend

Replace the local file store and sample server with the customer's authenticated backend and durable transactional order store. Authenticate create, status and return recovery; authorize the user against that order and its merchant/profile; protect mutations with appropriate CSRF/session controls, rate limits and HTTPS. Derive prices, currency, tax and allowed return locations on the server. Persist intended payment identity atomically before sending a financial request and serialize/deduplicate order actions across instances. The local process lock is not distributed coordination.

Retrieve authoritatively using server credentials, verify expected payment/order ID, profile, amount and currency, and fulfil once in a durable transaction only when the confirmed business status permits it. Redirect parameters, browser success and webhook payloads alone cannot establish paid status. Bind return recovery to the authenticated order; do not expose arbitrary payment lookup by ID. Apply a separately reviewed replay-safe signed webhook receiver only after [the deployed signing contract](webhooks.md) is verified.

Refunds, manual capture, voids, disputes, payouts and off-session flows are not implemented here. Treat refunds as a separately authorized and tested capability with supported API/connector semantics, stable identity, reconciliation and negative cases. Supported upstream APIs do not establish that a provider/account is ready. Production deployment, provider tests and migrations are outside this package's delivery.
