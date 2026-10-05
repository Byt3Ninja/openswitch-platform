# Kashier and EasyKash Sandbox Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy reproducible Kashier and EasyKash support, validate Kashier on all four OpenSwitch sandbox profiles, and validate one low-risk EasyKash pilot on WQ3 Sandbox without changing production profiles or ordinary routing.

**Architecture:** Build one Hyperswitch v1.126.0 source tree by applying the reviewed Kashier patch to official upstream commit `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1`, then applying a new EasyKash-after-Kashier patch. Build one Control Center v1.38.8 tree by applying the Kashier dashboard patch to `adc307d08c87862380f966af44b849ddfee21dcc`, then an EasyKash-after-Kashier patch. The platform repository pins official upstream plus connector-kit commits, packages immutable application images, and owns the non-secret rollout, verification, and rollback record.

**Tech Stack:** Rust, Hyperswitch v1.126.0, ReScript/JavaScript, Hyperswitch Control Center v1.38.8, Docker, Coolify, PostgreSQL, Redis, Python 3 manifest validation, Git submodules.

**Spec:** `docs/superpowers/specs/2026-09-21-sandbox-kashier-easykash-rollout-design.md`

## Global Constraints

- The organization-foundation branch is a required dependency; preserve MulkStay Sandbox, Startpad Sandbox, Hackathon Sandbox, and WQ3 Sandbox exactly.
- Configure Kashier test mode on all four sandbox profiles. Configure EasyKash only on WQ3 Sandbox with the dedicated low-risk live-provider account.
- Do not modify MulkStay, Startpad, Hackathon, or WQ3 production profiles.
- Do not create default, fallback, volume-split, or ordinary-traffic routing for either connector.
- Do not commit or expose provider credentials, webhook secrets, authorization headers, PAN, CVV, tokens, customer data, or full provider payloads.
- Do not store merchant credentials in Coolify variables or images; they belong only in encrypted Hyperswitch merchant connector accounts.
- No database migration is expected. Any discovered migration, schema, generic payment-flow, or materially broader shared-core requirement returns to the Category E approval gate before implementation continues.
- Kashier uses only `https://test-api.kashier.io/` in this phase. EasyKash uses `https://back.easykash.net/` only for the separately approved low-risk pilot.
- Do not automatically retry an ambiguous financial authorization. Reconcile Kashier through session sync and EasyKash through inquiry.
- Existing dirty checkouts, including `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch`, `/tmp/hyperswitch-control-center-kashier`, and `/tmp/hyperswitch-control-center-v1.38.8`, are evidence sources only. Never reset, clean, build from, commit in, or overwrite them.
- Use runtime secrets and synthetic test-customer details. Keep all generated identifiers and sensitive operational evidence under ignored private paths.
- Production deployment, credential transmission, and the EasyKash live-provider payment each have separate action-time approval boundaries.

## Review Focus

1. **Profile isolation:** A Kashier per-session webhook or EasyKash callback for one MCA must never update a payment under another sandbox profile; Task 2 tests attempt-reference mapping and Task 7 verifies profile-scoped read-back.
2. **Ambiguous timeout:** An authorize timeout must remain pending/unknown until sync or inquiry resolves it, with no automatic second charge; Task 2 adds a timeout/reconciliation test and Task 7 performs only one provider authorization.
3. **Provider-mode mismatch:** Kashier live credentials or live host must be rejected by the tracked sandbox intent, while EasyKash must be labeled as a low-risk live-provider pilot; Tasks 1 and 6 test these classifications.
4. **Webhook integrity and duplication:** Missing/tampered signatures must fail and duplicate valid callbacks must not duplicate state transitions; Tasks 2 and 7 test both paths.
5. **Dashboard/runtime drift:** A compiled connector that is absent from the signed-in catalog, or a visible form whose backend lacks the connector, must stop MCA creation; Tasks 3 and 6 require both feature-matrix and catalog evidence.

---

### Task 1: Add the non-secret connector rollout contract

