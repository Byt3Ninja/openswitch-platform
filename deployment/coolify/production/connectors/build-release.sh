#!/bin/sh
# Local-only packaging. Requires a fresh, explicit output directory for a build.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
VALIDATOR="$ROOT/scripts/validate_connector_release.py"
usage() { echo "Usage: $0 --validate-only | /absolute/new/output-directory" >&2; exit 2; }
[ "$#" -eq 1 ] || usage
for tool in git python3; do command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }; done
if [ "$1" = --validate-only ]; then
    exec python3 "$VALIDATOR" validate
fi
case "$1" in /*) OUTPUT=$1 ;; *) usage ;; esac
[ ! -e "$OUTPUT" ] && [ ! -L "$OUTPUT" ] || { echo "output directory already exists" >&2; exit 1; }
for tool in cargo rustc npm node docker pkg-config protoc file; do
    command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || {
    echo "Build requires x86_64 Linux (matching reviewed runtime images)" >&2; exit 1;
}
pkg-config --exists openssl libpq protobuf || { echo "Missing native build dependencies" >&2; exit 1; }
docker info >/dev/null
# Reject uncommitted parent packaging; validation mode supports review before commit.
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" ] || {
    echo "dirty input: parent release packaging" >&2; exit 1;
}
mkdir "$OUTPUT"
python3 "$VALIDATOR" prepare "$OUTPUT/hyperswitch"
git clone --no-checkout https://github.com/juspay/hyperswitch-control-center.git "$OUTPUT/control-center"
git -C "$OUTPUT/control-center" checkout --detach adc307d08c87862380f966af44b849ddfee21dcc
python3 "$VALIDATOR" dashboard "$OUTPUT/control-center"
(
    cd "$OUTPUT/hyperswitch"
    cargo fmt --all -- --check
    cargo test --locked -p hyperswitch_connectors --features v1,frm,payouts,dummy_connector --no-default-features --test easykash
    cargo test --locked -p hyperswitch_connectors --features v1,frm,payouts,dummy_connector --no-default-features --lib connectors::easykash::transformers::tests
    cargo test --locked -p hyperswitch_connectors --test kashier --features v1,frm,payouts,dummy_connector --no-default-features
    cargo clippy --locked -p hyperswitch_connectors --features v1,frm,payouts,dummy_connector --no-default-features -- -D warnings
    cargo check --locked -p router --features release,v1,redis-rs --no-default-features
    cargo build --locked -p router --bins --release --no-default-features --features release,v1,redis-rs
)
(
    cd "$OUTPUT/control-center"
    npm ci
    npm run re:format:check
    npm run re:build
    node "$ROOT/connectors/hyperswitch-easykash-connector/tests/control_center_catalog.mjs" "$PWD"
    npm run build:prod
)
mkdir "$OUTPUT/artifacts"
for binary in router scheduler; do
    artifact="$OUTPUT/hyperswitch/target/release/$binary"
    [ -s "$artifact" ] && [ -x "$artifact" ] || { echo "Missing release binary: $binary" >&2; exit 1; }
    file "$artifact" | grep -q 'ELF 64-bit.*x86-64' || { echo "Wrong binary architecture: $binary" >&2; exit 1; }
    cp "$artifact" "$OUTPUT/artifacts/$binary"
done
[ -s "$OUTPUT/control-center/dist/hyperswitch/app.js" ] || { echo "Missing dashboard bundle" >&2; exit 1; }
cp -R "$OUTPUT/control-center/dist" "$OUTPUT/artifacts/dist"
VERSION=hs83cc4876-k10f0957-e50baf0d-ccadc307d
for role in router producer consumer dashboard; do
    docker build --platform linux/amd64 --file "$ROOT/deployment/coolify/production/connectors/images/$role.Dockerfile" \
        --tag "openswitch/connectors:$role-$VERSION" "$OUTPUT/artifacts"
done
python3 "$VALIDATOR" record "$OUTPUT"
echo "Local release record: $OUTPUT/release.json; publication and deployment require the live gate."
