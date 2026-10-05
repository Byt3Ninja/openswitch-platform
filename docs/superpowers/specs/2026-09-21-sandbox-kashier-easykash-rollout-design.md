# Kashier and EasyKash Sandbox Rollout Design

## Intent and success criteria

Add Kashier and EasyKash as controlled payment connectors for the approved OpenSwitch sandbox hierarchy without changing any production business profile or routing ordinary traffic. Kashier will be configured on MulkStay Sandbox, Startpad Sandbox, Hackathon Sandbox, and WQ3 Sandbox with Kashier test credentials. EasyKash will first be configured only on WQ3 Sandbox with a dedicated low-risk merchant account because EasyKash does not provide a separate test environment and the account's callback-URL capacity is unknown.

Success means the current production runtime advertises both connectors, the signed-in Control Center catalog exposes both credential forms, all four sandbox profiles have a validated Kashier merchant connector account, WQ3 Sandbox has a validated EasyKash merchant connector account, and controlled connector-explicit payments prove redirect, status reconciliation, and signed webhook handling. No connector becomes a default route, no production profile changes, and no ordinary traffic uses either connector under this rollout.

EasyKash expansion to the other three sandbox profiles is a later gate, not implied by deployment success. Expansion requires direct evidence that the provider account supports multiple callback URLs or another provider-supported routing mechanism that preserves profile isolation.

## Current state and constraints

The platform repository tracks Kashier and EasyKash as independent connector submodules. A gitlink makes connector source available to a clone but does not compile it into Hyperswitch, expose it in Control Center, deploy it, or create a merchant connector account.

Read-only production discovery on 2026-09-21 found `KASHIER` in `https://api.openswitch.io/feature_matrix` with alpha status and did not find EasyKash. The signed-in connector catalog for Hackathon Sandbox returned no result for either Kashier or EasyKash. The recorded Kashier deployment used a Hyperswitch v1.126.0 integration based on upstream commit `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1` and a Control Center v1.38.8 integration based on commit `adc307d08c87862380f966af44b849ddfee21dcc`; the action-time inventory must re-establish the exact deployed image digests and source commits rather than assuming those records remain current.

The Kashier connector repository contains a v1.126.0 patch and a Control Center patch. Kashier test credentials are available. Kashier supports distinct test and live credentials, and this phase uses only test credentials and `https://test-api.kashier.io/`.

The EasyKash connector repository targets older Hyperswitch commit `568a91925fc7ae1948838e105afdd98210cb3152`; it has not been ported to the current Kashier-enabled v1.126.0 build. EasyKash uses the same documented provider endpoint for merchant traffic rather than a separate test host. The available account is a dedicated low-risk merchant account, but it still creates live-provider transactions. Every EasyKash transaction therefore requires a separately approved capped smoke-test boundary.

The organization-foundation work is a dependency. This design branch is stacked on `codex/production-organization-foundation` so the sandbox profile names and non-secret hierarchy intent are present. Connector rollout must not begin if that hierarchy is absent or differs from the approved four sandbox profiles.

## Scope and exclusions

In scope:

- Port EasyKash to the exact current Kashier-enabled Hyperswitch v1.126.0 source baseline.
- Produce one combined Hyperswitch build that retains Kashier and adds EasyKash.
- Produce one Control Center build that exposes both connector forms.
- Add non-secret connector endpoints to runtime configuration.
- Create Kashier merchant connector accounts on all four sandbox profiles.
- Create one EasyKash merchant connector account on WQ3 Sandbox.
- Validate connector-explicit hosted card payments, server-side reconciliation, and signed callbacks.
- Preserve immutable build, deployment, verification, and rollback evidence outside tracked secret-bearing paths.

Out of scope:

