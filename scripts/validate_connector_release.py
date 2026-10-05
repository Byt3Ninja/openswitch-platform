"""Fail-closed source and packaging checks; never contacts a running service."""
import argparse
import difflib
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGING = ROOT / "deployment/coolify/production/connectors"
PINS = {
    "hyperswitch": "83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1",
    "connectors/hyperswitch-kashier-connector": "10f0957a1d1cd9342bed25d41869c8c0a5a60c7f",
    "connectors/hyperswitch-easykash-connector": "50baf0d196cb4e6726bd6b786e6e305260ac2fbe",
}
DASHBOARD_PIN = "adc307d08c87862380f966af44b849ddfee21dcc"
ROLES = ("router", "producer", "consumer", "dashboard")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def verify_source(repo, revision):
    if git(repo, "rev-parse", "HEAD") != revision:
        raise ValueError(f"wrong revision: {repo.name}; expected {revision}")
    if git(repo, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError(f"dirty input: {repo.name}")


def verify_inputs(root):
    validate_builder(PACKAGING)
    for path, revision in PINS.items():
        verify_source(root / path, revision)
        entry = git(root, "ls-files", "--stage", "--", path).split()
        if len(entry) != 4 or entry[0] != "160000" or entry[1] != revision:
            raise ValueError(f"incorrect gitlink: {path}")
    from scripts.validate_connector_rollout_manifest import validate_manifest
    errors = validate_manifest(json.loads((PACKAGING / "desired-state.json").read_text()))
    if errors:
        raise ValueError("invalid sandbox manifest: " + "; ".join(errors))
    for role in ROLES:
        dockerfile = (PACKAGING / "images" / f"{role}.Dockerfile").read_text()
        reference = (root / "connectors/hyperswitch-kashier-connector/deploy"
                     / f"{role}.Dockerfile").read_text()
        if dockerfile != reference or not re.search(r"^FROM \S+@sha256:[0-9a-f]{64}$", dockerfile, re.M):
            raise ValueError(f"unreviewed runtime packaging: {role}")


def apply_patches(root, target, dashboard=False):
    for connector in ("kashier", "easykash"):
        version = "control-center-v1.38.8" if dashboard else "v1.126.0"
        suffix = "-after-kashier" if connector == "easykash" else ""
        patch = root / f"connectors/hyperswitch-{connector}-connector/patches/hyperswitch-{version}{suffix}.patch"
        git(target, "apply", "--check", str(patch))
        git(target, "apply", str(patch))
    print("Patch order: kashier -> easykash", flush=True)


def prepare_backend(root, target):
    # Standalone shallow objects remain usable inside the isolated builder.
    subprocess.run(["git", "clone", "--quiet", "--no-local", "--depth=1", "--no-checkout",
                    str(root / "hyperswitch"), str(target)], check=True)
    git(target, "checkout", "--quiet", "--detach", PINS["hyperswitch"])
    apply_compatibility_patch(root, target)
    apply_patches(root, target)


def apply_compatibility_patch(root, target):
    # User-approved temporary repair, valid only before connector integration.
    verify_source(target, "83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1")
    name = "crates/connector_configs/toml/production.toml"
    source = (target / name).read_text()
    anchor = 'type="Text"\nname="pix_key_type"\n'
    insertion = 'type="Text"\n[[santander.metadata.pix_automatico_push]]\nname="pix_key_type"\n'
    if source.count(anchor) != 1:
        raise ValueError("compatibility patch: approved insertion point drifted")
    repaired = source.replace(anchor, insertion, 1)
    expected_patch = "".join(difflib.unified_diff(
        source.splitlines(keepends=True), repaired.splitlines(keepends=True),
        fromfile=f"a/{name}", tofile=f"b/{name}"))
    path = root / "deployment/coolify/production/connectors/compatibility/santander-metadata.patch"
    if path.read_text() != expected_patch:
        raise ValueError("compatibility patch: scope differs from the approved one-line insertion")
    # Require whole-file validity, without stripping or suppressing any metadata.
    tomllib.loads(repaired)
    git(target, "apply", "--check", str(path))
    git(target, "apply", str(path))
    if (target / name).read_text() != repaired:
        raise ValueError("compatibility patch: unexpected applied contents")
    print("Compatibility patch: Santander metadata table header", flush=True)


def block(source, declaration):
    start = source.index("{", source.index(declaration)) + 1
    depth = 1
    for index in range(start, len(source)):
        depth += (source[index] == "{") - (source[index] == "}")
        if depth == 0:
            return source[start:index]
    raise ValueError(f"unterminated source block: {declaration}")


def validate_registries(tree):
    broad = (tree / "crates/common_enums/src/connector_enums.rs").read_text()
    routing = (tree / "crates/euclid/src/enums.rs").read_text()
    connector = block(broad, "pub enum Connector ")
    routable = block(routing, "pub enum RoutableConnectors ")
    forward = block(routing, "impl TryFrom<Connector> for RoutableConnectors")
    reverse = block(routing, "impl From<RoutableConnectors> for Connector")
    for variant in ("Kashier", "Easykash"):
        requirements = (
            (connector, rf"(?m)^    {variant},$", "Connector"),
            (routable, rf"(?m)^    {variant},$", "RoutableConnectors"),
            (forward, rf"Connector::{variant}\s*=>\s*Ok\(Self::{variant}\)", "forward mapping"),
            (reverse, rf"RoutableConnectors::{variant}\s*=>\s*Self::{variant}", "reverse mapping"),
        )
        for source, pattern, label in requirements:
            if not re.search(pattern, source):
                raise ValueError(f"registry contract: missing {variant} in {label}")
    print("Registry contract: kashier, easykash", flush=True)


def validate_metadata(tree, strict=False):
    path = "crates/connector_configs/toml/production.toml"
    source = (tree / path).read_text()
    try:
        tomllib.loads(source)
    except tomllib.TOMLDecodeError as error:
        baseline = git(tree, "show", f"{PINS['hyperswitch']}:{path}")
        pattern = r"(?ms)^\[santander\]\n.*?(?=^\[(?!\[?santander[.\]])|\Z)"
        known = re.search(pattern, baseline)
        current = re.search(pattern, source)
        if not known or not current or known[0] != current[0]:
            raise ValueError("new production metadata parse failure") from error
        try:
            # Diagnostic only: never change production metadata or ship stripped data.
            tomllib.loads(re.sub(pattern, "", source))
        except tomllib.TOMLDecodeError as detail:
            raise ValueError("new production metadata parse failure") from detail
        try:
            tomllib.loads(known[0])
        except tomllib.TOMLDecodeError as detail:
            if "Cannot overwrite a value" not in str(detail):
                raise ValueError("new production metadata parse failure") from detail
        else:
            raise ValueError("new production metadata parse failure") from error
        message = "BASELINE METADATA DEFECT: official production.toml has duplicate Santander name; release build blocked"
        print(message, file=sys.stderr)
        if strict:
            raise ValueError(message) from error


def validate_builder(packaging):
    source = (packaging / "builder/Dockerfile").read_text()
    expected = [
        "docker.io/library/node@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b",
        "docker.io/library/rust@sha256:0ff31c9ffa641a62e48d543fb00b4960955ea375f40776f40f585b89e654cc5e",
    ]
    snapshot = "https://snapshot.debian.org/archive/debian/20250320T000000Z bookworm main"
    if re.findall(r"(?m)^FROM (\S+)", source) != expected or snapshot not in source:
        raise ValueError("builder contract: unreviewed compiler/native-library inputs")
    compile_script = (packaging / "builder/compile-release.sh").read_text()
    for name, value in (("CARGO_BUILD_JOBS", "1"),
                        ("CARGO_PROFILE_TEST_DEBUG", "0"),
                        ("CARGO_PROFILE_DEV_DEBUG", "0")):
        for directive, contents in (("ENV", source), ("export", compile_script)):
            values = re.findall(rf"(?m)^{directive} {name}=(.*)$", contents)
            if values != [value] or len(re.findall(rf"\b{name}\b", contents)) != 1:
                raise ValueError(f"builder contract: unreviewed memory setting {name}")


def record_release(directory):
    builder = (directory / "builder-id").read_text().strip()
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", builder):
        raise ValueError("missing pinned builder image ID")
    version = "hs83cc4876-k10f0957-e50baf0d-ccadc307d-b" + builder.removeprefix("sha256:")
    images = {}
    for role in ROLES:
        tag = f"openswitch/connectors:{role}-{version}"
        image_id = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", tag], text=True).strip()
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise ValueError(f"missing image ID: {role}")
        if role != "dashboard":
            binary = "router" if role == "router" else "scheduler"
            subprocess.run(["docker", "run", "--rm", "--platform=linux/amd64", "--network=none",
                            "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                            "--env", "LD_BIND_NOW=1", "--entrypoint", f"/local/bin/{binary}",
                            image_id, "--version"], check=True)
        images[role] = {"tag": tag, "image_id": image_id}
        print(f"{role}: {image_id}")
    checksums = {name: hashlib.sha256((directory / "artifacts" / name).read_bytes()).hexdigest()
                 for name in ("router", "scheduler")}
    record = {"source_pins": PINS, "control_center": DASHBOARD_PIN,
              "builder_image_id": builder, "runtime_abi_checked": ["router", "producer", "consumer"],
              "parent_commit": git(ROOT, "rev-parse", "HEAD"), "patch_order": ["kashier", "easykash"],
              "images": images, "binary_sha256": checksums, "published": False,
              "deployed": False, "routing": "explicit_only"}
    (directory / "release.json").write_text(json.dumps(record, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("validate", "prepare", "dashboard", "record"))
    parser.add_argument("directory", nargs="?", type=Path)
    args = parser.parse_args()
    if args.mode == "record":
        record_release(args.directory)
        return
    verify_inputs(ROOT)
    if args.mode == "dashboard":
        verify_source(args.directory, DASHBOARD_PIN)
        apply_patches(ROOT, args.directory, dashboard=True)
        return
    if args.mode == "prepare":
        prepare_backend(ROOT, args.directory)
        validate_registries(args.directory)
        validate_metadata(args.directory, strict=True)
        return
    with tempfile.TemporaryDirectory(prefix="openswitch-release-validate-") as tmp:
        tree = Path(tmp) / "hyperswitch"
        prepare_backend(ROOT, tree)
        validate_registries(tree)
        validate_metadata(tree)
    print("Validation complete; no artifacts or images built")


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        sys.exit(1)
