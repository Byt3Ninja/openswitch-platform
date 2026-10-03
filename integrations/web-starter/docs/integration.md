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

Client secrets stay in server/browser memory; only an opaque local order ID enters sessionStorage. On reload/return, status is checked without creating another payment. A restored sandbox checkout cannot silently reconstruct its old hosted form. Use backend reconciliation and an explicitly designed session-resumption policy. Changing catalog values, mode, API origin or profile against existing state can produce a conflict; use deliberate separate state namespaces rather than rewriting records to make them match.

## Customer production backend

Replace the local file store and sample server with the customer's authenticated backend and durable transactional order store. Authenticate create, status and return recovery; authorize the user against that order and its merchant/profile; protect mutations with appropriate CSRF/session controls, rate limits and HTTPS. Derive prices, currency, tax and allowed return locations on the server. Persist intended payment identity atomically before sending a financial request and serialize/deduplicate order actions across instances. The local process lock is not distributed coordination.

Retrieve authoritatively using server credentials, verify expected payment/order ID, profile, amount and currency, and fulfil once in a durable transaction only when the confirmed business status permits it. Redirect parameters, browser success and webhook payloads alone cannot establish paid status. Bind return recovery to the authenticated order; do not expose arbitrary payment lookup by ID. Apply a separately reviewed replay-safe signed webhook receiver only after [the deployed signing contract](webhooks.md) is verified.

Refunds, manual capture, voids, disputes, payouts and off-session flows are not implemented here. Treat refunds as a separately authorized and tested capability with supported API/connector semantics, stable identity, reconciliation and negative cases. Supported upstream APIs do not establish that a provider/account is ready. Production deployment, provider tests and migrations are outside this package's delivery.