- Any connector account or payment on MulkStay, Startpad, Hackathon, or WQ3 production profiles.
- Default routing, volume splitting, fallback routing, or ordinary application traffic.
- Manual capture, void, refund, saved-card, recurring-payment, wallet, payout, or direct-card flows.
- Database migrations, PostgreSQL or Redis restarts, customer-data migration, and destructive cleanup.
- Storing credentials in Git, chat, images, Coolify environment variables, container images, shell history, or operational reports.
- Expanding EasyKash beyond WQ3 Sandbox before the callback-capacity gate passes.

## Repository ownership and dependency order

The platform repository owns the rollout design, non-secret deployment intent, image pins, profile rollout order, readiness evidence, and rollback procedure. It must not vendor connector or upstream source.

The Kashier connector repository remains the authority for Kashier source, tests, its Hyperswitch patch, Control Center patch, and deployment documentation. The existing connector code should not be rewritten merely to perform this rollout. Any Kashier change is limited to a defect proven against the current combined source or dashboard.

The EasyKash connector repository owns the ported connector source, focused tests, combined-baseline integration patch, Control Center patch, deployment assets, and provider-specific documentation. Its parent gitlink advances only after the connector repository commit is independently reviewed and published.

A fresh isolated Hyperswitch integration worktree starts from the exact current deployed v1.126.0 source and reapplies or contains the reviewed Kashier integration before EasyKash is added. A fresh isolated Control Center worktree starts from the exact current deployed dashboard source and contains the reviewed Kashier exposure before EasyKash is added. Existing dirty or temporary checkouts are evidence sources only and must not be reset, cleaned, or reused as authoritative build workspaces.

Dependency order is: connector tests and port, combined Hyperswitch build, combined Control Center build, non-secret deployment record, readiness and rollback gate, application deployment, catalog verification, connector-account creation, controlled payment validation, observation, and handoff.

## Category E core integration boundary

The user explicitly approved the Category E boundary on 2026-09-21 after reviewing the requirement, alternatives, affected areas, risks, and upstream path. This approval permits the implementation plan to include minimal additive shared Hyperswitch integration; it does not pre-authorize production deployment or credential entry.

EasyKash must be a first-class connector in this Hyperswitch revision because merchant connector account validation, connector selection, endpoint lookup, feature-matrix reporting, and payment dispatch are compile-time registrations. Dashboard-only, configuration-only, and merchant-account-only approaches cannot route an unknown connector. This revision has no dynamic payment-connector plugin boundary. A sidecar still needs a recognized Hyperswitch connector and would add an unnecessary security-sensitive payment service.

The minimal integration adds the EasyKash connector and transformer modules, then registers them in the existing v1.126.0 integration points used by Kashier. Expected shared areas are:

- `crates/common_enums/src/connector_enums.rs`
- `crates/connector_configs/src/connector.rs` and connector TOMLs
- `crates/hyperswitch_domain_models/src/connector_endpoints.rs`
- `crates/hyperswitch_connectors/src/connectors.rs`
- `crates/hyperswitch_connectors/src/default_implementations.rs`
- `crates/hyperswitch_connectors/src/default_implementations_v2.rs`
- `crates/router/src/connector.rs`
- `crates/router/src/core/connector_validation.rs`
- `crates/router/src/types/api/connector_mapping.rs`
- `crates/router/src/types/api/feature_matrix.rs`
- `crates/router/src/types/connector_transformers.rs`
- standard non-secret connector endpoint configuration and focused connector tests

The port must not alter generic payment state machines, persistence schemas, migrations, or unrelated connectors. If the exact current source requires a materially broader shared change, implementation stops and returns to the approval gate with the new files and rationale.

The upgrade risk is concentrated in centralized connector registries. The mitigation is a small additive patch against an immutable upstream revision, a combined Kashier/EasyKash build, focused behavior tests, and a retained connector-repository patch suitable for review and an upstream Hyperswitch contribution.

## Control Center integration

