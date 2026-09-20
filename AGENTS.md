# OpenSwitch platform agent instructions

This outer repository owns platform organization, safe configuration, deployment definitions, connector metadata, and documentation. hyperswitch/ is an official-upstream Git submodule, not ordinary source tracked by this repository. Preserve its independent update path and pin a reviewed commit. Do not copy upstream source into this repository.

## Start every substantial task

Inspect both Git repositories' status, remotes, pinned SHA, relevant docs, actual deployment configuration, and any nested AGENTS.md. Classify the work: A configuration; B deployment/infrastructure; C connector; D external extension; E upstream core modification. Search existing Hyperswitch settings, APIs, routing, connector mechanisms, events, and deployment options first. Prefer A, then B, then C/D; E is last resort. Use an available code graph for substantial impact analysis, but never deploy Graphify or codebase-memory as a payment service.

## Core approval gate

Treat upstream source, schemas, and migrations as effectively read-only. Before any E edit, stop and present the requirement, current and proposed behavior, exact affected files, evidence that configuration/API/routing/connector/deployment/adapter alternatives do not work, minimal patch, upgrade and merge-conflict risk, tests and migrations, and an upstream-contribution path. Wait for explicit human approval. Connector-specific code is C; changes to shared enums, router logic, or contracts may separately be E. Never edit an already-applied upstream migration.

## Boundaries and safety

Confirm the authoritative repository before editing a custom connector; do not copy it here. Keep customer-specific transformations, webhook processing, proprietary rules, and reconciliation outside core when a meaningful adapter/service boundary exists. Preserve idempotency, webhook signatures, error mapping, timeouts, retries, and redacted observability. Never log PAN, CVV, tokens, keys, or sensitive payment payloads; never invent cryptography or store cardholder data without security approval.

Coolify is the intended hosting platform, but this repository currently has no verified deployable configuration. Keep staging and production separate. Use runtime secrets, not committed values. Validate locally and in staging before any approved production action. Confirm image pin, health/readiness, backup, migration compatibility, and rollback. Never use production as a debugging sandbox or run destructive DB, volume, secret, or service operations without explicit authorization.

## Git and handoff

The hyperswitch/ submodule URL is official upstream. The old OpenSwitch checkout's origin URL is the platform remote, not a Hyperswitch fork destination: do not push from that checkout. Do not reset, clean, or overwrite its uncommitted Kashier work. Keep diffs minimal; do not reorganize upstream directories or run broad formatting. Validate the affected area, review status/diff/staged files, and report checks actually run. State Upstream core changes: NONE, or YES with the approval and files. Report configuration, database, deployment, rollback, and remaining-work implications without inventing operational facts.
