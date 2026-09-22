#!/bin/sh
set -eu
# All native compilation executes in the pinned builder at a stable path.
export HOME=/tmp/build-home CARGO_HOME=/tmp/cargo
mkdir -p "$HOME" "$CARGO_HOME"
(
    cd /build/hyperswitch
    cargo fmt --all -- --check
    cargo test --locked -p hyperswitch_connectors --features v1,frm,payouts,dummy_connector --no-default-features --test easykash
    cargo test --locked -p hyperswitch_connectors --features v1,frm,payouts,dummy_connector --no-default-features --lib connectors::easykash::transformers::tests
    cargo test --locked -p hyperswitch_connectors --test kashier --features v1,frm,payouts,dummy_connector --no-default-features
    cargo clippy --locked -p hyperswitch_connectors --features v1,frm,payouts,dummy_connector --no-default-features -- -D warnings
    cargo check --locked -p router --features release,v1,redis-rs --no-default-features
    cargo build --locked -p router --bins --release --no-default-features --features release,v1,redis-rs
)
(
    cd /build/control-center
    npm ci
    npm run re:format:check
    npm run re:build
    node /contract/control_center_catalog.mjs "$PWD"
    npm run build:prod
)
mkdir /build/artifacts
for binary in router scheduler; do
    artifact="/build/hyperswitch/target/release/$binary"
    [ -s "$artifact" ] && [ -x "$artifact" ] || { echo "Missing release binary: $binary" >&2; exit 1; }
    file "$artifact" | grep -q 'ELF 64-bit.*x86-64' || { echo "Wrong binary architecture: $binary" >&2; exit 1; }
    cp "$artifact" "/build/artifacts/$binary"
done
[ -s /build/control-center/dist/hyperswitch/app.js ] || { echo "Missing dashboard bundle" >&2; exit 1; }
cp -R /build/control-center/dist /build/artifacts/dist
