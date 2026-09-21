# Healiot LLC Production Organization Migration Design

## Intent and success criteria

Replace the current live Hyperswitch account configuration with a controlled Healiot LLC platform hierarchy and migrate four applications to use Hyperswitch as their payment orchestration boundary. The migration uses one existing Hyperswitch deployment while separating sandbox and production through distinct merchant accounts, profiles, application credentials, Stripe connector accounts, routing, webhooks, and application domains.

Success means the Healiot LLC organization has the approved production and sandbox merchants and profiles; every application uses its fixed merchant/profile configuration through its backend; each profile has an isolated Stripe connector configuration for EGP in Egypt; sandbox flows pass the validation gate before any live cutover; production is migrated one project at a time with rollback available; and the obsolete account configuration is removed only after explicit post-cutover approval.

Current business data does not need to be migrated or remain accessible in the new hierarchy. A pre-change database snapshot is still required as an operational rollback checkpoint. This design does not authorize deletion, credential rotation, deployment, or any other production mutation by itself.

## Classification and repository boundaries

This program combines Category A configuration, Category B deployment/infrastructure, and Category D application integration work. Upstream core changes: NONE. Connector-specific Hyperswitch core patches, Kashier activation, and EasyKash activation are outside scope.

The OpenSwitch platform repository owns the migration design, deployment evidence, account registry, and operational handoff. The pinned `hyperswitch/` submodule remains unchanged. Each application repository owns its Hyperswitch adapter, fixed profile selection, webhook processing, idempotency, local payment-state transitions, tests, and runtime secret references. Stripe and Hyperswitch secret values remain in approved runtime secret stores and never enter Git, specifications, screenshots, logs, or task output.

The platform repository currently contains no verified deployable Coolify manifest or authoritative live configuration. The actual Coolify application, deployed image, service topology, database, Redis, domains, secrets, and backup mechanism must be discovered read-only before an implementation plan can authorize any change.

## Confirmed current-state findings

- The pinned Hyperswitch v1 API models bind merchant connector accounts to a `profile_id` and support connector `test_mode`.
- In the pinned version, server API keys are associated with a merchant rather than a profile. Separate keys under one merchant improve rotation and auditability but do not form hard authorization boundaries between sibling profiles.
- Startpad currently creates Stripe Checkout sessions directly through its own Stripe adapter. It must be migrated rather than merely pointed at newly created account records.
- The indexed MulkStay and Hackathon codebases do not expose an established Hyperswitch payment integration.
- WQ3's authoritative source is not available in the indexed workspace and must be located before its application-integration plan is written.
- No staging application domains currently exist.

## Target account hierarchy

Use one Hyperswitch deployment and one Healiot LLC organization with four logical merchant accounts:

| Environment | Merchant | Profiles | Country | Currency |
| --- | --- | --- | --- | --- |
| Production | GrowthLabs | MulkStay, Startpad, Hackathon | Egypt | EGP |
| Sandbox | GrowthLabs Sandbox | MulkStay Sandbox, Startpad Sandbox, Hackathon Sandbox | Egypt | EGP |
| Production | Healiot Egypt | WQ3 | Egypt | EGP |
| Sandbox | Healiot Egypt Sandbox | WQ3 Sandbox | Egypt | EGP |

Hyperswitch-generated organization, merchant, profile, connector, and API-key identifiers are recorded in a restricted operational inventory. Human-readable names are labels and must not be used as stable integration identifiers.

The merchant is the hard trust boundary. GrowthLabs applications share a GrowthLabs merchant scope but use distinct API keys, profiles, Stripe accounts, routing, and webhook settings. Each backend is configured with a fixed profile identifier and must never accept an arbitrary profile identifier from an untrusted client. If GrowthLabs later requires protection between projects after one project key is compromised, each project must be promoted to its own merchant account in a separately reviewed migration.

## Environment and domain model

Sandbox and production run in the same Hyperswitch deployment but use separate merchant accounts and all separate application/connector material. Sandbox uses Stripe test credentials with connector `test_mode`; production uses Stripe live credentials. Test and live credentials, API keys, webhook secrets, routing configuration, and application URLs must never be reused across these boundaries.

| Project | Sandbox base URL | Production base URL |
| --- | --- | --- |
| MulkStay | `https://staging.mulkstay.com` | `https://mulkstay.com` |
| Startpad | `https://staging.startpad.me` | `https://startpad.me` |
| Hackathon | `https://play-staging.catalystos.net` | `https://play.catalystos.net` |
| WQ3 | `https://econtract-staging.tawqe3y.com` | `https://econtract.tawqe3y.com` |

The sandbox domains are approved target names, not evidence of deployed applications. DNS, TLS, runtime deployment, health checks, and exact webhook/return paths are implementation prerequisites. Exact paths must follow each application's routing conventions and may not be invented in the platform plan.

## Payment and webhook flow

For each project and environment:

1. The customer client asks its own application backend to create a payment.
2. The backend selects its configured merchant and fixed profile, generates a unique merchant reference and idempotency key, and creates an EGP payment through Hyperswitch.
3. Hyperswitch routes the payment through the Stripe connector account attached to that profile.
4. Stripe sends connector events to the verified Hyperswitch connector webhook endpoint.
5. Hyperswitch verifies and applies provider events, then sends an outgoing webhook to the project backend's configured endpoint.
6. The project verifies the Hyperswitch webhook signature, rejects stale or invalid requests, deduplicates the event, retrieves the payment from Hyperswitch, and applies an idempotent local state transition.
7. The customer return URL controls navigation only. It is never proof of payment success.

