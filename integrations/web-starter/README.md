# OpenSwitch web starter 0.1.0

A runnable reference for integrating once with the standard hosted Hyper checkout SDK and existing OpenSwitch payment API. Merchant configuration, routing and payment context determine eligible methods. This package makes no provider readiness guarantee.

The default local demo is entirely simulated: no credentials, remote SDK, provider calls or card collection. The server binds to `127.0.0.1`. It is a local example, not a public production backend. There is no live mode and no published `@openswitch` npm wrapper.

## Quickstart

Install Node 24 LTS. The recorded local test runtime is **v24.18.0**. No npm dependencies or `npm install` are required. `npm start` needs only Node; `npm test` additionally uses installed system `zip` and `unzip` for real archive tests, and `git` to verify the unpacked secret-ignore safeguards. The unpack/checksum commands below use `unzip` and `shasum`. With the ZIP and its companion `SHA256SUMS` and `release.json` in the same directory:

```sh
shasum -a 256 -c SHA256SUMS
unzip openswitch-web-starter-0.1.0.zip
cd openswitch-web-starter-0.1.0
npm test
npm start
```

Open [http://127.0.0.1:4242](http://127.0.0.1:4242), select a simulated product, start checkout, and choose a simulated result. The catalog demonstrates two currencies without changing checkout logic. Use Ctrl-C to stop cleanly. Demo state defaults to an OS temporary directory outside the source; set a separate absolute `STATE_DIR` if you need isolated local sessions. Do not remove state or its lock while the process owns it.

After an abrupt stop or a state-capacity failure, follow [local state recovery and capacity](docs/integration.md#local-state-recovery-and-capacity). Preserve existing order/payment identities when recovering sandbox state.

Serve the page through `npm start`; opening `public/index.html` directly with `file://` cannot provide the same-origin backend, configuration or module flow. `config.example.env` is a template; it is not loaded automatically. If required, copy it to `.env` locally and keep private values outside version control and releases. Process environment variables override `.env`.

## Separately approved sandbox

An administrator must first provision test credentials and verify endpoint, merchant/profile ownership, provider test mode and routing. A hostname, profile name or key prefix does not prove isolation. Enable `MODE=sandbox` and `SANDBOX_CONFIRMED=yes` only after that review, then provide `API_KEY`, `PUBLISHABLE_KEY`, `PROFILE_ID` and an absolute `STATE_DIR` outside this source. Review `API_BASE_URL`, `SDK_URL`, `PORT` and matching `LOCAL_ORIGIN` using the template and [integration guide](docs/integration.md). The return URL is derived as `LOCAL_ORIGIN + /return`; `RETURN_URL` is unsupported.

Sandbox preparation creates an unconfirmed payment; confirmation can perform a financial operation. This package does not authorize that operation. Available methods and currencies depend on the configured account and connector. Real hosted checkout, CORS/CSP, provider completion and signed outgoing webhooks remain separately verified acceptance work.

## Guides and release

- [Integration and production adaptation](docs/integration.md)
- [Security responsibilities](docs/security.md)
- [Outgoing webhook blocker and verification contract](docs/webhooks.md)
- [Compatibility and platform requirements](docs/compatibility.md)
- [Validation evidence and remaining checks](docs/validation.md)
- [Optional WQ3 example](examples/wq3-paypal/README.md)

The preserved `OpenSwitch-WQ3-SDK-Starter-2026-10-02.zip` is superseded by this generic starter. It remains a historical artifact; use this guide for new integrations.

To build locally, install the system `zip` command and choose a fresh output directory outside the source:

```sh
npm run package -- /absolute/path/to/new-release-directory
```

The builder creates the versioned ZIP, staging directory, `release.json` and `SHA256SUMS`. `release-files.json` lists every approved input. The staged/archive `RELEASE-MANIFEST.json` hashes those inputs; it does not hash itself. Only allowlisted files are included, including tests, configuration templates, and the root `.gitignore` and `.nvmrc`. These are the only hidden-file exceptions: `.gitignore` excludes private `.env` files from ordinary Git staging, and `.nvmrc` selects Node 24 for compatible version managers. Ignore rules are defense in depth; keep private values out of commits and archives even when using Git force-add or other tools. Local `.env`, state, dependency and cache directories are excluded. Existing output paths and symlink inputs are rejected. `zip` is needed for packaging/tests, not `npm start`. Nothing is published by this command. Checksums establish local artifact integrity, not publisher authenticity or remote SDK immutability; the hosted SDK is neither vendored nor pinned by this ZIP.
