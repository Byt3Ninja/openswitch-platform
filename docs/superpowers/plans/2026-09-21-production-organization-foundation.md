# Healiot LLC Production Organization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an auditable, non-secret desired-state manifest, prove the existing OpenSwitch deployment and PostgreSQL rollback checkpoint, and create the Healiot LLC organization, merchants, and profiles only after an explicit action-time approval.

**Architecture:** The platform repository stores only the approved account hierarchy and a standard-library validator; generated identifiers and production evidence remain in a Git-ignored private directory. Operators inventory the existing Coolify/Hyperswitch deployment and prove a restorable backup before using supported Hyperswitch dashboard or API surfaces to create the hierarchy. This plan stops before API keys, Stripe connectors, routing, webhooks, application deployments, cutovers, or removal of old objects.

**Tech Stack:** JSON, Python 3 standard library, `unittest`, Git, the existing Hyperswitch dashboard/API, Coolify, and the deployment's verified PostgreSQL backup/restore mechanism.

**Spec:** `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/docs/superpowers/specs/2026-09-21-production-organization-migration-design.md`

## Global Constraints

- Category A configuration plus Category B deployment-readiness work; upstream core changes: NONE.
- Use the existing single Hyperswitch deployment. Sandbox and production are separate merchant accounts inside the same Healiot LLC organization, not separate infrastructure deployments.
- The target has exactly four merchants and eight profiles: GrowthLabs with MulkStay, Startpad, and Hackathon; GrowthLabs Sandbox with their three Sandbox profiles; Healiot Egypt with WQ3; and Healiot Egypt Sandbox with WQ3 Sandbox.
- Country is `EG` and currency is `EGP` for every merchant and profile. Stripe is the only planned connector; sandbox uses test mode and production uses live mode.
- `info@healiot.com` is the target Organization Admin. MFA and verified recovery controls must be complete before live credentials are configured.
- Generated organization, merchant, and profile identifiers are private operational inventory. Do not commit them, credentials, backup locations, resource identifiers, screenshots, or raw production exports.
- Do not create API keys, Stripe connector accounts, routing, return URLs, or webhooks in this foundation plan. Those require deployed staging applications and application-owned paths.
- Do not change the pinned `hyperswitch/` submodule, either connector submodule, the dirty `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch` checkout, schemas, migrations, databases, Redis data, or live application settings.
- Stop before mutation unless the authoritative Coolify application, running version or image digest, PostgreSQL target, Redis target, admin access, and backup/restore path are proven.
- Every production mutation needs a fresh target inventory and explicit approval immediately before execution. This plan and its commit are not mutation approval.
- Keep the old organization and all old objects unchanged and recoverable. Deletion, revocation, disabling, renaming, and access removal are outside this plan.
- Use supported Hyperswitch dashboard or API operations only. Never delete or rewrite account data directly in PostgreSQL.
- Preserve the pre-existing uncommitted `AGENTS.md` change and do not include it in any commit made by this plan.

## Review Focus

1. **Live state changed after approval:** Task 3 records a fresh inventory timestamp and fingerprint; Task 4 repeats the read-only checks and stops if any target differs.
2. **Backup exists but cannot restore:** Task 3 requires an isolated restore with query evidence; a snapshot job marked successful is insufficient.
3. **Sandbox/live boundary is inverted:** Task 1 tests every profile's environment, domain, and Stripe mode and rejects any mismatch.
4. **Secret or private evidence is staged:** Tasks 1, 2, and 5 test recursive secret-key rejection, Git ignore behavior, and the complete staged file list.
5. **A retry creates duplicate accounts:** Task 4 performs name-and-parent preflight before each create and stops for reconciliation whenever an intended object already exists.

---

### Task 1: Define and validate the non-secret hierarchy

**Files:**
- Create: `deployment/coolify/production/organization/desired-state.json`
- Create: `scripts/__init__.py`
- Create: `scripts/validate_organization_manifest.py`
- Create: `tests/test_validate_organization_manifest.py`

