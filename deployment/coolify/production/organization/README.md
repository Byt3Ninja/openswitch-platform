# Healiot LLC organization foundation

`desired-state.json` is the non-secret source of intent for the Healiot LLC organization, four merchants, and eight profiles. Validate it with `python3 scripts/validate_organization_manifest.py` before and after every edit.

The `private/` directory is runtime-only and Git-ignored. Store the fresh Coolify/Hyperswitch inventory, generated identifiers, backup and restore evidence, approval record, and post-create verification there. It may contain operational identifiers and evidence references, but it must not contain passwords, API keys, connector credentials, webhook secrets, recovery codes, PAN, CVV, tokens, or raw payment payloads.

Before any account write, prove the authoritative Coolify application and environment, fully qualified image digest or immutable version, router/API health, API generation, worker topology, PostgreSQL resource and database, Redis resource, domain/TLS state, current organization/merchant/profile inventory, authenticated administrator, monitoring path, configured backup mechanism, and an isolated successful restore. Record the inventory timestamp and the operator who collected it. Stop if any target is ambiguous.

Request action-time approval with the inventory fingerprint, restore evidence reference, exact objects to create, expected administrator, and rollback statement. Approval authorizes only creation of the named organization, merchants, and profiles. It does not authorize API keys, connectors, secrets, routes, webhooks, application changes, deletion, disabling, renaming, revocation, or direct database work.

Create a new platform organization named `Healiot LLC` alongside the current organization. Do not rename, convert, or remove the current organization. Add `info@healiot.com` as Organization Admin only after the mailbox owner is ready to accept the invitation and enroll MFA and recovery controls. Retain the bootstrap administrator until a separately approved access review.

Within `Healiot LLC`, create merchants and profiles exactly as defined in `desired-state.json`. Before each create, list objects under the intended parent. If merchant creation automatically creates a `default` profile, update that new empty profile to the merchant's first approved profile name instead of leaving an extra profile or deleting it. If an exact or confusingly similar name already exists, stop and reconcile it; do not retry blindly. Record generated identifiers only in the private inventory. After creation, retrieve every object and verify its parent, display name, country, and currency. Do not create Stripe connectors or API keys in this foundation.

The foundation is complete only when the desired-state validator passes, the live hierarchy reads back as one organization with four merchants and eight profiles, `info@healiot.com` has verified access with MFA and recovery controls, the old configuration is unchanged, the backup remains retained, and no private evidence is staged in Git.
