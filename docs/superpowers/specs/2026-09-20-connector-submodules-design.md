# OpenSwitch Connector Submodules Design

## Intent and success criteria

Make the existing Kashier and EasyKash integration-kit repositories available under `OpenSwitch-platform/connectors/` in a portable, independently versioned way. A fresh clone of the platform repository must be able to initialize each connector at a reviewed commit. The parent repository owns the connector registry and Git pointers, not copies of connector source. This change does not compile connectors into Hyperswitch, deploy them, or change payment behavior.

Success means `.gitmodules` names both connector URLs; the parent index records each connector path as a mode-160000 gitlink at the approved SHA; `connectors/README.md` identifies both authoritative repositories and compatibility limits; the existing Hyperswitch submodule and the old dirty OpenSwitch checkout remain unchanged; and a disposable clone initializes both connector submodules from portable URLs. No connector, platform, or production remote is pushed by this task.

## Current state and choice

The user placed two clean, nested Git repositories in the parent `connectors/` directory. They are currently untracked by the parent, so a clone of the parent cannot see them. Kashier's local checkout is at `521230ef7afd1f9e1deaba4a4123f09edbaff022`, while its published `main` is `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`; the local commit is an ancestor of the published one, so a fast-forward can preserve history. EasyKash's local and published `main` are both `7e44e7335c7cc1716294bc1a862c47fb5921b796`. The user approved the latest published Kashier revision and keeping both repositories independent.

The selected approach is two Git submodules, matching the independent Git boundary already used for `hyperswitch/`. Vendoring files into the parent would duplicate ownership and discard the connector repositories' update path. Registry-only links would not make connector source available in a clone. The parent must pin these exact commits, not float with `main`:

| Parent path | Portable submodule URL | Pinned commit |
| --- | --- | --- |
| `connectors/hyperswitch-kashier-connector` | `https://github.com/Byt3Ninja/hyperswitch-kashier-connector.git` | `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f` |
| `connectors/hyperswitch-easykash-connector` | `https://github.com/Byt3Ninja/hyperswitch-easykash-connector.git` | `7e44e7335c7cc1716294bc1a862c47fb5921b796` |

## Ownership and runtime boundary

The connector repositories own their `src/`, `tests/`, `docs/`, and integration patches. The parent owns `.gitmodules`, gitlinks, `connectors/README.md`, and its root `README.md`. The registry should name both repositories and exact pins, note that each integration patch targets Hyperswitch commit `568a91925fc7ae1948838e105afdd98210cb3152`, and distinguish source availability from binary support or production approval. The root README must explain that `connectors/` now includes independently tracked source checkouts, replacing its current claim that the directory contains no implementations. The platform's `hyperswitch/` pointer stays at that upstream commit.

Both connector kits say that their patches change shared Hyperswitch registration and configuration, not just standalone connector files. Applying either patch to `hyperswitch/` is outside this task and may require the platform's Category E core approval gate. The live Coolify service is separately managed. Do not infer that adding these gitlinks enables Kashier or EasyKash in any running image, and do not modify Coolify, images, secrets, databases, or production. Category C connector organization; upstream core changes: NONE.

## Transition and verification

Before writing, capture parent, child, and old-checkout status, HEAD, remotes, and submodule state. Recheck that the two connector remotes advertise the approved SHAs and that the existing nested repositories are clean. Advance only the local Kashier checkout by fast-forward to `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f`; EasyKash remains at its current commit. Register the existing directories as submodules without deleting, replacing, or manually relocating their Git histories. If Git cannot safely register either directory, stop and preserve it for diagnosis.

Stage only `.gitmodules`, the two gitlinks, `connectors/README.md`, and the root `README.md`. Confirm each staged connector path has mode 160000, its pinned SHA, and the exact HTTPS URL above; no nested source files should appear as parent-tracked paths. Inspect the staged diff for secrets and false production claims, then make a focused local parent commit. Do not commit in or push either connector repository, push the parent repository, or apply an integration patch under this task.

Verify portability with a disposable clone of the local parent repository and initialize the two connector submodules from their HTTPS URLs. Confirm their checked-out HEADs and clean status. Compare the original dirty OpenSwitch checkout's HEAD, status, and remotes with its captured baseline and confirm `hyperswitch/` is unchanged. A Rust build, sandbox payment, webhook delivery, migration, or production smoke test is not implied by Git registration and must not be claimed as run.

## Failure handling and review boundary

If a remote ref changes, Kashier cannot fast-forward, a nested repository has unexpected changes, or submodule registration would overwrite existing content, stop rather than substituting another commit or deleting a directory. Keep partial parent changes local for inspection; do not reset or clean the old checkout. The parent Git commit can later be reverted without changing the connector repositories' published history, but removing a submodule checkout requires a separate checked and authorized cleanup.

This document records the approved conversational design. Review this written spec before an implementation plan is produced; review the plan and choose its execution method before any submodule conversion begins.
