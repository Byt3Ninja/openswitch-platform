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
- Final-fix full source command `npm test` on Node v24.18.0: **236 passed, 0 failed**, exit0, after the scoped runtime/test changes (about 2.99 seconds). This includes the packaging regression fixtures and both support modules discovered by Node; no provider request or production action was made. `git diff --check` was clean. The added safe dotfiles and capacity fixture bring the input inventory to **35 files**; subsequent parent artifact verification is recorded below.
- Final parent verification at runtime commit `1c1760e`: fresh source and clean-unpacked `npm test` each passed **236/236**, exit0, on Node v24.18.0. `npm run package`, `unzip -t`, companion SHA256SUMS and all **35** unpacked inventory hashes passed. Independent scoped re-review marked R1–R7 addressed with no new breakage.
- Chrome154 clean-unpacked demo acceptance passed: simulated USD1250 success, GBP900 failure, cancellation, recovery of a never-started order with the original order/payment IDs, duplicate start suppression (one checkout POST, no replacement order), and mobile375x812/desktop1280x900 without horizontal overflow. No card inputs, remote SDK/provider traffic, console errors or warnings were observed. An isolated background context was used for the recovered-new-order check.
- A real browser link navigation from a separate loopback hostname sent `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document` to `/return` and received200. The synthetic success/client-secret query was removed; only the stored backend-failed order was retrieved and remained failed. This local return-boundary check does not certify a real provider redirect or hosted SDK integration.
- Direct server SIGTERM was independently verified: exit0, listener closed, `.lock` removed and `state.json` preserved. The desktop tool's Ctrl-C against another npm-launched smoke session terminated abruptly and left its dummy state lock even with a PTY; no automatic lock reclamation was performed. Tool termination must not be described as graceful; use the documented stale-lock recovery procedure when needed.
- These final observations concern the verified runtime/test bytes; the validation prose was then updated for release. The delivered archive must retain those same runtime/test bytes and its own verified inventory/checksums. Hosted/provider/webhook checks remain unverified.

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
