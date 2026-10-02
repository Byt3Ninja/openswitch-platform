# Generic OpenSwitch SDK integration package design

Status: proposed for written review. Date: 2026-10-02.

## Purpose and success criteria

Deliver one customer-facing ZIP that lets a developer integrate OpenSwitch once,
using Hyperswitch's standard checkout SDK and supported payment API. Merchant
configuration and payment context determine available methods; the application
must not implement provider-specific checkout branches. The earlier WQ3 package
was too narrow and contained non-runnable fragments. Preserve it as a historical
artifact, but identify the replacement clearly and stop recommending the old ZIP.

Success means a generic guide, runnable reference checkout, server example,
configuration template, automated tests, and release manifest. Local demonstration
must work without credentials and must be visibly marked as simulated. Real
sandbox execution is a separate, explicit mode and acceptance result. A mock test
does not certify provider readiness or production integration.

## Ownership and classification

Owner: OpenSwitch-platform, not the dirty sibling OpenSwitch checkout, and not
the upstream hyperswitch or connector submodules. Proposed source directory:
`integrations/web-starter/`. Design and implementation plan belong under
`docs/superpowers/`. Reuse the current platform worktree; do not create another
large checkout. Classification D external integration example, A configuration,
and documentation. Upstream core changes: NONE. No upstream API, schema, connector,
migration, routing, or deployment change is part of this package.

## Approach and alternatives

Use the hosted JavaScript SDK directly through its supported Hyper initialization,
widgets, confirmation and retrieval interfaces. The SDK continues to handle payment
UI, redirects and provider interactions. The sample merchant server creates and
retrieves payments through the existing API. This minimizes upstream divergence.

A new OpenSwitch npm facade would introduce another public interface and release
cycle without fixing current deployment gaps; defer it. A documentation-only ZIP
would repeat the runnable-example gap; reject that as the final deliverable.
Do not copy the remote SDK bundle into the ZIP: it has runtime asset dependencies,
and a copied loader is neither an offline SDK nor a complete SDK distribution.

## Package contents

- README with prerequisites, exact start/test commands and mode selection.
- Generic integration guide for frontend, backend, keys, orders, status and errors.
- Runnable browser checkout served over HTTP by a small Node.js reference server.
- Server-owned sample catalog with configurable minor-unit amounts and currencies.
- Configuration template for API origin, SDK URL, merchant profile, keys and return URL.
- Automated offline tests and a documented optional real-sandbox acceptance procedure.
- Webhook contract and production adaptation guide, with verification requirements.
- Optional WQ3 PayPal EUR example isolated from generic defaults and documentation.
- Versioned ZIP, file inventory, SHA-256 manifest, validation report and upstream references.

Choose an actively supported Node.js LTS version during implementation planning
and record the tested version. Prefer built-in HTTP, fetch and test facilities;
add dependencies only for a demonstrated need. No npm publication is included.

## Runtime modes and configuration

Default offline demonstration mode makes no payment-provider calls, does not load
the remote payment SDK, collects no card data, and never displays an unlabeled real
payment success. It proves application control flow only.

Real sandbox mode loads the OpenSwitch-hosted SDK and calls the approved API using
separately provisioned credentials. It must require deliberate enablement and
administrator confirmation of merchant, profile, provider test mode and endpoint.
The shared production API hostname, a key prefix, or a profile name is not evidence
of sandbox isolation. No automatic transition from mock to sandbox or live is allowed.

The runnable example binds to loopback and rejects unexpected Host/Origin values.
It is not deployable as a public merchant backend unchanged. No live mode is
included in the example server. The guide explains how the customer's existing
authenticated backend replaces it for production.

The generic path has no fixed PSP, merchant ID, profile ID, EUR amount, or hardcoded
payment-method list. Sample catalogs and environment files carry those choices.
Eligibility is determined by the actual connector configuration, routing, currency,
amount, customer context and supported SDK capabilities. Generic does not mean
every provider, method or currency is operationally supported.

## Payment flow and safety

The browser selects a sample order, not an arbitrary charge amount or profile.
The server validates configuration and owns the order amount, currency, profile,
return URL and stable payment ID. It creates without confirmation, returning only
the browser-required payment session fields with no-store caching. Secret keys
never enter public files, browser storage, logs, archives or error responses.

Persist the local sample order/payment mapping with restrictive file permissions
outside packaged source. Serialize creation for an order. Persist intended payment
identity before sending a request. A timeout enters an uncertain state; retrieve
that payment before permitting any new attempt. Do not advertise generic header
idempotency or blindly retry financial calls. Production uses the merchant's
transactional store, authenticated users and order-ownership checks instead.

The browser mounts the standard payment element and invokes SDK confirmation.
Disable duplicate submissions and treat browser results as advisory. Backend status
retrieval must verify expected order association, amount, currency and profile before
showing a paid state. No sample endpoint performs real business fulfilment.

Local anti-CSRF and origin protections are required even for the demonstration.
This work includes a security review of secret handling, local HTTP boundaries,
redirect validation, error redaction and duplicate/uncertain-outcome behavior before
real sandbox use. It does not authorize new production credentials or rotations.

## Webhooks and production adaptation

Document provider-to-OpenSwitch and OpenSwitch-to-merchant webhooks separately.
Confirm the deployed outgoing signature contract before supplying executable
verification code. Never invent a signing algorithm, trust an unsigned event, or
accept a browser redirect as payment proof. Until the contract is established,
the example must not expose an accepting webhook endpoint; clearly report that gap.

The production guide requires authentication, authorization, CSRF protection,
durable event receipt, signature verification, deduplication, ordering/reconciliation,
one-time fulfilment, observability, key rotation and deployment review. It must
distinguish implemented sample safeguards from application work the customer owns.

## Validation and completion gates

Tests must cover mode isolation, invalid configuration, secret redaction, request
tampering, Host/Origin rejection, duplicate creation, restart recovery, uncertain
outcomes, response validation and status-to-order matching. Use a local fake API;
automated tests must not submit real payments. Browser checks prove the served
page works over HTTP and distinguish demo from sandbox. Opening a fragment via
file:// is not an acceptance test.

Validate the standard SDK interface against the observed hosted release and report
browser CORS/CSP limitations rather than disabling protections. Keep the existing
development-server WebSocket problem and mutable SDK URL as separate platform
release blockers. Do not label the integration production-ready while these and
end-to-end payment/webhook checks remain unresolved.

Package only allowlisted source/docs/config examples; exclude environment secrets,
state files, dependencies, caches and build output. Verify a clean unpack, start
instructions, tests, archive integrity and checksums. Demonstrate at least two
merchant-neutral offline configurations without editing checkout logic; this proves
configuration separation, not two functioning PSP integrations.

## Impact and next stage

This design has no runtime, database, payment or production effect. It introduces
no new worktree or heavy Rust build. A later implementation commit can be reverted
independently; old release ZIPs are retained, not overwritten. SDK deployment
hardening and production EGP/provider validation remain separate approved work.

After approval of this written design, prepare the implementation plan, review it
with the user and select execution method before writing product code. Only then
build and test the package. Current approval permits design work, not claims that
the replacement SDK package is already complete.
