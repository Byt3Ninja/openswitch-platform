# OpenSwitch Platform

This repository organizes the payment platform around a pinned, independently tracked Hyperswitch submodule. It is not a copy of Hyperswitch source.

## Clone

git clone --recurse-submodules git@github.com:Byt3Ninja/openswitch-platform.git

The hyperswitch/ directory points to official juspay/hyperswitch at commit 568a91925fc7ae1948838e105afdd98210cb3152 (tag 2025.06.18.0-hotfix1). This is a source baseline, not a claim about any deployed version.

## Current scope

deployment/coolify/staging and deployment/coolify/production document separate environments but contain no deployable manifests, credentials, or verified Coolify application settings. connectors/ records connector ownership; it does not contain implementations. Read docs/architecture.md and AGENTS.md before changing the platform.

The previous OpenSwitch checkout contains uncommitted Kashier work that is intentionally absent from this upstream submodule. Its old origin URL points to this platform repository; never push Hyperswitch commits from that checkout to this platform remote.
