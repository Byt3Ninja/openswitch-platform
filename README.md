# OpenSwitch Platform

[Generic OpenSwitch web integration starter](integrations/web-starter/README.md)

This repository organizes the payment platform around a pinned, independently tracked Hyperswitch submodule. It is not a copy of Hyperswitch source.

## Clone

git clone --recurse-submodules git@github.com:Byt3Ninja/openswitch-platform.git

The hyperswitch/ directory points to official juspay/hyperswitch at commit `83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1` (tag `v1.126.0`). This is a source baseline, not a claim about any deployed version.

## Current scope

deployment/coolify/staging and deployment/coolify/production document separate environments but contain no deployable service manifests, credentials, or verified Coolify application settings. The production connectors directory owns local combined-image packaging and the sandbox desired-state contract; see [connector ownership](connectors/README.md) for validation and release blockers. connectors/ contains pinned, independently tracked Kashier and EasyKash Git submodules. Registering or packaging these integration kits does not change production. Read docs/architecture.md and AGENTS.md before changing the platform.

The previous OpenSwitch checkout contains uncommitted Kashier work. It is not the source of the Hyperswitch or connector submodules. Its old origin URL points to this platform repository; never push Hyperswitch commits from that checkout to this platform remote.
