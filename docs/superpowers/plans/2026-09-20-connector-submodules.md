# OpenSwitch Connector Submodules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the existing Kashier and EasyKash repositories as pinned connector submodules in the OpenSwitch platform without changing Hyperswitch or production.

**Architecture:** The parent repository tracks two connector gitlinks and portable GitHub URLs; each connector repository retains its own source, tests, patches, and history. Kashier's clean local checkout fast-forwards from `521230ef7afd1f9e1deaba4a4123f09edbaff022` to published `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`; EasyKash stays at `7e44e7335c7cc1716294bc1a862c47fb5921b796`. Parent docs describe ownership and explicitly avoid claiming that Git registration enables a connector in a binary.

**Tech Stack:** Git submodules, Markdown. No application code, dependencies, or runtime services.

**Spec:** `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/docs/superpowers/specs/2026-09-20-connector-submodules-design.md`

## Global Constraints

- Category C connector organization; upstream core changes: NONE.
- Do not apply either connector patch, modify the `hyperswitch/` submodule, or touch Coolify, images, secrets, databases, or production.
- Do not edit, reset, clean, or push the dirty `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch` checkout.
- Preserve the existing nested connector repositories and their histories. If Git cannot safely register an existing directory, stop with it intact; never remove or overwrite it to retry.
- Pin Kashier to `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f` from `https://github.com/Byt3Ninja/hyperswitch-kashier-connector.git`.
- Pin EasyKash to `7e44e7335c7cc1716294bc1a862c47fb5921b796` from `https://github.com/Byt3Ninja/hyperswitch-easykash-connector.git`.
- Keep `hyperswitch/` at `568a91925fc7ae1948838e105afdd98210cb3152` and preserve its official-upstream `.gitmodules` entry.
- Do not commit or push in either connector repository; do not push the parent platform repository. The approved deliverable is a local parent commit and verified local clone.
- Use `apply_patch` for authored Markdown. Do not stage connector source as ordinary parent files.

## Review Focus

1. **Remote drift:** If either `main` no longer advertises its approved SHA, Task 1 must stop before changing a checkout.
2. **Dirty or diverged nested repository:** Task 1 must stop before fast-forwarding or registering a checkout with unexpected changes or ancestry.
3. **Accidental source vendoring:** Task 2 must see exactly two mode-160000 connector gitlinks, no parent-tracked nested source paths, and the unchanged Hyperswitch gitlink.
4. **Nonportable Git metadata:** Task 3 must initialize both connectors in a fresh clone using `.gitmodules` HTTPS URLs, not a machine-local path or the original nested `.git` directories.
5. **False runtime claims or sensitive material:** Task 2 must inspect the complete staged parent diff and keep README/registry text explicit that registration is not binary activation or deployment.

---

### Task 1: Verify sources and fast-forward the local Kashier checkout

**Files:** No authored files. Only the clean, nested Kashier repository's local `main` and remote-tracking metadata may advance to the approved, already-published commit.

**Interfaces:** Produces clean Kashier HEAD `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f` and clean EasyKash HEAD `7e44e7335c7cc1716294bc1a862c47fb5921b796`; Task 2 consumes those exact checkouts.

- [ ] **Step 1: Capture a read-only baseline in the task transcript.** Run and retain complete output; do not redirect it into either repository:

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform submodule status
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch remote -v
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector remote -v
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-easykash-connector status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-easykash-connector rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-easykash-connector remote -v
~~~

Expected: parent has only the two untracked connector directories; both nested statuses are empty; Kashier HEAD is `521230ef7afd1f9e1deaba4a4123f09edbaff022`; EasyKash HEAD is `7e44e7335c7cc1716294bc1a862c47fb5921b796`; old checkout HEAD is `568a91925fc7ae1948838e105afdd98210cb3152`. If any baseline differs, pause and reassess without resetting anything.

- [ ] **Step 2: Verify the exact published refs before a local write.**

~~~sh
GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/Byt3Ninja/hyperswitch-kashier-connector.git refs/heads/main
GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/Byt3Ninja/hyperswitch-easykash-connector.git refs/heads/main
~~~

