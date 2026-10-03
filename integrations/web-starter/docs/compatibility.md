# Compatibility and platform requirements

| Component | Recorded boundary |
| --- | --- |
| Starter | `openswitch-web-starter` 0.1.0, private source package; no published npm wrapper |
| Node | Node 24 LTS required (`>=24 <25`); actual local checks use v24.18.0 |
| Payment API | Existing v1 `POST /payments` and `GET /payments/{payment_id}`; offline local fake-API contract tests |
| Hosted browser interface | `Hyper`, `widgets`, payment element, `confirmPayment`, `customBackendUrl`, wallet return URL; actual sandbox browser compatibility unverified |
| Observed hosted SDK | Prior deployed evidence reports package/image v0.133.0; not a tested or immutable starter dependency pin |
| Upstream platform source | Platform pins official Hyperswitch `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1`; this is not a deployed-version assertion |
| Runtime dependencies | Node built-ins only; system `zip`/`unzip` needed for packaging tests and archive QA |

The hosted URL `https://sdk.openswitch.io/HyperLoader.js` is mutable. The recorded unauthenticated public check returned HTTP 200 and 3,005,889 bytes, with expected method/configuration strings and no `http://localhost:9050`. String presence is not a method call, browser acceptance or completed checkout. The ZIP neither vendors the loader nor pins its remote dependent assets; local SHA-256 manifests cannot provide that guarantee.

Existing deployed evidence records the SDK using a development server with a WebSocket/CSP error. A production-built static SDK distribution and a tested mapping of immutable loader/dependent assets to SDK/API release versions remain platform work. Do not weaken CSP, expose a development WebSocket port or infer readiness from HTTP 200.

Platform/merchant requirements outside this source delivery are: separately provisioned sandbox credentials and verified provider test mode/routing/profile; exact merchant/browser origins, CORS and CSP/frame requirements; stable static SDK asset serving; immutable version compatibility mapping; deployed signed outgoing webhook/secret/retry verification; and approved real sandbox success/failure/cancellation/redirect/3DS/status tests where supported. Production requires the customer's authenticated backend, deployment review and one-time fulfilment controls. These requirements are not satisfied by the offline suite or a demo screenshot.

Framework adaptations reuse the same hosted loader and standard interface. This release declares no React/Vue package compatibility pin. Connector support, eligible methods, currencies, refunds and other flows must be established against the actual account and deployment. Generic integration is not universal provider support.

Primary interface references: [upstream HTML/REST integration guide](https://github.com/juspay/hyperswitch-docs/blob/main/integration-guide/payment-experience/payment/web/html-with-rest-api-integration.md) and [upstream web SDK README](https://github.com/juspay/hyperswitch-web/blob/main/README.md). These describe the standard Hyper flow and custom backend configuration, and the SDK README warns that SDK/backend versions must be compatible. They are documentation references, not a verified mapping for the deployed OpenSwitch SDK.