**Files:**
- Create: `deployment/coolify/production/connectors/desired-state.json`
- Create: `deployment/coolify/production/connectors/README.md`
- Create: `scripts/validate_connector_rollout_manifest.py`
- Create: `tests/test_validate_connector_rollout_manifest.py`
- Modify: `deployment/coolify/production/README.md`

**Interfaces:**
- Consumes: the four sandbox profile display names from the organization-foundation manifest.
- Produces: `validate_manifest(data: dict) -> list[str]` in `scripts.validate_connector_rollout_manifest`, plus a fixed non-secret manifest consumed by Tasks 4–8.

- [ ] **Step 1: Write failing manifest tests.** Add these behaviors to `tests/test_validate_connector_rollout_manifest.py` before creating the validator or manifest:

```python
import copy
import json
import unittest
from pathlib import Path

from scripts.validate_connector_rollout_manifest import validate_manifest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deployment/coolify/production/connectors/desired-state.json"


class ConnectorRolloutManifestTests(unittest.TestCase):
    def load_manifest(self):
        return json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_approved_manifest_is_valid(self):
        self.assertEqual(validate_manifest(self.load_manifest()), [])

    def test_rejects_production_profile(self):
        data = self.load_manifest()
        data["profiles"][0]["profile"] = "MulkStay"
        self.assertIn("profiles differ from approved sandbox rollout", validate_manifest(data))

    def test_rejects_easykash_outside_wq3_sandbox(self):
        data = self.load_manifest()
        data["profiles"][0]["connectors"].append("easykash")
        self.assertIn("easykash is limited to WQ3 Sandbox", validate_manifest(data))

    def test_rejects_non_explicit_routing(self):
        data = self.load_manifest()
        data["routing"] = "default"
        self.assertIn("routing must be explicit_only", validate_manifest(data))

    def test_rejects_secret_shaped_and_unknown_fields(self):
        data = copy.deepcopy(self.load_manifest())
        data["providers"]["kashier"]["apiKey"] = "not-a-secret"
        errors = validate_manifest(data)
        self.assertIn("manifest contains forbidden secret-shaped key: apiKey", errors)
        self.assertIn("manifest contains unknown field at providers.kashier: apiKey", errors)
```

- [ ] **Step 2: Run the focused tests and verify RED.**

Run: `python3 -m unittest -v tests.test_validate_connector_rollout_manifest`

Expected: import or file-not-found failure because the validator and canonical manifest do not exist.

- [ ] **Step 3: Create the canonical manifest.** Use this exact non-secret content:

```json
{
  "schema_version": 1,
  "routing": "explicit_only",
  "providers": {
    "kashier": {
      "environment": "test",
      "base_url": "https://test-api.kashier.io/"
    },
    "easykash": {
      "environment": "low_risk_live_pilot",
      "base_url": "https://back.easykash.net/"
    }
  },
  "profiles": [
    {
      "merchant": "GrowthLabs Sandbox",
      "profile": "MulkStay Sandbox",
      "connectors": ["kashier"]
    },
    {
      "merchant": "GrowthLabs Sandbox",
      "profile": "Startpad Sandbox",
      "connectors": ["kashier"]
    },
    {
      "merchant": "GrowthLabs Sandbox",
      "profile": "Hackathon Sandbox",
      "connectors": ["kashier"]
    },
    {
      "merchant": "Healiot Egypt Sandbox",
      "profile": "WQ3 Sandbox",
      "connectors": ["kashier", "easykash"]
    }
  ],
  "excluded_profiles": ["MulkStay", "Startpad", "Hackathon", "WQ3"],
  "supported_flows": ["hosted_card_automatic_capture", "payment_sync", "signed_payment_webhook"],
  "unsupported_flows": ["manual_capture", "void", "refund", "saved_card", "recurring_payment", "payout"]
}
```

- [ ] **Step 4: Implement the smallest strict validator.** Define fixed allowed-key sets for root, provider, and profile objects; normalize camelCase before credential-name matching; compare the complete profile list and provider objects to literal approved values; reject every unknown field; and return all errors without printing values. Keep the file under 200 lines and `validate_manifest` under 50 lines by extracting `unknown_fields`, `secret_shaped_keys`, and `schema_unknown_fields`.