Expected: Kashier `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`; EasyKash `7e44e7335c7cc1716294bc1a862c47fb5921b796`. Stop on a different SHA or network failure; do not silently chase moving `main`.

- [ ] **Step 3: Fetch only Kashier's published branch, then recheck its SHA and ancestry.**

~~~sh
GIT_TERMINAL_PROMPT=0 git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector fetch origin main
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector rev-parse FETCH_HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector merge-base --is-ancestor HEAD FETCH_HEAD
~~~

Expected fetched SHA exactly `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f` and ancestry check exit 0. If either differs, stop with local `main` unchanged.

- [ ] **Step 4: Fast-forward Kashier to the approved commit and verify both children.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector merge --ff-only 10f0957a1d1cd9342bed25d41869c8c0a5a60c7f
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-easykash-connector rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-easykash-connector status --short
~~~

Expected exact approved SHAs, both statuses empty. No new connector commit or remote push is needed.

### Task 2: Register both gitlinks and correct parent documentation

**Files:**
- Modify: `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/.gitmodules`
- Add Gitlink: `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-kashier-connector`
- Add Gitlink: `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/hyperswitch-easykash-connector`
- Modify: `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/connectors/README.md`
- Modify: `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform/README.md`

**Interfaces:** Consumes Task 1's clean connector HEADs. Produces a parent commit with portable URLs, exact gitlinks, and accurate ownership docs for Task 3's clone test.

- [ ] **Step 1: Verify the gitlink test is red before registration.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform ls-files --stage connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector
~~~

Expected: no output; the parent does not yet track either path. This is the structural RED state.

- [ ] **Step 2: Register each existing clean repository without deleting or replacing it.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform submodule add https://github.com/Byt3Ninja/hyperswitch-kashier-connector.git connectors/hyperswitch-kashier-connector
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform submodule add https://github.com/Byt3Ninja/hyperswitch-easykash-connector.git connectors/hyperswitch-easykash-connector
~~~

Git can register an existing valid repository at the requested path. If either command refuses or attempts to replace existing content, stop and inspect the partial parent index and `.gitmodules`; do not run `rm`, `git clean`, or a manual `.git` move.

- [ ] **Step 3: Verify both gitlinks and all three submodule URLs.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform ls-files --stage hyperswitch connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform config -f .gitmodules --get-regexp '^submodule\..*\.url$'
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform ls-files 'connectors/hyperswitch-kashier-connector/*' 'connectors/hyperswitch-easykash-connector/*'
~~~

Expected: three mode-160000 entries with Hyperswitch `568a91925fc7ae1948838e105afdd98210cb3152`, Kashier `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`, EasyKash `7e44e7335c7cc1716294bc1a862c47fb5921b796`; URL entries are exactly the approved HTTPS remotes; nested source-file query has no output. Stop on any mismatch.

- [ ] **Step 4: Update root README.md using apply_patch.** Replace its current-scope paragraph and old-checkout paragraph with this text, leaving the rest unchanged:

~~~markdown
deployment/coolify/staging and deployment/coolify/production document separate environments but contain no deployable manifests, credentials, or verified Coolify application settings. connectors/ records ownership and contains pinned, independently tracked Kashier and EasyKash Git submodules. Registering these integration kits does not compile them into Hyperswitch or change production. Read docs/architecture.md and AGENTS.md before changing the platform.

The previous OpenSwitch checkout contains uncommitted Kashier work. It is not the source of the Hyperswitch or connector submodules. Its old origin URL points to this platform repository; never push Hyperswitch commits from that checkout to this platform remote.
~~~

- [ ] **Step 5: Replace connectors/README.md using apply_patch with this complete content.**

~~~markdown
# Connector ownership registry

Kashier and EasyKash are independent Git submodules. The platform repository tracks their commit pointers, not their source files. Both kits include integration patches for official Hyperswitch commit `568a91925fc7ae1948838e105afdd98210cb3152`; neither is a dynamically loaded plugin. Adding these submodules does not enable a connector in a Hyperswitch binary or change the separately managed production service.