The current signed-in catalog does not expose Kashier or EasyKash even though the backend advertises Kashier. The combined Control Center build must expose both connectors in development and live/test fallback lists, name parsing, display metadata, and credential schemas without changing unrelated connector behavior.

Kashier uses `SignatureKey` fields for Payment API Key, Merchant ID, Secret Key, and the webhook Payment API Key. EasyKash uses `HeaderKey` for its API key and a separate webhook HMAC secret. The UI must label the EasyKash account as a low-risk live-provider pilot rather than implying a provider sandbox exists. Brand assets must be locally owned or provider-approved; otherwise use a neutral text/icon treatment.

The dashboard build must be based on the exact deployed source revision, not a dirty temporary checkout. A future backend/dashboard upgrade should replace any connector-specific fallback schema with the version-matched generated connector metadata when available.

## Payment and webhook data flow

For Kashier, each sandbox profile receives a profile-scoped merchant connector account using the available Kashier test credential set. The connector creates a hosted payment session on the Kashier test host, uses the unique Hyperswitch payment attempt ID as the provider order reference, supplies the router return URL, and supplies the profile-specific OpenSwitch webhook URL as the per-session `serverWebhook`. This avoids global webhook broadcasting when one Kashier test account is reused across multiple OpenSwitch profiles.

After customer redirect, OpenSwitch treats browser-return data as informational. Payment sync calls Kashier's authenticated session endpoint. A webhook is accepted only after HMAC-SHA256 verification with the correct test Payment API Key; the signed payment status, not the event name alone, determines success, failure, or pending state.

For EasyKash, only WQ3 Sandbox receives a merchant connector account in this phase. Authorize sends a hosted card request using payment option `2`, customer billing name, email, mobile number, return URL, and the Hyperswitch payment attempt ID as `customerReference`. EasyKash inquiry reconciles final state using that reference. The provider callback targets the MCA-specific OpenSwitch webhook URL and is accepted only after HMAC-SHA512 verification over the documented field order.

Neither connector is placed in a default routing rule. Validation requests explicitly select the intended merchant connector account. An authorization with an ambiguous timeout is not automatically retried; sync or inquiry must reconcile it first. Duplicate callbacks must not produce duplicate payment transitions, and callbacks for one profile must not update another profile's payment.

## Credential and data handling

Credentials are entered only through the authenticated OpenSwitch connector-account flow, which encrypts connector account details for storage. The operator enters them at the action boundary; they are never pasted into chat or copied into agent-visible reports. Kashier test credentials may be reused across the four sandbox MCAs because each payment carries its profile-specific webhook URL. The EasyKash low-risk account is initially present in one MCA only.

Logs and evidence may record connector name, environment classification, profile display name, MCA identifier, image digest, HTTP status, payment identifier, redacted provider reference, and verification result. They must not record keys, webhook secrets, authorization headers, PAN, CVV, tokens, full customer details, full provider payloads, or unredacted payment method data.

Controlled test customers use synthetic names, project-owned test email addresses, and designated test mobile numbers. No real customer record or production order is used.

## Test and verification strategy

The EasyKash port follows test-driven development. Focused tests must cover request construction, major-unit conversion, supported currencies, card-only automatic capture, required billing fields, provider response parsing, inquiry request and status mapping, HMAC-SHA512 field order, tampering failure, missing signature failure, unsupported callbacks, and redacted error handling. Tests must prove capture, void, refund, saved-card, and retry behavior remain unsupported rather than silently succeeding.

The combined Hyperswitch source must pass patch-application checks, EasyKash and Kashier connector tests, relevant connector library tests, formatting and lint checks, and a release router/scheduler build with the exact production feature set. The feature matrix must include both connectors with accurate alpha status and supported card methods.

The Control Center source must pass its production build and focused connector-catalog checks. The output bundle must contain both connector names and credential labels, and the signed-in catalog must expose both forms after deployment.

