# Coolify production

This directory reserves the production deployment boundary. It contains no deployable manifest or verified Coolify runtime settings. Do not copy staging or local Docker defaults here. A future production task requires staging evidence, explicit deployment approval, pinned image, separate secrets, backup/restore evidence, migration compatibility, health/readiness checks, rollback plan, and post-deployment payment-safe verification.

The approved account-hierarchy source of intent and its gated operator runbook live in `organization/`. They do not make this directory deployable and do not authorize a production mutation.
