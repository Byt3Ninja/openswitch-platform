# Generic OpenSwitch SDK Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a generic, runnable customer integration starter and guide in one versioned ZIP, without provider-specific checkout logic.

**Architecture:** Use the existing hosted Hyperswitch JavaScript SDK directly. A loopback-only example merchant server owns orders, creates payment sessions and verifies status through the supported OpenSwitch API. An explicit offline adapter supports credential-free demonstrations; real sandbox execution is separately enabled and verified.

**Tech Stack:** Node.js 24 LTS, JavaScript ES modules, built-in HTTP/fetch/crypto/fs/node:test, plain HTML/CSS and the hosted SDK. No runtime npm dependencies or new SDK facade. Node 24 is listed as LTS in the [official release table](https://nodejs.org/en/about/previous-releases), checked 2026-10-02. Record the actual tested patch version at release; do not claim Node 24 validation from the currently available Node 26 runtime.

**Spec:** `docs/superpowers/specs/2026-10-02-generic-sdk-package-design.md` (approved).

## Global constraints

- Owner: OpenSwitch-platform. Classification D/A plus documentation. Upstream core changes: NONE.
- Use existing worktree `.worktrees/sandbox-kashier-easykash`; preserve unrelated `deployment/coolify/production/sdk/` files. No extra worktree, Rust build, submodule change or production mutation.
- Generic integration has no fixed PSP, merchant ID, profile ID, EUR amount or payment-method list. WQ3 is optional configuration only.
- Default offline mode makes no provider calls, loads no remote SDK and collects no card data. Prominently label every simulated status.
- No live mode. Sandbox needs deliberate configuration and administrator confirmation of mode, endpoint, routing and credentials; names and prefixes are not proof.
- Bind to `127.0.0.1`; enforce Host/Origin and local CSRF protections. This is not a public-production backend.
- Persist order/payment identity before network calls. No automatic financial retry and no claim of generic header idempotency.
- Use authoritative retrieval and order matching. Never fulfil from redirects or browser results. No accepting webhook route until the actual signing contract is verified.
- Secrets and client secrets never enter logs, public config, release archives or error responses. Keep API client secrets in memory; retrieve when necessary rather than persist them.
- Existing SDK serving, immutable-version and end-to-end/webhook gaps remain explicit platform blockers.

## Review focus

1. URL tricks and redirects must not leak the merchant key: reject credentials/query/fragment in configured URLs and disallow API redirects (Tasks 1–2).
2. Concurrent processes, interrupted writes and restart must not create a second payment for the same order (Task 3).
3. Cross-origin local requests, DNS rebinding, traversal and oversized bodies must not expose secrets or trigger payments (Task 4).
4. Upstream success with wrong ID/profile/amount/currency must never mark an order paid (Tasks 2–3).
5. Stale UI responses, double-clicks and a release directory containing a real environment file must not cause duplicate operations or ship credentials (Tasks 5–6).

## File map and shared contracts

All implementation paths below are relative to `integrations/web-starter/` in the platform worktree. Existing files outside that directory change only for the approved spec/plan and one README link.

| Files | Responsibility |
|---|---|
| `package.json`, `.nvmrc`, `.gitignore`, `config.example.env`, `catalog.example.json` | Commands, supported runtime, safe defaults |
| `src/config.mjs` | Validate configuration and derive public subset |
| `src/payment-api.mjs`, `src/demo-api.mjs` | Real API and offline implementations of the same contract |
| `src/order-store.mjs`, `src/checkout-service.mjs` | Durable sample orders and financial-operation state |
| `src/http-boundary.mjs`, `src/server.mjs`, `src/main.mjs` | Local HTTP, CSRF, safe static serving and startup |
| `public/index.html`, `public/checkout.mjs`, `public/checkout-controller.mjs`, `public/styles.css` | Generic browser checkout |
| `test/*.test.mjs`, `test/support/fake-api.mjs` | Offline unit/integration tests and local fake API |
| `docs/*.md`, `README.md`, `examples/wq3-paypal/README.md` | Generic integration, security, validation and optional example |
| `scripts/package.mjs`, `release-files.json` | Allowlisted ZIP staging and manifests |

Use documented JSDoc shapes rather than a TypeScript build step:

- `CatalogItem = {id, label, amount, currency}`; amount is a positive safe integer in minor units; currency is three uppercase letters, not a provider-support guarantee.
- `Order = {id, catalogId, amount, currency, profileId, paymentId, returnUrl, phase}`. Phase: `new | creating | uncertain | ready | paid | failed`. IDs are generated server-side with built-in crypto; returnUrl comes from validated local configuration.
- `Payment = {paymentId, profileId, amount, currency, status, clientSecret?}`; never expose raw provider bodies.
- `PaymentApi.create(order): Promise<Payment>` and `.retrieve(paymentId): Promise<Payment>`; reject with sanitized `{code, ambiguous}` errors, not raw response bodies.
- `CheckoutService.newOrder(catalogId)`, `.start(orderId)`, `.status(orderId)` return public order/session views. `start` may return the payment-scoped client secret; `status` never does.
- `createServer({config, service}): http.Server`; `main.mjs` loads configuration and binds, while tests call the factory on an ephemeral loopback port.

## Task 1 — Configuration and safe startup contract

**Files:** Create package/config files, `src/config.mjs`, `test/config.test.mjs`.

**Interfaces:** `loadConfig(env, catalog): Config`; `publicConfig(config)` returns only mode, SDK/API origins, publishable key, local origin and catalog. Config additionally holds API key, profile ID, absolute state directory, timeout and port.

- [ ] Write table-driven tests using `node:test` and `node:assert/strict`:

```javascript
assert.equal(loadConfig({}, catalog).mode, 'demo');
assert.throws(() => loadConfig({ MODE: 'live' }, catalog));
assert.throws(() => loadConfig({ MODE: 'sandbox' }, catalog));
assert.equal('apiKey' in publicConfig(validConfig), false);
assert.throws(() => loadConfig({ ...sandboxEnv, API_BASE_URL: 'https://user:pass@api.openswitch.io' }, catalog));
```

  Define `catalog`, `validConfig` and `sandboxEnv` inside the test with dummy credentials, never actual account data. Add cases for query/fragment URLs, invalid ports, zero/unsafe/fractional amounts, duplicate catalog IDs, invalid currency and state path inside the source tree.
- [ ] Run `node --test test/config.test.mjs`; confirm intended failures before implementation.
- [ ] Implement configuration: MODE defaults to demo; PORT defaults to 4242. Sandbox requires API_KEY, PUBLISHABLE_KEY, PROFILE_ID and `SANDBOX_CONFIRMED=yes`. Default API/SDK URLs are OpenSwitch's existing HTTPS origins, overridable only by valid HTTPS URLs. Reject arbitrary return URLs: derive local return from validated local origin. State path must be explicitly outside packaged source for sandbox; demo may use an OS temp directory. Timeout 10 seconds; no retries. `catalog.example.json` provides two clearly simulated products (USD and GBP); amounts stay in that file, not checkout logic.
- [ ] Add package scripts `start: node src/main.mjs`, `test: node --test`, `package: node scripts/package.mjs`; `.nvmrc` is 24, engines `>=24 <25`, private package, version `0.1.0`. Ignore `.env`, state and release artifacts. A missing optional `.env` must not prevent demo startup; never load arbitrary files from HTTP requests.
- [ ] Run target tests then `npm test`; commit only these files as `feat: define safe generic starter configuration`.

## Task 2 — Generic payment API and offline adapter

**Files:** Create `src/payment-api.mjs`, `src/demo-api.mjs`, `test/payment-api.test.mjs`, `test/support/fake-api.mjs`.

**Interfaces:** `createPaymentApi({baseUrl, apiKey, timeoutMs, fetchImpl}): PaymentApi`; `createDemoApi(): PaymentApi`. Dependency injection is for local fake HTTP tests; production configuration still enforces HTTPS.

- [ ] Write tests using a local fake HTTP server that records received method/path and returns controlled responses. Assertions include:

```javascript
assert.equal(recorded.path, '/payments');
assert.equal(recorded.body.confirm, false);
assert.equal(recorded.body.amount, order.amount);
assert.equal('connector' in recorded.body, false);
assert.equal(recorded.headers['api-key'], 'dummy-secret');
assert.equal(requestCountAfterTimeout, 1);
```

  Add retrieval URL encoding, redirect refusal without contacting the redirect target, 401 sanitization, non-JSON/oversized responses, malformed success bodies, timeout uncertainty, and absence of raw secrets in serialized errors. Demo create/retrieve must not call fetch.
- [ ] Run `node --test test/payment-api.test.mjs`; observe failures.
- [ ] Implement POST `/payments` and GET `/payments/{id}` with explicit api-key, JSON, AbortSignal timeout and redirect error. Creation sends stable ID, server order values, profile, automatic capture, confirm=false and fixed return URL. Validate normalized response types, required session data and IDs; cap response bodies at 1 MiB. No financial retries. Reject non-2xx, invalid JSON and API error envelopes with safe error codes. Transport/malformed create responses are ambiguous.
- [ ] Implement labeled demo states in memory, using payment IDs supplied by the order service; simulated outcomes do not use provider names or real SDK globals. Add explicit demo-only completion to the service in Task 3, never to the real adapter.
- [ ] Run target tests and `npm test`; commit as `feat: add generic payment API and offline adapter`.

## Task 3 — Durable sample order lifecycle

**Files:** Create `src/order-store.mjs`, `src/checkout-service.mjs`, `test/order-store.test.mjs`, `test/checkout-service.test.mjs`.

**Interfaces:** `openOrderStore({directory, namespace}): Promise<Store>` returns `get(id)`, `save(order)`, `close()`. Namespace binds mode, API origin and profile, never secrets. `createCheckoutService({config, store, api})` returns the shared service contract plus `completeDemo(orderId, outcome)` restricted to demo mode.

- [ ] Write tests proving persistence before the fake API is called, restart recovery, order namespace mismatch, atomic write failure, a second active process being rejected, and no stored client secret. Assert concurrent start requests create at most one upstream payment:

```javascript
await Promise.all([service.start(order.id), service.start(order.id)]);
assert.equal(createCalls, 1);
assert.equal((await store.get(order.id)).paymentId, originalPaymentId);
await assert.rejects(() => service.status(wrongAmountOrder.id));
assert.equal((await store.get(wrongAmountOrder.id)).phase === 'paid', false);
```

  After an ambiguous create and restart, `start` must only retrieve the original ID; even a not-found result must not automatically create again. Reject changed profile, currency, amount or ID from retrieval. A definitive provider failure stays unpaid. `requires_capture` is not paid.
- [ ] Run `node --test test/order-store.test.mjs test/checkout-service.test.mjs`; observe expected failures.
- [ ] Implement single-process ownership via exclusive state lock; reject stale lock with a clear recovery procedure rather than automatically deleting it. Use directories mode 0700 and files 0600, atomic temp/write/fsync/rename and directory sync where supported. Validate state on read; fail closed on corruption. Persist creating before the network request and mark uncertain on ambiguous outcomes; always retrieve after a recovered creating state. Keep per-order mutation serialization and reject conflicting catalog changes for existing orders. Only exact matched `succeeded` sets paid. New browser sessions explicitly create new sample orders; status and retries reuse the existing order.
- [ ] Implement simulated completion only for demo orders; it must never call the real API and must return `simulated:true`.
- [ ] Run target tests and `npm test`; commit as `feat: persist safe example checkout lifecycle`.

## Task 4 — Secured local HTTP server

**Files:** Create `src/http-boundary.mjs`, `src/server.mjs`, `src/main.mjs`, `test/server.test.mjs`.

**Interfaces:** `createServer({config, service})`; expose GET `/api/config`, POST `/api/orders` with `{catalogId}`, POST `/api/orders/{id}/checkout`, GET `/api/orders/{id}`, and demo-only POST `/api/orders/{id}/demo-result` with `{outcome}`. GET `/return` serves the same application without trusting query status.

- [ ] Write real loopback HTTP tests. Reject bad Host and cross-origin mutation requests with 403, bad CSRF with 403, unexpected body fields with 400, body over 16 KiB with 413, invalid content type with 415, unknown routes with 404 and traversal/symlink requests without reading files. Assert `.env`/state files cannot be served and config/errors never include dummy secret values. Simulated completion in sandbox returns 404.
- [ ] Run `node --test test/server.test.mjs`; observe failures.
- [ ] Implement fixed static path allowlist, no directory listing, no reflected HTML and nosniff/no-store/referrer headers. Local per-process random CSRF token is bootstrapped only through same-origin GET config and required on mutations; reject Origin mismatches and cross-site Fetch Metadata. Reject mutation requests without Origin. Bind exactly 127.0.0.1, not all interfaces. Startup logs mode/local URL only. Refuse to start sandbox with invalid configuration or occupied/corrupt state.
- [ ] Document local-only authorization: the sample is a single-user developer tool, not merchant identity management. Production consumers must replace it with their own authenticated order-ownership checks. Return page cleans sensitive query strings and fetches the stored order state; no query parameter can set paid.
- [ ] Run target tests and `npm test`; commit as `feat: serve guarded local integration example`.

## Task 5 — Runnable provider-neutral browser checkout

**Files:** Create `public/index.html`, `public/checkout.mjs`, `public/checkout-controller.mjs`, `public/styles.css`, `test/checkout-controller.test.mjs`.

**Interfaces:** `createCheckoutController({api, sdkLoader, render})` exposes `initialize()`, `selectCatalog(id)`, `start()`, `confirm()`, `refreshStatus()`. `api` maps exactly to Task 4; `sdkLoader(config)` returns the standard Hyper instance. The controller alone owns submitting state; the DOM module supplies rendering/event handlers.

- [ ] Write controller tests with fake API/SDK boundaries. Assert demo calls the loader zero times, sandbox mounts the standard payment widget without a hardcoded method list, double confirm calls result in one SDK call, late responses for a previous order cannot replace the current view, SDK load failure remains unpaid, and only matched backend status controls paid display. Use `assert.equal(sdkLoads, 0)` for demo and `assert.equal(confirmCalls, 1)` for repeated submit. No browser error includes payment client secret.
- [ ] Run `node --test test/checkout-controller.test.mjs`; observe failures.
- [ ] Implement standard `Hyper(publishableKey,{customBackendUrl})`, `widgets({clientSecret})`, `widgets.create('payment', {wallets:{walletReturnUrl}})` and `hyper.confirmPayment`. Check interface against the hosted release before claiming compatibility. Load remote script only in explicit sandbox mode with bounded failure handling. Keep customer/provider redirect behavior in the SDK, not custom payment forms. Use external script/style files and a mode-specific CSP; any necessary policy broadening gets a security review, never blanket wildcard permissions.
- [ ] Implement a minimal labeled screen for catalog, selected mode, checkout, errors and status. Demo controls are visibly simulated. Session storage may hold only the opaque local order ID for the return flow, never a key or client secret. Disable repeat confirmation while submitting/uncertain; expose status reconciliation, not automatic retry. Do not introduce a new framework or payment UI library.
- [ ] Run `npm test`. Start demo over HTTP and inspect with Chrome DevTools: two catalog/currency configurations work without code changes, no provider traffic, no console errors, and no card inputs. Review sandbox interface loading without submitting payments; report any CSP/CORS blocker honestly. Do not treat local demo as a provider test.
- [ ] Commit as `feat: add runnable generic hosted SDK checkout example`.

## Task 6 — Guide, clean packaging and independent review

**Files:** Create `README.md`, `docs/integration.md`, `docs/security.md`, `docs/webhooks.md`, `docs/validation.md`, `docs/compatibility.md`, `examples/wq3-paypal/README.md`, `scripts/package.mjs`, `release-files.json`, `test/package.test.mjs`. Modify platform root README with one link.

**Interfaces:** `buildRelease({sourceDir, outputDir, version})` in `scripts/package.mjs` stages only explicit allowlisted files in a fresh directory and creates `openswitch-web-starter-0.1.0.zip`, SHA256SUMS and release metadata. CLI receives output directory; reject output inside source, symlink inputs and existing release paths. Use installed zip without shell interpolation and verify its exit status; no runtime dependency on zip.

- [ ] Write packaging tests with a temporary source containing dummy `.env`, state and cache canaries. Assert these paths/bytes are absent from archive/staging, all manifest hashes match, an existing output is not overwritten, symlinks fail closed and source version matches archive name. Use dummy test strings, not known real secret fragments. Run `node --test test/package.test.mjs` and observe failures.
- [ ] Implement allowlisted release assembly and tests. Exclude environment/state/dependency directories. Include test sources and config templates so the archive recipient can run the same suite. Do not vendor HyperLoader or claim archive hashes pin remote SDK assets.
- [ ] Write exact quickstart: Node 24 LTS, unpack, `npm start` for demo, `npm test`, and configuration for separately approved sandbox. Explain that HTML cannot be opened directly with file://, the standard Hyper API is reused, and there is no published @openswitch npm wrapper. Document framework adaptation through the same hosted loader instead of inventing untested React package pins.
- [ ] Document authenticated production create/status/return responsibilities, currency/amount minor units, merchant-key scope limits, profile isolation, uncertain outcomes, refunds as a separately tested capability, and no provider readiness guarantees. Keep PayPal/EUR limits in the optional WQ3 example only. Preserve prior ZIP but name it superseded in the new guide.
- [ ] Investigate the deployed outgoing webhook signature contract using safe source/config evidence. If still unverified, document the blocker and reject webhooks; do not add an unsigned receiver. Record sandbox credentials/provisioning, CORS, static SDK serving and immutable version mapping as platform requirements outside package delivery.
- [ ] Run `npm test` under an actual Node 24 runtime and record its exact patch version. If unavailable, stop short of claiming that compatibility. Run package command, `unzip -t`, clean unpack, manifest verification, `npm test` and `npm start` from unpacked files. Repeat browser demo check there. Record results, dates and limitations in validation metadata.
- [ ] Obtain one independent whole-change/security review before release; fix findings with regression tests. Inspect exact/staged diffs, `git diff --check`, submodule pointers and unrelated files. Commit only owned package/docs files as `feat: package generic OpenSwitch developer starter`.
- [ ] Deliver ZIP and checksum, guide, test results, runtime compatibility and explicit remaining real-provider/webhook/deployment gaps. No new financial operations or production change is implied by package delivery.

## Execution and approval gates

This plan is ready for user review; no product implementation has started. Recommend
Native execution followed by an independent review because these six tasks share
small, tightly coupled contracts. Subagent-driven execution remains an alternative
if the user prefers per-task independent reviews. Preserve any explicit execution
choice when supplied; review approval is still required before starting.

The current single WQ3 EUR sandbox payment approval does not authorize arbitrary
provider tests, additional charges, live credentials, production deployment or
webhook security bypasses. The package can be delivered as a validated generic
starter with operational gaps stated; overall production readiness remains a
separate objective. No claim of end-to-end completion without actual evidence.
