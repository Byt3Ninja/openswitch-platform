# OpenSwitch Platform Repository Layout Design

## Intent and success criteria

Create a new sibling platform repository at `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch-platform`. Put official upstream Hyperswitch inside it as an independently tracked, pinned `hyperswitch/` Git submodule. The current `/Users/byteninja/Downloads/Healiot/Apps/OpenSwitch` checkout and its uncommitted Kashier work must remain untouched. The platform repository should own only platform guidance, deployment organization, connector ownership metadata, and architecture documentation at this stage—not a copy or a mass relocation of Hyperswitch source.

Success means the outer repository has the agreed layout; `hyperswitch/` resolves to the verified official-upstream commit; a fresh clone can initialize the submodule using a portable remote URL; the original checkout has exactly the same tracked and untracked work it had before; and no production, Coolify, database, or payment behavior changes occur.

## Choice and rationale

The selected approach is a new sibling Git repository with `hyperswitch/` as a submodule of `https://github.com/juspay/hyperswitch.git`. The submodule must pin commit `568a91925fc7ae1948838e105afdd98210cb3152`; the official upstream tag `2025.06.18.0-hotfix1` was verified to resolve to that commit. The tag/commit describes the local baseline, not a production deployment. `git@github.com:Byt3Ninja/openswitch-platform.git` is the intended outer repository remote; it currently advertises no refs and is **not** the Hyperswitch child remote.

Moving the approximately 12,500 tracked upstream files into a subdirectory of the current fork would make future upstream merges and patches more conflict-prone. A Git subtree would keep a copy of upstream files in the outer history instead of the independent Git boundary requested. A sibling repository avoids both problems and does not disturb the dirty current checkout.

## Target structure and ownership

```text
OpenSwitch-platform/
├── .gitmodules
├── AGENTS.md
├── README.md
├── hyperswitch/                 # pinned submodule: official Hyperswitch
├── deployment/coolify/
│   ├── staging/README.md
│   └── production/README.md
├── connectors/README.md
└── docs/
    ├── architecture.md
    └── superpowers/
        ├── specs/2026-09-20-platform-layout-design.md
        └── plans/2026-09-20-platform-layout.md
```

- The outer repository owns platform policy, integration boundaries, deployment organization, and metadata. Its root `AGENTS.md` must describe this outer-repo architecture and preserve the upstream-first/core-approval/security rules. It must not claim that the outer repository contains Hyperswitch source as ordinary tracked files.
- `hyperswitch/` is owned by the official upstream Hyperswitch Git history. The outer repository tracks only the submodule pointer. Hyperswitch code, migrations, and core configuration remain in the child repository; upstream updates change the pinned gitlink only after review and testing. Do not copy its source, Docker files, or migration tree into the outer repository.
- `deployment/coolify/staging/README.md` and `deployment/coolify/production/README.md` identify the environment boundary and explicitly say that no deployable manifest, Coolify app ID, runtime variable, secret, domain, or live service has been verified or created. They must not contain credentials or invented operational settings. A real deployment design is a later task.
- `connectors/README.md` is an ownership/compatibility registry, not a connector implementation. It should mark Kashier as in-progress in the existing checkout and its authoritative long-term repository as undecided. It must not duplicate the uncommitted Kashier source.
- `docs/architecture.md` explains parent/child ownership, upstream update flow, connector and adapter boundaries, and the fact that deployment assets are organizational placeholders only. `README.md` explains how to clone with submodules and what is currently not configured.
- Do not create `config/`, `adapters/`, service source trees, or additional ADR/ledger scaffolding until an actual requirement gives them content and ownership.

## Transition and behavior

This is a Category B platform/deployment-structure task. No Category E Hyperswitch core change is authorized or required. Capture a read-only baseline of the current checkout's status and verify the upstream tag still resolves to the pinned SHA. If the commit is not remotely available, stop rather than silently committing or pushing Kashier work or pinning an unreachable submodule revision. Initialize the outer repository only after the reviewed implementation plan is approved. Add the submodule using the official upstream HTTPS URL; do not use a machine-local path in `.gitmodules`. Then add only the agreed outer files in focused commits. Configure the outer `origin` to the user-confirmed `Byt3Ninja/openswitch-platform` remote, but do not push until the plan explicitly authorizes a verified non-force push. The old checkout currently also calls that URL `origin`; never push from that checkout as if it were a Hyperswitch fork.

The dirty Kashier files stay in the existing checkout. Because a submodule points to an official upstream commit, those uncommitted files will not appear in a fresh clone of the outer repository. A later connector task must decide ownership and gain any required Category E approval before modifying shared Hyperswitch files or committing/publishing the current in-tree work. This structural task neither validates Kashier for production nor extracts it.

## Verification and failure handling

Verify `.gitmodules` uses the official upstream HTTPS URL; `git submodule status` shows the intended pinned SHA; `git ls-files --stage hyperswitch` records a gitlink rather than copied files; and a fresh-clone/submodule-initialization check succeeds if remote access permits. Compare the original checkout's status and HEAD to the captured baseline. Review the outer diff for exactly the agreed files, no secrets, no generated artifacts, and no misleading claims about deployed environments. Rust tests, migrations, and deployment smoke tests are not required for a structure-only change and must not be claimed as run. Report any validation blocked by remote access.

If setup fails, leave the original fork and Kashier work unchanged. Do not reset/clean that checkout, rewrite upstream history, or perform a production action. Keep any partially created outer repository local for diagnosis or remove it only after its exact contents are verified and the user agrees. A successful structural change is reversible by changing or retiring the new outer repository; it does not roll back or alter payment data.

## Review boundary

Before Git initialization, the outer folder holds only design and planning documents. The spec cannot be committed there until repository creation is approved. After review, write an implementation plan, obtain approval for its execution, then initialize the outer repository and include this spec in its first focused commit.