- [ ] **Step 5: Run focused GREEN and the complete parent suite.**

Run:

```sh
python3 -m unittest -v tests.test_validate_connector_rollout_manifest
python3 -m unittest discover -s tests -v
python3 scripts/validate_connector_rollout_manifest.py
python3 scripts/validate_organization_manifest.py
python3 -m py_compile scripts/validate_connector_rollout_manifest.py tests/test_validate_connector_rollout_manifest.py
```

Expected: all tests pass; both validators print a valid result; compile exits 0.

- [ ] **Step 6: Write the operator README.** Document the two provider classifications, five intended MCAs, explicit-routing-only rule, credential boundaries, EasyKash WQ3-only gate, generated-evidence location, action-time approvals, health/catalog checks, and rollback without embedding identifiers or secrets. Update the production README to link this connector boundary.

- [ ] **Step 7: Commit Task 1.**

```sh
git add deployment/coolify/production/connectors deployment/coolify/production/README.md scripts/validate_connector_rollout_manifest.py tests/test_validate_connector_rollout_manifest.py
git diff --cached --check
git commit -m "feat: define sandbox connector rollout"
```

---

### Task 2: Port EasyKash onto the Kashier-enabled Hyperswitch v1.126.0 baseline

**Files:**
- Modify in EasyKash connector repository: `src/easykash.rs`
- Modify in EasyKash connector repository: `src/easykash/transformers.rs`
- Modify in EasyKash connector repository: `tests/easykash.rs`
- Create in EasyKash connector repository: `patches/hyperswitch-v1.126.0-after-kashier.patch`
- Modify in EasyKash connector repository: `README.md`
- Modify in EasyKash connector repository: `docs/easykash_connector.md`
- Create in EasyKash connector repository: `docs/production_deployment.md`
- Generated integration-worktree changes: the exact minimal v1.126.0 files enumerated in the spec's Category E boundary

**Interfaces:**
- Consumes: official Hyperswitch commit `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1` plus Kashier patch `patches/hyperswitch-v1.126.0.patch` from Kashier connector commit `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`.
- Produces: an EasyKash delta patch that applies cleanly only after that Kashier patch and a reviewed EasyKash connector commit for Task 4.

- [ ] **Step 1: Capture repository and remote baselines.** Record outer, connector, and upstream status, branches, HEADs, remotes, and submodule pins. Require empty connector and upstream statuses. Stop rather than resetting any mismatch.

- [ ] **Step 2: Create the isolated integration source.** Fetch the exact upstream commit in `hyperswitch/`, add a detached worktree at `.worktrees/integration-hyperswitch-v1.126.0`, apply the Kashier v1.126.0 patch with `git apply --check`, apply it, and commit the result locally as the immutable Kashier base. Do not push this generated integration branch.

- [ ] **Step 3: Create the EasyKash connector branch.** In `connectors/hyperswitch-easykash-connector`, switch from the detached gitlink to `codex/v1.126.0-after-kashier` at `7e44e7335c7cc1716294bc1a862c47fb5921b796`. Preserve `main` and verify the worktree is clean.

- [ ] **Step 4: Copy/adapt tests into the integration tree before connector code.** Add the EasyKash test module and transformer tests first. The required new behaviors are:

```rust
#[test]
fn pay_request_uses_card_option_and_attempt_reference() {
    // Build PaymentsAuthorizeRouterData with EGP, automatic capture, billing name,
    // email, mobile number, and attempt_id "attempt_wq3_001".
    // Assert serialized paymentOptions == [2] and customerReference == "attempt_wq3_001".
}

#[test]
fn authorize_rejects_missing_billing_contact() {
    // Remove email and assert MissingRequiredField instead of an outbound request.
}

#[test]
fn inquiry_maps_paid_failed_and_pending_without_retrying_authorize() {
    // Deserialize literal Paid, Failed, and New fixtures and assert Charged,
    // Failure, and Pending respectively; no second authorize call exists.
}

#[test]
fn callback_signature_verifies_and_tampering_fails() {
    // Verify the documented HMAC-SHA512 field order with a literal fixture,
    // mutate Amount, and assert verification fails.
}

#[test]
fn unsupported_capture_void_and_refund_do_not_build_requests() {
    // Assert each unsupported flow returns NotImplemented or the framework's
    // explicit unsupported-flow error.
}
```

