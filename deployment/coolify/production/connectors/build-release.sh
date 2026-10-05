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
for tool in docker; do
    command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
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
docker build --platform linux/amd64 --iidfile "$OUTPUT/builder-id" \
    "$ROOT/deployment/coolify/production/connectors/builder"
BUILDER_ID=$(cat "$OUTPUT/builder-id")
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" \
    --cap-drop=ALL --security-opt=no-new-privileges \
    --mount "type=bind,src=$OUTPUT,dst=/build" \
    --mount "type=bind,src=$ROOT/connectors/hyperswitch-easykash-connector/tests/control_center_catalog.mjs,dst=/contract/control_center_catalog.mjs,readonly" \
    "$BUILDER_ID"
VERSION="hs83cc4876-k10f0957-e50baf0d-ccadc307d-b${BUILDER_ID#sha256:}"
for role in router producer consumer dashboard; do
    docker build --platform linux/amd64 --file "$ROOT/deployment/coolify/production/connectors/images/$role.Dockerfile" \
        --tag "openswitch/connectors:$role-$VERSION" "$OUTPUT/artifacts"
done
python3 "$VALIDATOR" record "$OUTPUT"
echo "Local release record: $OUTPUT/release.json; publication and deployment require the live gate."