**Interfaces:**
- Consumes: the approved names, domains, country, currency, environments, and Stripe modes from the design spec.
- Produces: `validate_manifest(data: dict) -> list[str]` and a CLI that exits `0` only when the canonical manifest is valid. Tasks 2–5 use the manifest as the sole Git-tracked source of desired account names.

- [ ] **Step 1: Write the failing validator tests.** Create `scripts/__init__.py` as an empty file and create `tests/test_validate_organization_manifest.py` with this content using `apply_patch`:

```python
import copy
import json
import unittest
from pathlib import Path

from scripts.validate_organization_manifest import validate_manifest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deployment/coolify/production/organization/desired-state.json"


class OrganizationManifestTests(unittest.TestCase):
    def load_manifest(self):
        return json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_approved_manifest_is_valid(self):
        self.assertEqual(validate_manifest(self.load_manifest()), [])

    def test_rejects_sandbox_profile_using_live_stripe_mode(self):
        data = self.load_manifest()
        data["merchants"][1]["profiles"][0]["stripe_mode"] = "live"
        self.assertIn(
            "profile mulkstay_sandbox must use Stripe test mode",
            validate_manifest(data),
        )

    def test_rejects_duplicate_application_domain(self):
        data = self.load_manifest()
        data["merchants"][1]["profiles"][0]["base_url"] = "https://mulkstay.com"
        self.assertIn("profile base_url values must be unique", validate_manifest(data))

    def test_rejects_missing_profile(self):
        data = self.load_manifest()
        data["merchants"][0]["profiles"].pop()
        self.assertIn(
            "merchant growthlabs_production profiles differ from approved state",
            validate_manifest(data),
        )

    def test_rejects_secret_shaped_fields(self):
        data = copy.deepcopy(self.load_manifest())
        data["stripe_secret_key"] = "not-a-credential"
        self.assertIn(
            "manifest contains forbidden secret-shaped key: stripe_secret_key",
            validate_manifest(data),
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and verify the RED state.**

Run: `python3 -m unittest tests/test_validate_organization_manifest.py -v`

Expected: import failure because `scripts.validate_organization_manifest` does not exist. If another failure occurs, fix the test harness before proceeding.

- [ ] **Step 3: Create the canonical desired-state manifest.** Create `deployment/coolify/production/organization/desired-state.json` with this exact content using `apply_patch`:

```json
{
  "schema_version": 1,
  "organization": {
    "display_name": "Healiot LLC",
    "initial_admin_email": "info@healiot.com"
  },
  "defaults": {
    "country": "EG",
    "currency": "EGP",
    "connector": "stripe"
  },
  "merchants": [
    {
      "key": "growthlabs_production",
      "display_name": "GrowthLabs",
      "environment": "production",
      "profiles": [
        {
          "key": "mulkstay_production",
          "display_name": "MulkStay",
          "project": "mulkstay",
          "base_url": "https://mulkstay.com",
          "stripe_mode": "live"
        },
        {
          "key": "startpad_production",
          "display_name": "Startpad",
          "project": "startpad",
          "base_url": "https://startpad.me",
          "stripe_mode": "live"
        },
        {
          "key": "hackathon_production",
          "display_name": "Hackathon",
          "project": "hackathon",
          "base_url": "https://play.catalystos.net",
          "stripe_mode": "live"
        }
      ]
    },
    {
      "key": "growthlabs_sandbox",
      "display_name": "GrowthLabs Sandbox",
      "environment": "sandbox",
      "profiles": [
        {
          "key": "mulkstay_sandbox",
          "display_name": "MulkStay Sandbox",
          "project": "mulkstay",
          "base_url": "https://staging.mulkstay.com",
          "stripe_mode": "test"
        },
        {
          "key": "startpad_sandbox",
          "display_name": "Startpad Sandbox",
          "project": "startpad",
          "base_url": "https://staging.startpad.me",
          "stripe_mode": "test"
        },
        {
          "key": "hackathon_sandbox",
          "display_name": "Hackathon Sandbox",
          "project": "hackathon",
          "base_url": "https://play-staging.catalystos.net",
          "stripe_mode": "test"
        }
      ]
    },
    {
      "key": "healiot_egypt_production",
      "display_name": "Healiot Egypt",
      "environment": "production",
      "profiles": [
        {
          "key": "wq3_production",
          "display_name": "WQ3",
          "project": "wq3",
          "base_url": "https://econtract.tawqe3y.com",
          "stripe_mode": "live"
        }
      ]
    },
    {
      "key": "healiot_egypt_sandbox",
      "display_name": "Healiot Egypt Sandbox",
      "environment": "sandbox",
      "profiles": [
        {
          "key": "wq3_sandbox",
          "display_name": "WQ3 Sandbox",
          "project": "wq3",
          "base_url": "https://econtract-staging.tawqe3y.com",
          "stripe_mode": "test"
        }
      ]
    }
  ],
  "production_cutover_order": [
    "startpad",
    "mulkstay",
    "hackathon",
    "wq3"
  ]
}
```

- [ ] **Step 4: Implement the validator.** Create `scripts/validate_organization_manifest.py` with this complete content using `apply_patch`:

```python
#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