- [ ] **Step 5: Run RED against the Kashier-only baseline.**

Run:

```sh
cargo test -p hyperswitch_connectors --features v1 --no-default-features --test easykash
cargo test -p hyperswitch_connectors --features v1 --no-default-features --lib connectors::easykash::transformers::tests
```

Expected: compile/test failure because EasyKash is absent from the v1.126.0 connector modules and registries, not because of malformed fixtures.

- [ ] **Step 6: Port the connector implementation.** Adapt the standalone EasyKash source to v1.126.0 APIs. Keep `HeaderKey` auth, card option `2`, major-unit amount conversion, attempt ID references, HMAC-SHA512 verification, provider status mapping, and explicit unsupported flows. Add only the registration/configuration points listed in the approved Category E boundary. Do not alter generic payment operations or migrations.

- [ ] **Step 7: Run targeted GREEN, mutation checks, and full connector validation.**

Run:

```sh
cargo fmt --all -- --check
cargo test -p hyperswitch_connectors --features v1 --no-default-features --test easykash
cargo test -p hyperswitch_connectors --features v1 --no-default-features --lib connectors::easykash::transformers::tests
cargo test -p hyperswitch_connectors --test kashier --features v1,frm,payouts,dummy_connector --no-default-features
cargo clippy -p hyperswitch_connectors --features v1 --no-default-features -- -D warnings
cargo check -p router --features release,v1,redis-rs --no-default-features
```

Expected: all commands exit 0. Before proceeding, manually mutate signature field order, paid-status mapping, and attempt-reference selection one at a time and prove a named test fails for each mutation; restore the correct implementation after every check.

- [ ] **Step 8: Generate the after-Kashier patch.** Diff the immutable Kashier-base commit to the reviewed EasyKash integration commit with full-index/binary metadata. Store the generated delta in the EasyKash connector repository. Verify in a second fresh integration worktree that official base + Kashier patch + EasyKash patch applies cleanly and reproduces the same tree hash for all touched files.

- [ ] **Step 9: Update authoritative connector source and docs.** Copy the final connector modules and tests back into the EasyKash connector repository, document the exact base pins, patch order, supported/unsupported flows, low-risk live-provider classification, build commands, no-migration finding, and rollback boundary. Do not copy unrelated upstream files.

- [ ] **Step 10: Commit and push the EasyKash connector change after task review.**

```sh
git add src tests patches/hyperswitch-v1.126.0-after-kashier.patch README.md docs
git diff --cached --check
git commit -m "feat: port EasyKash to Hyperswitch v1.126.0"
git push -u origin codex/v1.126.0-after-kashier
```

Record the published commit SHA for Task 4. Do not advance the parent gitlink before the remote contains that commit.

---

### Task 3: Add EasyKash to the Kashier-enabled Control Center

**Files:**
- Create in EasyKash connector repository: `patches/hyperswitch-control-center-v1.38.8-after-kashier.patch`
- Create in EasyKash connector repository: `tests/control_center_catalog.mjs`
- Create in EasyKash connector repository: `docs/dashboard_integration.md`
- Generated Control Center changes: `src/screens/Connectors/ConnectorTypes.res`, `src/screens/Connectors/ConnectorUtils.res`, `src/libraries/EasyKashConnectorConfig.res`, and `public/hyperswitch/assets/Gateway/EASYKASH.svg` only if a provider-approved asset is available

**Interfaces:**
- Consumes: Control Center commit `adc307d08c87862380f966af44b849ddfee21dcc` plus Kashier dashboard patch `patches/hyperswitch-control-center-v1.38.8.patch`.
- Produces: a patch and behavioral smoke test that expose both connectors for Task 4's dashboard build.

- [ ] **Step 1: Create a fresh Control Center integration worktree.** Clone/fetch the official repository into `.worktrees/integration-control-center-v1.38.8`, checkout the exact commit, apply the Kashier patch after `git apply --check`, and commit the result locally. Do not reuse either dirty `/tmp` checkout.

