# Validation record

Date: 2026-10-03. Required runtime: Node 24 LTS. Local available runtime: v24.18.0. Classification D/A plus documentation. Upstream core changes: NONE. No database/migration, staging, production, provider configuration or financial operation is included.

The package tests exercise real filesystem staging and installed ZIP/unzip commands with temporary dummy fixtures. They check exclusion of `.env`, state/dependency/cache canaries by path and bytes; every inventory hash; archive/staging equivalence; ZIP/version matching; refusal to overwrite existing output; symlink and unsafe-path rejection; and failed archive-command cleanup. Dummy canaries are synthetic, not fragments of real secrets.

The complete offline suite covers configuration/mode isolation, API boundary validation/redaction, persistence/restart/uncertain outcomes, order matching, local HTTP/CSRF/Host/Origin protections and browser-controller behavior. It uses local fake APIs and does not certify hosted SDK/provider operation.

## Recorded and pending checks

- Task 6 initial `node --test test/package.test.mjs`: five expected assertion failures because the release builder was missing.
- Focused packaging suite after implementation: six passing tests on Node v24.18.0. An initial overly broad exclusion assertion also matched the approved `config.example.env` template; corrected it to match excluded path segments.
- Source `npm test`: **220 passed, 0 failed** on Node v24.18.0, from base commit `685b9ac` plus the Task 6 packaging/docs changes. Actual `npm run package -- <fresh-output>` succeeded. `unzip -t` found no archive errors; `shasum -a 256 -c SHA256SUMS` verified both the ZIP and `release.json`. Clean-unpack verification matched all **32 input-file inventory hashes**. Unpacked `npm test`: **220 passed, 0 failed** on the same runtime.
- Unpacked `npm start` bound to `http://127.0.0.1:4242`; page/config HTTP smoke returned200 with demo mode and USD/GBP catalog. Normal terminal (PTY) Ctrl-C exited0, closed the listener and released the state lock. A separate non-PTY tool Ctrl-C killed the npm process tree with exit130 and left the local smoke-state lock; this is not claimed as graceful shutdown. Use normal terminal termination or the directly tested server SIGTERM path; after an abrupt kill, follow the store's manual recovery policy rather than blindly deleting a lock.
- Controller browser check of earlier commit `685b9ac`: simulated USD1250 success and GBP900 failure/cancellation; reload kept order identity without a new POST; forged return query was cleared and did not change backend failed status; only loopback traffic/no card inputs; mobile375x812 and desktop1280x900 had no horizontal overflow. Automatic favicon404 was deferred for the final review/fix wave.
- Independent whole-change/security review and final clean-unpacked browser acceptance are owned by the controller and remain pending at this task handoff. Do not treat the earlier browser observation as the final archive browser check.

## Reproduce artifact checks

```sh
node --version
npm test
npm run package -- /absolute/path/to/fresh-release
unzip -t /absolute/path/to/fresh-release/openswitch-web-starter-0.1.0.zip
cd /absolute/path/to/fresh-release
shasum -a 256 -c SHA256SUMS
unzip openswitch-web-starter-0.1.0.zip -d /absolute/path/to/fresh-unpack
cd /absolute/path/to/fresh-unpack/openswitch-web-starter-0.1.0
npm test
npm start
```

Verify `RELEASE-MANIFEST.json` against every listed file using SHA-256; inventory excludes the generated manifest itself. Inspect demo in a fresh browser context: explicit simulated mode and catalog labels; no card inputs; loopback-only requests; no console errors; success/failure/cancellation; reload identity recovery without another creation; query stripping on `/return`; readable desktop/mobile layout; graceful shutdown. Keep demo and sandbox state separate.

Real sandbox hosted form/CORS/CSP, provider redirects/3DS/status reconciliation, refunds, outgoing signing/duplicates/retries and production operation remain unverified. Obtain required provisioning and action-specific approvals before those checks. The existing development-server/WebSocket issue, mutable SDK URL and webhook secret/revision gap remain explicit blockers. No authenticated runtime evidence was refreshed and no financial operation was performed by this package task.