| Connector | Authoritative repository | Pinned commit | Integration boundary |
| --- | --- | --- | --- |
| Kashier | [hyperswitch-kashier-connector](https://github.com/Byt3Ninja/hyperswitch-kashier-connector) | `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f` | Patch targets the pinned upstream commit; the kit also documents later integration work. Its presence here is not deployment approval. |
| EasyKash | [hyperswitch-easykash-connector](https://github.com/Byt3Ninja/hyperswitch-easykash-connector) | `7e44e7335c7cc1716294bc1a862c47fb5921b796` | Patch targets the pinned upstream commit; not ported to Hyperswitch v1.126.0 or validated with a live EasyKash account. |

Do not copy connector source into the parent repository. Review each kit's own README, docs, tests, and patch before integration. Shared Hyperswitch enum, router, schema, or registration changes may require Category E approval. Do not apply both patches blindly: they touch overlapping upstream files and need a separate integration plan and tests.
~~~

- [ ] **Step 6: Stage and inspect only the agreed parent changes.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform add .gitmodules connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector connectors/README.md README.md
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform diff --cached --check
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform diff --cached --name-only
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform diff --cached -- .gitmodules README.md connectors/README.md
~~~

Expected exactly those five parent paths staged. Read the staged text for credentials, false production claims, and accidental patch application. Do not stage `hyperswitch/` or any nested source path.

- [ ] **Step 7: Commit the parent integration and verify the structural GREEN state.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform commit -m "chore: register Kashier and EasyKash submodules"
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform ls-tree HEAD hyperswitch connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform diff HEAD^ HEAD --check
~~~

Expected three mode-160000 tree entries with the exact approved SHAs, clean parent status, and diff-check exit 0. Keep the commit local; do not push.

### Task 3: Prove portability and preserve existing checkouts

**Files:** No authored file changes. A disposable clone is created outside the parent for verification.

**Interfaces:** Consumes Task 2's local parent commit. Produces evidence of remote-initializable connector checkouts and an unchanged original Hyperswitch checkout.

- [ ] **Step 1: Create a unique disposable directory, clone the local parent, and initialize both connector submodules in one shell invocation.** The variable exists only for this invocation, so run the entire block together and retain the printed directory path in the task transcript:

~~~sh
set -eu
verify_dir=$(mktemp -d /tmp/openswitch-connectors-verify.XXXXXX)
printf 'Verification directory: %s\n' "$verify_dir"
git clone /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform "$verify_dir/clone"
git -C "$verify_dir/clone" submodule update --init connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector
git -C "$verify_dir/clone/connectors/hyperswitch-kashier-connector" rev-parse HEAD
git -C "$verify_dir/clone/connectors/hyperswitch-easykash-connector" rev-parse HEAD
git -C "$verify_dir/clone" submodule status connectors/hyperswitch-kashier-connector connectors/hyperswitch-easykash-connector
test "$(git -C "$verify_dir/clone/connectors/hyperswitch-kashier-connector" rev-parse HEAD)" = 10f0957a1d1cd9342bed25d41869c8c0a5a60c7f
test "$(git -C "$verify_dir/clone/connectors/hyperswitch-easykash-connector" rev-parse HEAD)" = 7e44e7335c7cc1716294bc1a862c47fb5921b796
test -z "$(git -C "$verify_dir/clone" status --porcelain)"
~~~

Expected connector HEADs at the approved SHAs, no leading `-` or `+` in either status line, and overall exit 0. This initializes from the `.gitmodules` HTTPS URLs, not the original nested `.git` directories. Do not delete the printed verification directory with an unresolved path.

- [ ] **Step 2: Confirm the original checkout and Hyperswitch pin still match Task 1's baseline.**

~~~sh
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform submodule status hyperswitch
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch rev-parse HEAD
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch status --short
git -C /Users/byteninja/Downloads/Healiot/Apps/OpenSwitch remote -v
~~~

Expected parent status empty, Hyperswitch still at `568a91925fc7ae1948838e105afdd98210cb3152`, and old checkout HEAD/status/remotes matching Task 1's transcript. Report the disposable clone path, Category C, Upstream core changes: NONE, checks actually run, no runtime/config/database/deployment change, and no remote push. Do not claim Rust tests or payment-flow validation.