- [ ] **Step 2: Write the catalog behavior test before EasyKash UI code.** `tests/control_center_catalog.mjs` accepts the built Control Center root as its only argument, imports the generated connector utility modules, and asserts:

```javascript
import assert from "node:assert/strict";
// Resolve the built ConnectorUtils and connector-list modules from argv[2].
// Assert name parsing recognizes "kashier" and "easykash".
// Assert both test/live fallback payment-processor lists contain both names.
// Assert EasyKash exposes api_key plus a separate webhook merchant_secret field.
// Assert Kashier still exposes api_key, key1, api_secret, and merchant_secret.
assert.equal(process.exitCode, undefined);
```

The real test file must use literal expected field-name arrays and call the compiled modules; it must not grep source text.

- [ ] **Step 3: Build the Kashier-only baseline and verify RED.**

Run:

```sh
npm ci
npm run re:build
node /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/.worktrees/sandbox-kashier-easykash/connectors/hyperswitch-easykash-connector/tests/control_center_catalog.mjs "$PWD"
```

Expected: the script proves Kashier remains present and fails specifically because EasyKash parsing/list/config is absent.

- [ ] **Step 4: Implement minimal EasyKash catalog support.** Add the connector type, string mapping, display metadata, neutral or provider-approved icon mapping, fallback lists, `HeaderKey` API-key field, and separate webhook HMAC-secret field. Label the integration as a low-risk live-provider pilot; do not claim provider sandbox support.

- [ ] **Step 5: Run GREEN and production build verification.**

Run:

```sh
npm run re:format:check
npm run re:build
node /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/.worktrees/sandbox-kashier-easykash/connectors/hyperswitch-easykash-connector/tests/control_center_catalog.mjs "$PWD"
npm run build:prod
```

Expected: all commands exit 0; the test exercises both connectors through compiled modules; the production bundle builds without warnings promoted to errors.

- [ ] **Step 6: Generate and independently reapply the after-Kashier dashboard patch.** Diff the Kashier-base commit to the reviewed combined commit, store the patch in the EasyKash connector repository, then prove official Control Center base + Kashier patch + EasyKash patch reproduces the reviewed tree in a fresh checkout.

- [ ] **Step 7: Document the dashboard rollout and append to the Task 2 connector branch.** Explain exact pins, patch order, credential fields, fallback-list behavior, runtime config interaction, signed-in verification, and rollback. Commit and push the added dashboard files to the same EasyKash branch, then record the new published SHA.

---

### Task 4: Pin reproducible sources and add combined image packaging

**Files:**
- Modify: `.gitmodules` only if connector URL metadata must change; otherwise leave it unchanged
- Update gitlink: `hyperswitch` to official commit `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1`
- Update gitlink: `connectors/hyperswitch-easykash-connector` to the reviewed published Task 3 commit
- Keep gitlink: `connectors/hyperswitch-kashier-connector` at `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`
- Modify: `connectors/README.md`
- Modify: `docs/architecture.md`
- Create: `deployment/coolify/production/connectors/images/router.Dockerfile`
- Create: `deployment/coolify/production/connectors/images/producer.Dockerfile`
- Create: `deployment/coolify/production/connectors/images/consumer.Dockerfile`
- Create: `deployment/coolify/production/connectors/images/dashboard.Dockerfile`
- Create: `deployment/coolify/production/connectors/build-release.sh`
- Create: `tests/test_connector_release_contract.py`

**Interfaces:**
- Consumes: published connector commits and reproducible patch order from Tasks 2–3.
- Produces: pinned source plus a build contract that emits four versioned local images and a non-secret release record for Task 5.

- [ ] **Step 1: Write failing release-contract tests.** Tests load the connector manifest and packaging files and run the build script in `--validate-only` mode. Assert exact source pins, patch order `kashier` then `easykash`, four image roles, base-image digest syntax, absence of secret fields, and refusal to build from a dirty or wrong-revision source tree.

- [ ] **Step 2: Run RED.**

Run: `python3 -m unittest -v tests.test_connector_release_contract`

Expected: failure because packaging and `--validate-only` do not exist.