FORBIDDEN_KEY = re.compile(
    r"(^|_)(secret|password|token|private_key|api_key_value|webhook_secret)(_|$)",
    re.IGNORECASE,
)
EXPECTED_PROFILES = {
    "growthlabs_production": {
        "mulkstay_production": ("MulkStay", "mulkstay", "https://mulkstay.com", "live"),
        "startpad_production": ("Startpad", "startpad", "https://startpad.me", "live"),
        "hackathon_production": ("Hackathon", "hackathon", "https://play.catalystos.net", "live"),
    },
    "growthlabs_sandbox": {
        "mulkstay_sandbox": ("MulkStay Sandbox", "mulkstay", "https://staging.mulkstay.com", "test"),
        "startpad_sandbox": ("Startpad Sandbox", "startpad", "https://staging.startpad.me", "test"),
        "hackathon_sandbox": ("Hackathon Sandbox", "hackathon", "https://play-staging.catalystos.net", "test"),
    },
    "healiot_egypt_production": {
        "wq3_production": ("WQ3", "wq3", "https://econtract.tawqe3y.com", "live"),
    },
    "healiot_egypt_sandbox": {
        "wq3_sandbox": ("WQ3 Sandbox", "wq3", "https://econtract-staging.tawqe3y.com", "test"),
    },
}
EXPECTED_MERCHANTS = {
    "growthlabs_production": ("GrowthLabs", "production"),
    "growthlabs_sandbox": ("GrowthLabs Sandbox", "sandbox"),
    "healiot_egypt_production": ("Healiot Egypt", "production"),
    "healiot_egypt_sandbox": ("Healiot Egypt Sandbox", "sandbox"),
}


def secret_shaped_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_KEY.search(key):
                yield key
            yield from secret_shaped_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from secret_shaped_keys(child)