Timeouts and ambiguous connector results remain pending until webhook processing or an explicit Hyperswitch status retrieval establishes the final state. A retry of payment creation uses the original idempotency key. Provider failures must never be represented as successful payments.

## Application integration sequence

Use separate application workstreams rather than a single cross-repository patch:

1. Startpad first, because it already has a payment-provider abstraction and direct Stripe checkout flow that can be replaced behind that boundary.
2. MulkStay after defining its payment domain and backend boundary.
3. Hackathon after defining its payment domain and backend boundary.
4. WQ3 after locating and reviewing its authoritative source and current payment behavior.

Each application receives its own design, implementation plan, tests, staging deployment, and production approval. One project's failure does not block already validated projects and must not trigger unrelated changes in their repositories.

## Migration and cutover

1. Inventory the live services, version or image digest, configuration source of truth, organization hierarchy, active connector accounts, application credentials, webhooks, DNS, database, Redis, workers, and monitoring.
2. Capture and verify a restorable PostgreSQL snapshot plus the current service/image/configuration references. The snapshot is for operational rollback, not data migration.
3. Freeze account and connector changes for the migration window.
4. Create the new organization hierarchy alongside the old configuration where supported. If names collide, rename or disable the old objects temporarily rather than deleting them first.
5. Provision the sandbox domains and applications, then create sandbox merchants, profiles, API keys, Stripe test connector accounts, routing, return URLs, and webhooks.
6. Run the complete sandbox validation gate for an application before creating or enabling its production connector configuration.
7. Migrate production one application at a time in the approved order. Configure its live Stripe connector, fixed IDs, API key, routing, return URL, and outgoing webhook, then perform controlled verification.
8. Keep the former configuration inactive but recoverable through an observation window. Rollback restores prior application configuration and routes; it never rewrites payment records manually.
9. After all four projects pass production verification and receive explicit final approval, revoke old API keys and webhook secrets, disable old connector accounts, and remove obsolete objects through supported Hyperswitch APIs.
10. Do not use direct database deletion, truncation, schema manipulation, or destructive rollback migrations. Retain the snapshot until post-cutover sign-off.

Every production mutation, including removal of obsolete data, requires an implementation-time target inventory and explicit approval immediately before execution. Approval of this design is not approval to execute destructive steps.

## Validation and observability gate

Each project must independently prove:

- staging DNS, TLS, application health, and dependency readiness;
- the correct sandbox merchant/profile IDs and absence of production credentials in staging;
- EGP payment creation with unique merchant references and idempotency keys;
- Stripe test outcomes for success, decline, insufficient funds, and 3DS when supported;
- duplicate client requests do not create duplicate charges;
- valid Hyperswitch webhooks are accepted and invalid signatures, stale requests, and replays are rejected;
- duplicate and out-of-order events do not regress final payment state;
- timeout recovery retrieves status instead of blindly retrying;
- capture, cancellation or void, refund, and status synchronization work for the flows the application supports;
- credentials, routing, webhooks, transactions, and logs remain separated across profiles and environments;
- logs are structured and correlated by non-secret payment, merchant, profile, and request identifiers without PAN, CVV, keys, tokens, or raw sensitive payloads;
- application automated tests and sandbox integration tests pass;
- the deployed versions are pinned and migration compatibility, backup restoration, and rollback rehearsal are evidenced.

After each production cutover, execute one controlled low-value EGP payment and refund when supported, verify the outgoing webhook and application state, inspect Hyperswitch and Stripe state, and monitor health and error rates. A started container, clean Git status, or successful account creation is not production validation.

## Access governance

`info@healiot.com` is the initial Healiot LLC Organization Admin and may administer the four merchants. MFA and verified recovery controls are required before live credentials are configured. No human password, recovery code, API key, connector credential, or webhook secret is stored in Git or the operational design.

Each application receives distinct sandbox and production server API keys. Keys are named, expiration-aware, independently rotatable, and stored only in runtime secrets. Project users added later receive the least-privileged profile-level Developer, Operator, IAM, or View Only role required. Merchant or Organization Admin is not granted solely to operate one project. Invitations, role changes, API-key operations, and connector-secret changes are recorded without secret values. A second emergency Organization Admin is recommended after initial setup to avoid a single point of administrative access.

## Failure boundaries and prerequisites

Stop before mutation if the authoritative deployment, backup/restore path, running version, admin access, database, or Redis target cannot be proven. Stop before live connector setup if sandbox does not pass. Stop before an application cutover if its webhook verification, idempotency, status recovery, rollback, or monitoring is incomplete. Stop before removing old objects if any project still references them or if the observation window lacks explicit sign-off.

Implementation planning requires the following external inputs or discoveries:

- verified Coolify and runtime source of truth;
- current live service and account inventory;
- restorable backup procedure and restore evidence;
- Stripe test and live accounts for every project, supplied through a secret manager;
- deployed staging applications on the approved domains;
- exact application-owned return and outgoing-webhook paths;
- WQ3's authoritative source repository;
- maintenance window, observation-window duration, and final destructive-cutover approver;
- a second emergency administrator decision.

Where a prerequisite is unavailable, the implementation plan must leave that step blocked rather than fabricate configuration or use production as a test environment.