- [ ] **Step 3: Advance only approved gitlinks.** Fetch and checkout the exact official Hyperswitch commit and the published EasyKash connector commit. Verify mode-160000 entries, remote reachability, and clean submodule states. Do not move Kashier or vendor nested files.

- [ ] **Step 4: Add the packaging files.** Base the router, producer, consumer, and dashboard images on the exact upstream runtime digests recorded in the reviewed Kashier deployment unless the fresh readiness inventory proves they changed. Copy only the reviewed release binaries or built dashboard `dist/`; preserve upstream user, command, runtime libraries, and mounted configuration.

- [ ] **Step 5: Implement `build-release.sh`.** It must use `set -eu`, accept `--validate-only` or an explicit build output directory, verify all three source commits and clean states, apply both patches in order with `git apply --check`, run the Task 2/3 test commands, build release router/scheduler and Control Center artifacts, build four local images, and print image IDs without embedding registry credentials. It must fail closed on missing tools, wrong pins, dirty inputs, patch drift, or a missing artifact.

- [ ] **Step 6: Run GREEN and structural verification.**

Run:

```sh
python3 -m unittest -v tests.test_connector_release_contract
deployment/coolify/production/connectors/build-release.sh --validate-only
python3 -m unittest discover -s tests -v
git ls-files --stage hyperswitch connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector
git submodule status
git diff --check
```

Expected: tests pass; pins and patch order are exact; three gitlinks use mode 160000; status is clean except intended Task 4 changes before commit.

- [ ] **Step 7: Update ownership docs and commit Task 4.** State that Hyperswitch is official upstream, custom integration is reproduced by ordered connector patches, the parent owns packaging, and deployment still requires the live gate.

```sh
git add hyperswitch connectors/hyperswitch-easykash-connector connectors/README.md docs/architecture.md deployment/coolify/production/connectors tests/test_connector_release_contract.py
git diff --cached --check
git commit -m "build: package Kashier and EasyKash release"
```

---

### Task 5: Build, review, and publish immutable release images

**Files:**
- Create after successful publication: `deployment/coolify/production/connectors/release.json`
- Create ignored evidence: `deployment/coolify/production/connectors/private/build-evidence.json`

**Interfaces:**
- Consumes: Task 4's exact pins and packaging.
- Produces: four immutable registry digests and a reviewed release record consumed by Task 6.

- [ ] **Step 1: Run the complete local release build.** Use the exact production feature set `release,v1,redis-rs`; run both connector suites, clippy, formatting, router/scheduler release build, Control Center build, and catalog smoke test. Capture command, exit code, source commit, toolchain version, artifact checksum, and local image ID without capturing environment variables or command lines containing credentials.

- [ ] **Step 2: Inspect the built images before publication.** Verify non-root runtime users, original entrypoints/commands, expected binaries/assets, no source tree, no `.git`, no credential-shaped environment variables, no writable secret files, and no unexpected layer growth. Run router and scheduler version/help checks and a local feature-matrix smoke environment that does not bind production databases.

- [ ] **Step 3: Obtain publication approval.** Present source commits, complete test/build results, local image IDs, target private-registry repository names/tags, and the fact that publication changes no running service. Wait for explicit approval before authenticating or pushing.

- [ ] **Step 4: Publish four versioned tags and resolve registry digests.** Push router, producer, consumer, and dashboard images to the approved private registry. Never use `latest`. Read each immutable digest back from the registry and verify a clean pull by digest.

- [ ] **Step 5: Write and validate `release.json`.** Record schema version, four roles, versioned tags, immutable `sha256:` digests, source commits, patch-order commits, build feature set, build timestamp, and validation summary. Reject credential-like fields and mutable tags in the release-contract tests.

- [ ] **Step 6: Commit the non-secret release record.**

```sh
git add deployment/coolify/production/connectors/release.json tests/test_connector_release_contract.py
git diff --cached --check
git commit -m "chore: record connector release images"
```

Keep detailed logs, generated IDs, and registry authentication evidence ignored under `private/`.

---

### Task 6: Prove production readiness and deploy connector-capable application images