Before external calls, a deterministic local mock verifies redirect handling, sync/inquiry mapping, signature acceptance, signature tampering rejection, duplicate callback behavior, timeout ambiguity, and cross-profile isolation. Mock success is not evidence of provider readiness.

Production-runtime validation is staged:

1. Verify immutable image digests, configuration, health, readiness, startup logs, scheduler health, and both feature-matrix entries before creating an MCA.
2. Create four Kashier test MCAs and one WQ3 Sandbox EasyKash low-risk MCA with no routing rules.
3. For each Kashier sandbox profile, run one connector-explicit test-mode payment and verify redirect, session sync, signed webhook, profile isolation, and final status.
4. For WQ3 Sandbox EasyKash, obtain action-time approval for a capped live-provider amount, run one connector-explicit payment, and verify redirect, inquiry, signed callback, duplicate safety, and final status.
5. Observe runtime logs and health after each payment. Stop on signature, status, timeout, cross-profile, or unexplained provider errors.

## Deployment readiness and action-time approval

The code/build phase and the production mutation phase are separate approvals. Before any deployment, collect a fresh inventory of the authoritative Coolify application, current Source and Deployable Compose, current image tags and digests, connector endpoint configuration, production API and dashboard health, router and scheduler topology, database and Redis bindings, recent relevant errors, backup completion, restore evidence, and exact rollback commands.

The deployment packet must name every image digest, every non-secret configuration change, the five intended sandbox MCAs, excluded production profiles, expected restart set, validation commands, rollback images/config, operator, maintenance window, and observation window. Production deployment begins only after explicit action-time approval of that packet.

Credential entry is a separate sensitive-data boundary. The human operator takes over or explicitly confirms transmission immediately before entering each provider credential set into OpenSwitch. A controlled EasyKash payment has an additional financial action boundary that states the amount, currency, WQ3 Sandbox destination, and low-risk provider account before confirmation.

## Deployment and rollback

Publish immutable router, producer, consumer, and Control Center images to the authenticated private registry and record their digests. Update only the application image references and the non-secret `kashier.base_url` and `easykash.base_url` values in the authoritative Coolify configuration. Review both saved Source Compose and generated Deployable Compose. Do not restart PostgreSQL or Redis and do not run a migration unless an unexpected build requirement returns to the approval gate.

Deploy application components in the approved order, preserving the prior Compose, config, images, and container identifiers. A started container is insufficient: verify dependency readiness, API health, scheduler health, error logs, feature matrix, dashboard health, and signed-in connector catalog.

Rollback before MCA creation restores previous images and configuration and recreates only affected application containers. Rollback after MCA creation first disables the new connector accounts and confirms no route selects them, then restores previous images/configuration. Encrypted MCA records and payment records remain for investigation; nothing is deleted automatically. Rollback does not restart databases, reverse unrelated changes, or erase evidence.

## Acceptance and handoff

The rollout is accepted only when:

- The exact combined source, image tags, and immutable digests are recorded.
- Router, producer, consumer, and dashboard are healthy with no unexplained connector startup errors.
- `/feature_matrix` reports Kashier and EasyKash accurately.
- The signed-in catalog exposes both connector forms.
- MulkStay Sandbox, Startpad Sandbox, Hackathon Sandbox, and WQ3 Sandbox each have one enabled Kashier test MCA and a successful controlled test payment with verified sync and webhook evidence.
- WQ3 Sandbox has one enabled EasyKash low-risk MCA and a successful capped controlled payment with verified inquiry and callback evidence.
- No default or fallback route references either connector.
- No production profile, production credential, production application traffic, database schema, or unrelated service changed.
- Rollback artifacts and the agreed post-change observation record are retained.

The handoff must state affected repositories and commits, upstream core changes and approval, configuration and database impact, exact validation performed, sandbox versus live-provider status, rollback readiness, and the remaining EasyKash callback-capacity gate. Passing builds or static checks alone must never be described as payment readiness.