def validate_manifest(data: dict) -> list[str]:
    errors = []
    for key in sorted(set(secret_shaped_keys(data))):
        errors.append(f"manifest contains forbidden secret-shaped key: {key}")

    if data.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    if data.get("organization") != {
        "display_name": "Healiot LLC",
        "initial_admin_email": "info@healiot.com",
    }:
        errors.append("organization differs from approved state")
    if data.get("defaults") != {
        "country": "EG",
        "currency": "EGP",
        "connector": "stripe",
    }:
        errors.append("defaults must be country EG, currency EGP, connector stripe")
    if data.get("production_cutover_order") != ["startpad", "mulkstay", "hackathon", "wq3"]:
        errors.append("production_cutover_order differs from approved state")

    merchants = data.get("merchants")
    if not isinstance(merchants, list):
        return errors + ["merchants must be a list"]
    keyed_merchants = {merchant.get("key"): merchant for merchant in merchants if isinstance(merchant, dict)}
    if set(keyed_merchants) != set(EXPECTED_MERCHANTS) or len(merchants) != 4:
        errors.append("merchant keys differ from approved state")

    base_urls = []
    for merchant_key, (display_name, environment) in EXPECTED_MERCHANTS.items():
        merchant = keyed_merchants.get(merchant_key)
        if merchant is None:
            continue
        if merchant.get("display_name") != display_name or merchant.get("environment") != environment:
            errors.append(f"merchant {merchant_key} differs from approved state")
        profiles = merchant.get("profiles")
        if not isinstance(profiles, list):
            errors.append(f"merchant {merchant_key} profiles must be a list")
            continue
        keyed_profiles = {profile.get("key"): profile for profile in profiles if isinstance(profile, dict)}
        expected = EXPECTED_PROFILES[merchant_key]
        if set(keyed_profiles) != set(expected) or len(profiles) != len(expected):
            errors.append(f"merchant {merchant_key} profiles differ from approved state")
        for profile_key, expected_values in expected.items():
            profile = keyed_profiles.get(profile_key)
            if profile is None:
                continue
            actual_values = (
                profile.get("display_name"),
                profile.get("project"),
                profile.get("base_url"),
                profile.get("stripe_mode"),
            )
            if actual_values != expected_values:
                errors.append(f"profile {profile_key} differs from approved state")
            required_mode = "test" if environment == "sandbox" else "live"
            if profile.get("stripe_mode") != required_mode:
                errors.append(f"profile {profile_key} must use Stripe {required_mode} mode")
            base_url = profile.get("base_url")
            if isinstance(base_url, str):
                base_urls.append(base_url)

    if len(base_urls) != len(set(base_urls)):
        errors.append("profile base_url values must be unique")
    return errors


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) == 2 else Path(
        "deployment/coolify/production/organization/desired-state.json"
    )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"manifest read failed: {error}", file=sys.stderr)
        return 2
    errors = validate_manifest(data)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("organization manifest valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
```

- [ ] **Step 5: Run the focused and CLI tests.**

```bash
python3 -m unittest tests/test_validate_organization_manifest.py -v
python3 scripts/validate_organization_manifest.py
```

Expected: five passing tests and `organization manifest valid`.

- [ ] **Step 6: Commit only the manifest and validator slice.**

```bash
git add deployment/coolify/production/organization/desired-state.json scripts/__init__.py scripts/validate_organization_manifest.py tests/test_validate_organization_manifest.py
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: define production organization hierarchy"
```

Expected staged paths: exactly the four paths listed above. `AGENTS.md` remains unstaged.

### Task 2: Add the private-evidence boundary and operator runbook

**Files:**
- Create: `.gitignore`
- Create: `deployment/coolify/production/organization/README.md`
- Modify: `deployment/coolify/production/README.md`

**Interfaces:**
- Consumes: Task 1's validated desired state.
- Produces: a Git-enforced private evidence boundary at `deployment/coolify/production/organization/private/` and the exact stop/go gates used by Tasks 3–5.

- [ ] **Step 1: Prove private evidence is not currently ignored.**

Run: `git check-ignore deployment/coolify/production/organization/private/readiness.json`

Expected: exit status `1` and no output.

- [ ] **Step 2: Create `.gitignore`.** Use `apply_patch` with this exact content:

```gitignore
# Runtime-only production inventory, generated identifiers, and backup evidence.
deployment/coolify/production/organization/private/
```

- [ ] **Step 3: Create the operator runbook.** Create `deployment/coolify/production/organization/README.md` with this exact content using `apply_patch`:

```markdown
# Healiot LLC organization foundation

`desired-state.json` is the non-secret source of intent for the Healiot LLC organization, four merchants, and eight profiles. Validate it with `python3 scripts/validate_organization_manifest.py` before and after every edit.

The `private/` directory is runtime-only and Git-ignored. Store the fresh Coolify/Hyperswitch inventory, generated identifiers, backup and restore evidence, approval record, and post-create verification there. It may contain operational identifiers and evidence references, but it must not contain passwords, API keys, connector credentials, webhook secrets, recovery codes, PAN, CVV, tokens, or raw payment payloads.

Before any account write, prove the authoritative Coolify application and environment, fully qualified image digest or immutable version, router/API health, API generation, worker topology, PostgreSQL resource and database, Redis resource, domain/TLS state, current organization/merchant/profile inventory, authenticated administrator, monitoring path, configured backup mechanism, and an isolated successful restore. Record the inventory timestamp and the operator who collected it. Stop if any target is ambiguous.

Request action-time approval with the inventory fingerprint, restore evidence reference, exact objects to create, expected administrator, and rollback statement. Approval authorizes only creation of the named organization, merchants, and profiles. It does not authorize API keys, connectors, secrets, routes, webhooks, application changes, deletion, disabling, renaming, revocation, or direct database work.

Create a new platform organization named `Healiot LLC` alongside the current organization. Do not rename, convert, or remove the current organization. Add `info@healiot.com` as Organization Admin only after the mailbox owner is ready to accept the invitation and enroll MFA and recovery controls. Retain the bootstrap administrator until a separately approved access review.

Within `Healiot LLC`, create merchants and profiles exactly as defined in `desired-state.json`. Before each create, list objects under the intended parent. If merchant creation automatically creates a `default` profile, update that new empty profile to the merchant's first approved profile name instead of leaving an extra profile or deleting it. If an exact or confusingly similar name already exists, stop and reconcile it; do not retry blindly. Record generated identifiers only in the private inventory. After creation, retrieve every object and verify its parent, display name, country, and currency. Do not create Stripe connectors or API keys in this foundation.

The foundation is complete only when the desired-state validator passes, the live hierarchy reads back as one organization with four merchants and eight profiles, `info@healiot.com` has verified access with MFA and recovery controls, the old configuration is unchanged, the backup remains retained, and no private evidence is staged in Git.
```

- [ ] **Step 4: Link the production boundary to the runbook.** Append this paragraph to `deployment/coolify/production/README.md` using `apply_patch`:

```markdown

The approved account-hierarchy source of intent and its gated operator runbook live in `organization/`. They do not make this directory deployable and do not authorize a production mutation.
```

- [ ] **Step 5: Test the ignore boundary and documentation.**

```bash
git check-ignore -v deployment/coolify/production/organization/private/readiness.json
python3 scripts/validate_organization_manifest.py
rg -n 'API keys|Stripe connectors|explicit|action-time|private/' deployment/coolify/production/organization/README.md
```

Expected: `git check-ignore` points to `.gitignore`; the manifest is valid; the runbook explicitly blocks API keys/connectors and requires action-time approval.

- [ ] **Step 6: Commit the runbook slice.**

```bash
git add .gitignore deployment/coolify/production/README.md deployment/coolify/production/organization/README.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: gate production organization provisioning"
```

Expected staged paths: exactly the three paths listed above. The private directory and `AGENTS.md` are not staged.

### Task 3: Collect live inventory and prove rollback readiness

**Files:**
- Runtime-only: `deployment/coolify/production/organization/private/readiness.json`
- Runtime-only: evidence referenced from `readiness.json`; do not copy secret-bearing exports or database dumps into the repository.

**Interfaces:**
- Consumes: Task 2's runbook and the authoritative Coolify, Hyperswitch, PostgreSQL, Redis, DNS/TLS, and monitoring surfaces.
- Produces: a timestamped private readiness record with an immutable deployment fingerprint and successful isolated restore evidence. Task 4 must reject an absent, incomplete, stale, or changed record.

- [ ] **Step 1: Re-establish repository and source baselines.**

```bash
git status --short
git submodule status
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch status --short
```

Expected: only the pre-existing `AGENTS.md` change in the platform parent; pinned submodules unchanged; old checkout HEAD `568a91925fc7ae1948838e105afdd98210cb3152` with its prior dirty state. Stop on any unexplained difference; do not reset or clean either repository.

- [ ] **Step 2: Capture a read-only deployment fingerprint in the private readiness record.** Use the authoritative Coolify console and running service to record all of the following with their actual observed values and observation time:

```json
{
  "observed_at": "an ISO-8601 UTC timestamp",
  "operator": "the authenticated operator identity",
  "coolify": {
    "project": "the observed project name",
    "environment": "the observed environment name",
    "application_id": "the observed Coolify application identifier",
    "application_name": "the observed application name",
    "source_revision": "the immutable deployed source revision when available",
    "image_digest": "the fully qualified running image digest",
    "services": ["the observed router, worker, and auxiliary service names"]
  },
  "hyperswitch": {
    "health_url": "the verified router health URL",
    "health_status": "healthy",
    "api_generation": "the observed v1 or v2 generation",
    "current_organization_count": 1,
    "current_organization_names": ["the complete observed list"],
    "authenticated_admin": "the signed-in administrator"
  },
  "postgresql": {
    "resource_id": "the observed Coolify database resource identifier",
    "database_name": "the observed database name",
    "backup_mechanism": "the already configured backup mechanism",
    "snapshot_reference": "the immutable backup job or snapshot reference",
    "snapshot_completed_at": "an ISO-8601 UTC timestamp",
    "restore_target": "the isolated non-production restore target",
    "restore_completed_at": "an ISO-8601 UTC timestamp",
    "restore_check": "the successful read-only query and result reference"
  },
  "redis": {
    "resource_id": "the observed Coolify Redis resource identifier",
    "role": "the observed cache, queue, or combined role"
  },
  "operations": {
    "monitoring_location": "the verified health and error monitoring location",
    "maintenance_window": "the approved window including timezone",
    "observation_window_hours": 24,
    "change_approver": "the person authorized to approve account creation"
  }
}
```

Every string above must be replaced by an observed value; the phrases shown are field definitions, not acceptable saved values. Record identifiers and references, not credentials or raw environment-variable exports. The current dashboard observation shows an organization named `Healiot` and a signed-in `m.ahmed@healiot.com`; re-verify both rather than treating that observation as current truth.

- [ ] **Step 3: Verify the live image/API compatibility read-only.** Compare the running image digest or immutable version to its release metadata and determine whether the supported organization, merchant, and profile operations are v1 or v2. Confirm the dashboard's Organization Settings can create a new platform organization. Stop if the running build cannot be identified, the required create/read operations are unavailable, or the deployment differs from the source baseline in a way that changes request shapes. Do not assume the pinned source commit is the deployed version.

- [ ] **Step 4: Capture a new PostgreSQL snapshot through the verified existing backup mechanism.** Record its immutable job/snapshot reference and successful completion time in `readiness.json`. Do not use ad-hoc direct database export commands, change retention, restart services, or download the dump into the repository. If no authoritative backup mechanism is configured, stop and open a separately approved infrastructure task.

- [ ] **Step 5: Restore the snapshot to an isolated non-production target and query it read-only.** Use the documented restore path for the verified mechanism, then prove the restored database is reachable and contains the expected Hyperswitch schema and organization rows. Record the isolated target, completion time, exact read-only check, row-count result, and evidence reference. Destroying the restore target is outside this plan. Stop if restore or validation fails.

- [ ] **Step 6: Perform the readiness gate.** Check that every field in the JSON structure is an observed value, the health status is healthy, the image identifier is immutable, the current hierarchy is complete, backup and restore references are distinct and successful, PostgreSQL/Redis targets match the application, the maintenance window and approver are named, and the file contains no credentials. Then verify Git isolation:

```bash
git check-ignore -v deployment/coolify/production/organization/private/readiness.json
git status --short
```

Expected: the private record is ignored and `git status --short` still shows only the pre-existing `AGENTS.md` change. Task 4 remains blocked until this entire gate passes.

### Task 4: Create the Healiot LLC organization hierarchy

**Files:**
- Runtime-only: update `deployment/coolify/production/organization/private/readiness.json`
- Runtime-only: create `deployment/coolify/production/organization/private/created-state.json`

**Interfaces:**
- Consumes: the valid desired-state manifest and Task 3's fresh readiness/restore evidence.
- Produces: one new `Healiot LLC` organization containing four merchants and eight profiles, plus a private generated-ID inventory. It produces no API keys, connector accounts, routes, webhooks, or application changes.

- [ ] **Step 1: Repeat the read-only target checks immediately before requesting approval.** Re-read the Coolify application identifier, running image digest, Hyperswitch health/API generation, current organization/merchant/profile list, authenticated administrator, PostgreSQL resource, Redis resource, and backup snapshot reference. Compare them byte-for-byte with the readiness record. Stop on drift and rebuild the readiness record and restore evidence.

- [ ] **Step 2: Present the action-time approval packet and wait.** The packet must name: the authoritative application; immutable running image; current `Healiot` organization; new `Healiot LLC` organization; all four merchant names; all eight profile names; the supported update of each newly auto-created empty `default` profile into its first approved named profile; `EG`/`EGP`; `info@healiot.com`; the snapshot and restore evidence references; the fact that the old organization stays unchanged; and the explicit exclusions for keys, connectors, routes, webhooks, app settings, access removal, and deletion. Do not click a create, save, submit, invite, or permission-change control until the user explicitly approves this packet.

- [ ] **Step 3: Create the new platform organization through the verified supported surface.** In the dashboard Organization Settings, use `Create New Platform Organization` and set the name to `Healiot LLC`, or use the deployment's documented equivalent API operation if the dashboard delegates to it. Immediately retrieve the created organization and record its generated identifier in `created-state.json`. If `Healiot LLC` or a confusingly similar organization already exists, do not create another; stop and reconcile ownership and intended reuse.

- [ ] **Step 4: Establish the target administrator.** Invite `info@healiot.com` as Organization Admin through the supported IAM surface. Sending the invitation and granting the role require action-time confirmation if the prior approval packet did not explicitly cover both. Pause until the mailbox owner accepts, signs in, enrolls MFA, configures verified recovery controls, and confirms access to the new organization. Record only status, timestamps, and user identifier; never record passwords, recovery codes, or session material. Keep `m.ahmed@healiot.com` as bootstrap access; changing or removing it requires a separate access review.

- [ ] **Step 5: Create the four merchants one at a time.** Under the new organization's generated identifier, list existing merchants before each operation, then create exactly this sequence with country `EG` and currency `EGP`:

1. `GrowthLabs Sandbox`
2. `Healiot Egypt Sandbox`
3. `GrowthLabs`
4. `Healiot Egypt`

After every create, retrieve the merchant, verify its parent organization/name/country/currency, and write the generated identifier to `created-state.json`. Stop on duplicate, ambiguous parent, unexpected default profile behavior, or response mismatch. Do not retry a request whose outcome is unknown; retrieve first.

- [ ] **Step 6: Reuse each platform-created default profile without deleting it.** For each new merchant, list its profiles. If Hyperswitch created one empty `default` profile automatically, update that profile through the supported profile update operation and verify the same generated profile identifier now has this approved name:

1. GrowthLabs Sandbox: `MulkStay Sandbox`
2. Healiot Egypt Sandbox: `WQ3 Sandbox`
3. GrowthLabs: `MulkStay`
4. Healiot Egypt: `WQ3`

Set or verify country `EG` and currency `EGP` wherever the deployed operation exposes them. Record the before/after names and stable identifier in the private inventory. If a default profile already has connectors, API keys, routes, webhooks, transactions, or any non-default configuration, stop; do not repurpose or delete it.

- [ ] **Step 7: Create the four remaining approved named profiles.** List profiles before each create and use country `EG` and currency `EGP` wherever the deployed API exposes them. Create profiles under their exact merchant parents in this order:

1. GrowthLabs Sandbox: `Startpad Sandbox`, `Hackathon Sandbox`
2. GrowthLabs: `Startpad`, `Hackathon`

After every create, retrieve it, verify parent/name/country/currency, and store the generated identifier in the private inventory. Stop on an existing or ambiguous name, unknown response, wrong parent, or unsupported field. Do not create a Stripe connector, route, webhook, or API key while visiting a profile.

- [ ] **Step 8: Validate the created hierarchy read-only.** Sign in as `info@healiot.com`, select `Healiot LLC`, and verify access to all four merchants and eight approved profiles. Export or record a read-only list and compare names and parent relationships to `desired-state.json`. Confirm the old `Healiot` organization and its objects still read back unchanged from the Task 3 baseline. Confirm no new API keys, connector accounts, routing rules, or webhooks exist for the new hierarchy.

- [ ] **Step 9: Verify the private inventory is not staged.**

```bash
python3 scripts/validate_organization_manifest.py
git check-ignore -v deployment/coolify/production/organization/private/readiness.json
git check-ignore -v deployment/coolify/production/organization/private/created-state.json
git status --short
```

Expected: the manifest is valid; both private files are ignored; the only parent change is the pre-existing `AGENTS.md` edit. If any tracked file changed during the live operation, stop and review it before continuing.

### Task 5: Produce the foundation handoff and preserve the next gates

**Files:**
- No additional tracked files.
- Runtime-only: finalize `deployment/coolify/production/organization/private/created-state.json` and the operator transcript.

**Interfaces:**
- Consumes: Tasks 1–4 and the live read-back evidence.
- Produces: an operational handoff that is sufficient to start independent Startpad, MulkStay, Hackathon, and WQ3 designs without exposing generated identifiers or implying payment readiness.

- [ ] **Step 1: Run the complete repository verification.**

```bash
python3 -m unittest discover -s tests -v
python3 scripts/validate_organization_manifest.py
git diff --check
git status --short
git log --oneline -5
git submodule status
```

Expected: all tests pass; manifest valid; no whitespace errors; `AGENTS.md` remains the only uncommitted tracked change; all three submodules remain pinned. Do not stage or commit `AGENTS.md`.

- [ ] **Step 2: Scan tracked content for accidental private material.**

```bash
git grep -nEi '(sk_(live|test)|api[_-]?key[[:space:]]*[:=]|password[[:space:]]*[:=]|webhook[_-]?secret[[:space:]]*[:=]|org_[A-Za-z0-9]{12,}|mca_[A-Za-z0-9]{12,})' -- . ':!docs/superpowers/plans/2026-09-21-production-organization-foundation.md'
git ls-files deployment/coolify/production/organization/private
```

Expected: no secret values or generated live identifiers in tracked content and no tracked private paths. Review any match manually; field names in validation code are acceptable only when no value is present.

- [ ] **Step 3: Record the operational outcome without copying private identifiers into Git or chat.** The handoff must state: readiness inventory timestamp; immutable deployed image/version; health result; backup and isolated restore result; organization/merchant/profile creation result; administrator/MFA/recovery result; whether platform default profiles exist; old-organization preservation result; tests run; and any stopped gate. Refer to private evidence by local reference, not by secret or generated identifier.

- [ ] **Step 4: State the remaining blocked work explicitly.** The hierarchy is not payment-ready. Separate designs and plans are still required for: staging DNS/TLS/runtime deployment; Startpad's direct-Stripe migration; MulkStay payment-domain integration; Hackathon payment-domain integration; discovery of WQ3's authoritative repository and current behavior; per-environment API keys; per-profile Stripe test/live connectors; routes; return paths; outgoing webhooks; sandbox validation; one-project-at-a-time production cutover; observation windows; and separately approved old-object revocation/removal.

- [ ] **Step 5: Report scope and safety.** Report Category A/B, Upstream core changes: NONE, no application repository changes, no Stripe/API-key/connector creation, no schema/database/Redis mutation beyond the approved backup and isolated restore, no deployment, no old-object or access removal, and no push unless the user separately asks for one.