**Files:**
- Create ignored evidence: `deployment/coolify/production/connectors/private/readiness.json`
- Create ignored evidence after approval: `deployment/coolify/production/connectors/private/deployment.json`
- No tracked source changes unless the fresh inventory disproves a documented non-secret assumption

**Interfaces:**
- Consumes: Task 5 image digests and Task 1 desired state.
- Produces: healthy connector-capable runtime with no MCAs or routing changes for Task 7.

- [ ] **Step 1: Collect a fresh read-only inventory.** Verify authoritative Coolify project/service, current Source and Deployable Compose, current images/digests, API/dashboard domains and TLS, router/producer/consumer/dashboard health, scheduler state, PostgreSQL/Redis bindings, config mount, current connector endpoints, current feature matrix, signed-in catalog, recent relevant errors, backup schedule, latest completed backup, restore evidence, and current five-target-MCA count of zero.

- [ ] **Step 2: Explain the current dashboard discrepancy.** Compare the live dashboard digest and runtime `connector_list_for_live.paymentProcessors` with the recorded Kashier dashboard build. Classify the missing Kashier card as image drift, runtime-list filtering, or code defect. If it is a code defect outside the reviewed Task 3 files, stop and return to review; do not patch production ad hoc.

- [ ] **Step 3: Produce the exact deployment packet.** Include four target image digests, exact non-secret config additions, current and target Compose diff, restart set, health/readiness commands, excluded DB/Redis/migration actions, five later MCA targets, production-profile exclusions, rollback images/config, operator, maintenance window, and observation duration.

- [ ] **Step 4: Request action-time deployment approval.** No Compose, config, image, container, credential, MCA, route, or payment write occurs before the user approves the exact packet.

- [ ] **Step 5: Apply only approved image/config changes.** Back up current Source Compose, generated Deployable Compose, and mounted config. Set the three backend image digests, dashboard digest, `kashier.base_url = "https://test-api.kashier.io/"`, and `easykash.base_url = "https://back.easykash.net/"`. Review generated Compose before recreating only router, producer, consumer, and dashboard.

- [ ] **Step 6: Verify runtime before credentials.** Require healthy containers, dependency readiness, stable startup logs, HTTP 200/TLS success, both feature-matrix entries, signed-in searchable Kashier/EasyKash cards, exact credential labels, unchanged DB/Redis containers, zero target MCAs, and zero routing rules for both connectors. Roll back immediately on a failed required check.

- [ ] **Step 7: Record deployment evidence.** Store image/container IDs, timestamps, sanitized health/catalog results, config checksum, backup reference, and rollback references in ignored evidence. Do not record response bodies that may contain credentials or payment data.

---

### Task 7: Create sandbox MCAs and run controlled connector validation

**Files:**
- Create ignored evidence: `deployment/coolify/production/connectors/private/activation.json`
- No tracked file changes

**Interfaces:**
- Consumes: healthy Task 6 runtime and the five exact MCA targets.
- Produces: four validated Kashier test MCAs and one validated WQ3 Sandbox EasyKash pilot MCA, with no routing changes.

- [ ] **Step 1: Recheck scope immediately before credential entry.** Read back the four sandbox profile display names, parent merchants, current MCAs, connector catalog, zero connector routes, and zero same-name target MCAs. Stop on duplicates, similar names, production context, or a changed maintenance window.

- [ ] **Step 2: Enter Kashier test credentials with the human operator.** For each sandbox profile, open the profile-scoped Kashier form and verify test mode plus Payment API Key, Merchant ID, Secret Key, and webhook Payment API Key labels. Immediately before credential transmission, hand control to the user or obtain confirmation under the computer-use policy. Create exactly one MCA per profile, retrieve it, and verify profile ownership, connector name, enabled state, test mode, card methods, automatic capture, and no route.

- [ ] **Step 3: Validate Kashier one profile at a time.** For MulkStay Sandbox, Startpad Sandbox, Hackathon Sandbox, then WQ3 Sandbox, create exactly one synthetic EGP connector-explicit payment. Verify hosted test URL, one authorization only, final session sync, HMAC-SHA256 callback, matching attempt reference, correct profile, duplicate-callback idempotency, and no cross-profile payment state. Stop the sequence on the first unexplained failure.

