# Sandbox connector rollout boundary

`desired-state.json` is the fixed, non-secret connector rollout contract for the approved sandbox hierarchy. Validate it before and after every tracked edit:

```sh
python3 scripts/validate_connector_rollout_manifest.py
```

This contract describes five intended merchant connector accounts (MCAs): one Kashier test MCA on each of MulkStay Sandbox, Startpad Sandbox, Hackathon Sandbox, and WQ3 Sandbox, plus one EasyKash MCA on WQ3 Sandbox. Kashier is a test-environment connector. EasyKash is a low-risk live-provider pilot because it has no separate provider test environment.

Routing remains `explicit_only`. Neither connector may become a default, fallback, split, or ordinary-traffic route. All validation requests must explicitly select the intended MCA. MulkStay, Startpad, Hackathon, and WQ3 production profiles are excluded. EasyKash is limited to WQ3 Sandbox; expanding it requires separate provider-capacity evidence and approval.

Credentials are never stored in this manifest, Git, images, Coolify variables, reports, chat, or shell history. A human operator enters credentials only through the authenticated OpenSwitch connector-account flow at the action boundary. Do not include credential material, authorization headers, payment data, or sensitive operational identifiers in tracked files or reports.

Generated inventory, deployment, activation, rollback, and handoff evidence belongs only in `deployment/coolify/production/connectors/private/`, which is Git-ignored. Retain only sanitized, non-secret references in tracked documentation.

The parent-owned `compatibility/santander-metadata.patch` is a temporary, explicitly approved upstream compatibility repair for Hyperswitch commit `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1`. It inserts exactly one missing Santander metadata table header into fresh generated backend source before Kashier then EasyKash integration. The validator rejects dirty or different source revisions, patch expansion, and invalid full TOML. The official submodule and connector repositories remain untouched. Remove the patch and its application guard when a reviewed upstream pin incorporates the equivalent fix; do not broaden it during an upgrade. See [connector packaging](../../../../connectors/README.md).

Before an account or deployment write, collect fresh authoritative application and environment inventory, immutable image references, non-secret endpoint configuration, health and readiness results, router and scheduler topology, database and Redis bindings, backup and restore evidence, and rollback commands. Obtain action-time approval for the exact deployment packet. Credential entry requires a separate sensitive-data handoff or confirmation. The EasyKash payment requires a further approval that states its capped amount, currency, WQ3 Sandbox target, and low-risk provider account.

Before MCA creation, confirm router, scheduler, and dashboard health; dependency readiness; both feature-matrix entries; and the signed-in connector catalog for Kashier and EasyKash. Do not create a routing rule. Validate only supported hosted-card automatic capture, payment sync, and signed payment webhooks. Manual capture, void, refund, saved-card, recurring-payment, and payout flows remain unsupported.

Rollback before MCA creation restores the prior application images and non-secret configuration for affected application components only. After MCA creation, first disable the new MCAs and confirm no route selects them, then restore prior images and configuration. Do not restart databases, delete payment or encrypted MCA records, reverse unrelated changes, or erase evidence.
