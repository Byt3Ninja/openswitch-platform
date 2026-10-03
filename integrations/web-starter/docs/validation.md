# Validation record

Date: 2026-10-03. Required runtime: Node 24 LTS. Local available runtime: v24.18.0. Classification D/A plus documentation. Upstream core changes: NONE. No database/migration, staging, production, provider configuration or financial operation is included.

The package tests exercise real filesystem staging and installed ZIP/unzip commands with temporary dummy fixtures. They check exclusion of `.env`, state/dependency/cache canaries by path and bytes; every inventory hash; archive/staging equivalence; ZIP/version matching; refusal to overwrite existing output; symlink and unsafe-path rejection; and failed archive-command cleanup. Dummy canaries are synthetic, not fragments of real secrets.

The complete offline suite covers configuration/mode isolation, API boundary validation/redaction, persistence/restart/uncertain outcomes, order matching, local HTTP/CSRF/Host/Origin protections and browser-controller behavior. It uses local fake APIs and does not certify hosted SDK/provider operation.

## Recorded and pending checks

- Task 6 initial `node --test test/package.test.mjs`: five expected assertion failures because the release builder was missing.
- Focused packaging suite after implementation: six passing tests on Node v24.18.0. An initial overly broad exclusion assertion also matched the approved `config.example.env` template; corrected it to match excluded path segments.
- Source `npm test`: **220 passed, 0 failed** on Node v24.18.0, from base commit `685b9ac` plus the Task 6 packaging/docs changes. Actual `npm run package -- <fresh-output>` succeeded. `unzip -t` found no archive errors; `shasum -a 256 -c SHA256SUMS` verified both the ZIP and `release.json`. Clean-unpack verification matched all **32 input-file inventory hashes**. Unpacked `npm test`: **220 passed, 0 failed** on the same runtime.
- Unpacked `npm start` bound to `http://127.0.0.1:4242`; page/config HTTP smoke returned200 with demo mode and USD/GBP catalog. Normal terminal (PTY) Ctrl-C exited0, closed the listener and released the state lock. A separate non-PTY tool Ctrl-C killed the npm process tree with exit130 and left the local smoke-state lock; this is not claimed as graceful shutdown. Use normal terminal termination or the directly tested server SIGTERM path; after an abrupt kill, follow [local state recovery and capacity](integration.md#local-state-recovery-and-capacity).
- Controller browser check of earlier commit `685b9ac`: simulated USD1250 success and GBP900 failure/cancellation; reload kept order identity without a new POST; forged return query was cleared and did not change backend failed status; only loopback traffic/no card inputs; mobile375x812 and desktop1280x900 had no horizontal overflow. Automatic favicon404 was deferred for the final review/fix wave.
- Independent whole-change/security review of `a1ea7f0..2b2165c` required R1–R7 fixes. The final fix wave addresses all seven: exact return-document exception, same-ID preparation of recovered new orders, nullish rejection handling, write/read capacity symmetry, guarded empty favicon response, linked stale-lock procedure, and exact release exceptions for `.gitignore`/`.nvmrc`.
- Final-fix TDD command: `node --test --test-reporter=spec test/server.test.mjs test/checkout-controller.test.mjs test/checkout-service.test.mjs test/order-store.test.mjs test/package.test.mjs` on Node v24.18.0. Before runtime fixes: **121 passed, 9 expected failures** (130 tests). After fixes: **130 passed, 0 failed**. These exercise real loopback return metadata with no service call/query reflection, strict rejection boundaries, one-item restored-order preparation and duplicate clicks, conservative nullish errors, real 16 MiB UTF-8 state preservation/restart, ambiguous-create capacity recovery without a replacement payment, guarded favicon204, and real ZIP/Git secret-ignore safeguards. Recovery prose was manually checked against store/config behavior.
- Final-fix full source command `npm test` on Node v24.18.0: **236 passed, 0 failed**, exit0, after the scoped runtime/test changes (about 2.99 seconds). This includes the packaging regression fixtures and both support modules discovered by Node; no provider request or production action was made. `git diff --check` was clean. The added safe dotfiles and capacity fixture bring the input inventory to **35 files**; final artifact verification is still pending.
- A fresh final source/unpacked suite, scoped re-review, release archive/inventory/hash verification and clean-unpacked browser acceptance are parent-owned. Do not treat prior archive/browser observations or focused favicon/return HTTP tests as final browser acceptance. Hosted/provider/webhook checks remain unverified.

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