- [ ] **Step 4: Enter the EasyKash low-risk credentials on WQ3 Sandbox only.** Verify the form states live-provider pilot, `HeaderKey` API key, separate webhook HMAC secret, card-only automatic capture, and no default route. At the sensitive-data boundary, hand control to the user or obtain confirmation before transmission. Register the displayed MCA-specific callback URL with EasyKash and confirm callback service enablement.

- [ ] **Step 5: Present the EasyKash financial-action packet.** State the exact capped amount, EGP currency, WQ3 Sandbox profile, low-risk EasyKash merchant, synthetic customer, one-authorization limit, inquiry plan, and stop/rollback conditions. Obtain explicit confirmation immediately before creating the live-provider payment.

- [ ] **Step 6: Run one EasyKash pilot payment.** Create one connector-explicit payment, complete hosted checkout, and verify one authorize request, inquiry reconciliation, HMAC-SHA512 callback, matching customer reference, final status, duplicate safety, and no cross-profile update. Never retry an ambiguous authorize; run inquiry until the approved timeout boundary, then stop and report unresolved status.

- [ ] **Step 7: Verify exclusions and record sanitized evidence.** Prove production profiles unchanged, no routes reference either connector, no extra MCAs exist, no unsupported flow became enabled, no secret appears in logs/evidence, and health remains stable. Record only redacted identifiers and verification outcomes.

---

### Task 8: Observe, reconcile, and hand off

**Files:**
- Update ignored evidence: `deployment/coolify/production/connectors/private/activation.json`
- Create ignored evidence: `deployment/coolify/production/connectors/private/handoff.json`
- Modify tracked docs only if a verified non-secret operational fact changed

**Interfaces:**
- Consumes: Task 7 activation evidence.
- Produces: final qualified production status and rollback-ready handoff.

- [ ] **Step 1: Observe the approved post-change window.** Monitor router/scheduler/dashboard health, connector error rates, webhook verification failures, stuck payments, duplicate events, and unexpected traffic. Stay quiet while unchanged; stop and escalate on any meaningful failure or user action requirement.

- [ ] **Step 2: Reconcile every controlled payment.** Match each OpenSwitch payment/attempt to its provider test or low-risk reference, sync/inquiry result, signed callback, profile, amount, currency, and final state. Require no unresolved or duplicate charge.

- [ ] **Step 3: Re-run the full tracked verification.**

Run:

```sh
python3 -m unittest discover -s tests -v
python3 scripts/validate_organization_manifest.py
python3 scripts/validate_connector_rollout_manifest.py
deployment/coolify/production/connectors/build-release.sh --validate-only
git diff --check
git status --short
git submodule status
git grep -nEi '(sk_(live|test)|api[_-]?key[[:space:]]*[:=]|password[[:space:]]*[:=]|webhook[_-]?secret[[:space:]]*[:=])' -- . ':!docs/superpowers/plans/2026-09-21-sandbox-kashier-easykash-rollout.md'
git ls-files deployment/coolify/production/connectors/private
```

Expected: all tests and validators pass; worktree clean; submodule pins exact; tracked-content scan and private-path tracking output empty.

- [ ] **Step 4: Perform final independent review.** Review the complete branch from its organization-foundation base, every connector commit/patch, the build/release record, and sanitized operational evidence. Resolve all Critical and Important findings before integration.

- [ ] **Step 5: Write the handoff.** State classification C plus approved E integration; affected repositories and commits; `Upstream core changes: YES` with exact approved shared files; image digests; configuration impact; `Database impact: NONE`; tests actually run; Kashier test status for four profiles; EasyKash low-risk live-provider status for WQ3 Sandbox; no-route and production-profile exclusions; rollback readiness; observation result; and the unresolved EasyKash callback-capacity gate for the remaining three sandbox profiles.

- [ ] **Step 6: Finish the branch without assuming integration.** Use `superpowers:finishing-a-development-branch`, present merge/push/keep choices, and preserve the worktree for review feedback unless the user explicitly chooses local merge and cleanup.
