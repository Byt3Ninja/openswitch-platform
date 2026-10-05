"""Release boundary tests: pins, isolated integration, and routing consistency."""
import importlib.util
import json
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGING = ROOT / "deployment/coolify/production/connectors"
SCRIPT = PACKAGING / "build-release.sh"
HELPER = ROOT / "scripts/validate_connector_release.py"
PINS = {
    "hyperswitch": "83cc4876dd067ff16bcac51ce2737ee0fe0bf8b1",
    "connectors/hyperswitch-kashier-connector": "10f0957a1d1cd9342bed25d41869c8c0a5a60c7f",
    "connectors/hyperswitch-easykash-connector": "50baf0d196cb4e6726bd6b786e6e305260ac2fbe",
}


def git(path, *args):
    return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()


class ConnectorReleaseContractTests(unittest.TestCase):
    def helper(self):
        self.assertTrue(HELPER.is_file(), "release validator is missing")
        spec = importlib.util.spec_from_file_location("release_contract", HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_validate_only_checks_exact_sources_without_building(self):
        self.assertTrue(SCRIPT.is_file(), "build-release.sh is missing")
        result = subprocess.run([str(SCRIPT), "--validate-only"], text=True,
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Registry contract: kashier, easykash", result.stdout)
        self.assertIn("Patch order: kashier -> easykash", result.stdout)
        self.assertIn("no artifacts or images built", result.stdout)
        self.assertIn("Compatibility patch: Santander metadata table header", result.stdout)
        self.assertNotIn("BASELINE METADATA DEFECT", result.stderr)
        for path, sha in PINS.items():
            self.assertEqual(git(ROOT / path, "rev-parse", "HEAD"), sha)

    def test_preserves_exact_runtime_packaging_contract(self):
        for role, artifact in (("router", "router"), ("producer", "scheduler"),
                               ("consumer", "scheduler"), ("dashboard", "dist/")):
            path = PACKAGING / "images" / f"{role}.Dockerfile"
            self.assertTrue(path.is_file(), f"missing {role} image")
            source = path.read_text()
            reference = (ROOT / "connectors/hyperswitch-kashier-connector/deploy"
                         / f"{role}.Dockerfile").read_text()
            self.assertEqual(source, reference)
            self.assertRegex(source, r"FROM \S+@sha256:[0-9a-f]{64}\n")
            self.assertIn(artifact, source)
            self.assertNotRegex(source, r"(?im)^\s*(ARG|ENV|ENTRYPOINT|CMD|VOLUME)\b")

    def test_manifest_keeps_sandbox_endpoint_and_no_credential_fields(self):
        from scripts.validate_connector_rollout_manifest import validate_manifest
        data = json.loads((PACKAGING / "desired-state.json").read_text())
        self.assertEqual(validate_manifest(data), [])
        self.assertEqual(data["providers"]["kashier"]["base_url"],
                         "https://test-api.kashier.io/")

    def test_source_guard_refuses_wrong_revision_and_dirty_input(self):
        helper = self.helper()
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            git(repo, "init", "-q")
            git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "--allow-empty", "-qm", "fixture")
            sha = git(repo, "rev-parse", "HEAD")
            helper.verify_source(repo, sha)
            with self.assertRaisesRegex(ValueError, "wrong revision"):
                helper.verify_source(repo, "0" * 40)
            (repo / "unexpected").write_text("untracked input")
            with self.assertRaisesRegex(ValueError, "dirty input"):
                helper.verify_source(repo, sha)

    def test_registry_contract_rejects_incident_partial_state_and_missing_mappings(self):
        helper = self.helper()
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp) / "hyperswitch"
            helper.prepare_backend(ROOT, tree)
            helper.validate_registries(tree)
            routing = tree / "crates/euclid/src/enums.rs"
            original = routing.read_text()
            # Reproduce broad Connector + feature support with absent routable enum.
            for variant in ("Kashier", "Easykash"):
                mutations = (
                    original.replace(f"    {variant},\n", "", 1),
                    original.replace(f"Connector::{variant} => Ok(Self::{variant}),", ""),
                    original.replace(f"RoutableConnectors::{variant} => Self::{variant},", ""),
                )
                for changed in mutations:
                    self.assertNotEqual(changed, original)
                    routing.write_text(changed)
                    with self.assertRaisesRegex(ValueError, variant):
                        helper.validate_registries(tree)
            routing.write_text(original)
            broad = tree / "crates/common_enums/src/connector_enums.rs"
            broad.write_text(broad.read_text().replace("    Kashier,\n", "", 1))
            with self.assertRaisesRegex(ValueError, "Kashier"):
                helper.validate_registries(tree)

    def test_requires_explicit_fresh_output_directory(self):
        self.assertTrue(SCRIPT.is_file(), "build-release.sh is missing")
        for arguments in ([], ["--unknown"], [str(ROOT)]):
            result = subprocess.run([str(SCRIPT), *arguments], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertRegex(result.stderr, "Usage:|output directory already exists")

    def test_metadata_gate_blocks_known_baseline_without_hiding_new_errors(self):
        helper = self.helper()
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp) / "source"
            subprocess.run(["git", "clone", "--quiet", "--shared", "--no-checkout",
                            str(ROOT / "hyperswitch"), str(tree)], check=True)
            name = "crates/connector_configs/toml/production.toml"
            git(tree, "checkout", PINS["hyperswitch"], "--", name)
            with self.assertRaisesRegex(ValueError, "BASELINE METADATA DEFECT"):
                helper.validate_metadata(tree, strict=True)
            path = tree / name
            original = path.read_text()
            for defect in ("invalid TOML!\n", "[new]\nx=1\nx=2\n"):
                path.write_text(defect + original)
                with self.assertRaisesRegex(ValueError, "new production metadata parse failure"):
                    helper.validate_metadata(tree, strict=True)

    def test_builder_contract_rejects_unpinned_or_host_build_inputs(self):
        helper = self.helper()
        self.assertTrue(hasattr(helper, "validate_builder"), "pinned builder gate is missing")
        helper.validate_builder(PACKAGING)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            import shutil
            shutil.copytree(PACKAGING / "builder", target / "builder")
            recipe = target / "builder/Dockerfile"
            original = recipe.read_text()
            for old, new in (("@sha256:", ":unpinned-"),
                             ("snapshot.debian.org", "deb.debian.org")):
                recipe.write_text(original.replace(old, new))
                with self.assertRaisesRegex(ValueError, "builder contract"):
                    helper.validate_builder(target)

    def test_compatibility_patch_repairs_only_approved_metadata_insertion(self):
        helper = self.helper()
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp) / "source"
            helper.prepare_backend(ROOT, tree)
            helper.validate_metadata(tree, strict=True)
            metadata = tomllib.loads((tree / "crates/connector_configs/toml/production.toml").read_text())
            fields = metadata["santander"]["metadata"]["pix_automatico_push"]
            self.assertEqual([field["name"] for field in fields],
                             ["client_id", "client_secret", "pix_key_type", "pix_key_value",
                              "account_number", "account_type", "branch_code"])
            self.assertIn("kashier", metadata)
            self.assertIn("easykash", metadata)

    def test_builder_memory_contract_rejects_mutable_or_missing_limits(self):
        helper = self.helper()
        helper.validate_builder(PACKAGING)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            import shutil
            shutil.copytree(PACKAGING / "builder", target / "builder")
            for filename, directive in (("Dockerfile", "ENV"), ("compile-release.sh", "export")):
                path = target / "builder" / filename
                original = path.read_text()
                for name, value in (("CARGO_BUILD_JOBS", "1"),
                                    ("CARGO_PROFILE_TEST_DEBUG", "0"),
                                    ("CARGO_PROFILE_DEV_DEBUG", "0")):
                    approved = f"{directive} {name}={value}\n"
                    self.assertIn(approved, original, f"missing immutable {name}")
                    for replacement in ("", f"{directive} {name}=2\n",
                                        f"{directive} {name}=${{{name}:-{value}}}\n",
                                        approved + f"{directive} {name}=2\n"):
                        with self.subTest(filename=filename, setting=name, replacement=replacement):
                            path.write_text(original.replace(approved, replacement))
                            with self.assertRaisesRegex(ValueError, "builder contract.*memory"):
                                helper.validate_builder(target)
                            path.write_text(original)

    def test_compile_memory_limits_override_inherited_host_values(self):
        # Exercise the real entrypoint, stopping at its first Cargo invocation.
        # Stub only filesystem navigation/creation and Cargo to avoid any build.
        probe = r'''
mkdir() { :; }
cd() { :; }
cargo() {
    printf '%s %s %s %s\n' "$CARGO_BUILD_JOBS" "$CARGO_PROFILE_TEST_DEBUG" "$CARGO_PROFILE_DEV_DEBUG" "${CARGO_PROFILE_RELEASE_DEBUG-unset}"
    exit 73
}
. "$1"
'''
        result = subprocess.run(["/bin/sh", "-c", probe, "memory-contract",
                                 str(PACKAGING / "builder/compile-release.sh")],
                                env={"PATH": "/usr/bin:/bin", "CARGO_BUILD_JOBS": "99",
                                     "CARGO_PROFILE_TEST_DEBUG": "2", "CARGO_PROFILE_DEV_DEBUG": "2"},
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertEqual(result.stdout, "1 0 0 unset\n")

    def test_compatibility_patch_rejects_drift_repeat_and_expanded_scope(self):
        helper = self.helper()
        self.assertTrue(hasattr(helper, "apply_compatibility_patch"), "compatibility gate is missing")
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            tree = directory / "source"
            subprocess.run(["git", "clone", "--quiet", "--shared",
                            str(ROOT / "hyperswitch"), str(tree)], check=True)
            git(tree, "checkout", "--quiet", "--detach", PINS["hyperswitch"])
            patch_path = directory / "deployment/coolify/production/connectors/compatibility/santander-metadata.patch"
            patch_path.parent.mkdir(parents=True)
            original_patch = (PACKAGING / "compatibility/santander-metadata.patch").read_text()
            patch_path.write_text(original_patch)
            name = "crates/connector_configs/toml/production.toml"
            metadata = tree / name
            original = metadata.read_text()
            mutations = (
                original_patch.replace("+[[santander.metadata.pix_automatico_push]]", "+[[santander.metadata.pix_qr]]"),
                original_patch.replace("+[[santander.metadata.pix_automatico_push]]", "+[[santander.metadata.pix_automatico_push]]\n+unapproved=true"),
                original_patch.replace(' name="pix_key_type"', '-name="pix_key_type"'),
                original_patch.replace(name, "crates/connector_configs/toml/development.toml"),
                original_patch + "--- a/unapproved\n+++ b/unapproved\n@@ -0,0 +1 @@\n+extra\n",
            )
            for mutation in mutations:
                self.assertNotEqual(mutation, original_patch)
                patch_path.write_text(mutation)
                with self.assertRaisesRegex(ValueError, "compatibility patch"):
                    helper.apply_compatibility_patch(directory, tree)
                self.assertEqual(metadata.read_text(), original)
                self.assertEqual(git(tree, "status", "--porcelain"), "")
            patch_path.write_text(original_patch)
            metadata.write_text(original + "\n# baseline drift\n")
            with self.assertRaisesRegex(ValueError, "dirty input"):
                helper.apply_compatibility_patch(directory, tree)
            metadata.write_text(original)
            git(tree, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "--allow-empty", "-qm", "wrong baseline")
            with self.assertRaisesRegex(ValueError, "wrong revision"):
                helper.apply_compatibility_patch(directory, tree)
            git(tree, "checkout", "--quiet", "--detach", PINS["hyperswitch"])
            helper.apply_compatibility_patch(directory, tree)
            self.assertEqual(git(tree, "diff", "--numstat"), f"1\t0\t{name}")
            self.assertEqual(git(tree, "diff", "--name-only"), name)
            additions = [line for line in git(tree, "diff", "--", name).splitlines()
                         if line.startswith("+") and not line.startswith("+++")]
            self.assertEqual(additions, ["+[[santander.metadata.pix_automatico_push]]"])
            tomllib.loads(metadata.read_text())
            with self.assertRaisesRegex(ValueError, "dirty input"):
                helper.apply_compatibility_patch(directory, tree)

    def test_record_requires_runtime_abi_checks_and_identifies_builder(self):
        helper = self.helper()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "artifacts").mkdir()
            for binary in ("router", "scheduler"):
                (directory / "artifacts" / binary).write_bytes(b"fixture binary")
            (directory / "builder-id").write_text("sha256:" + "a" * 64)
            parent_commit = git(ROOT, "rev-parse", "HEAD")
            def inspect(command, **kwargs):
                if command[0] == "docker":
                    return "sha256:" + "b" * 64
                self.assertEqual(command, ["git", "-C", str(ROOT), "rev-parse", "HEAD"])
                return parent_commit
            with patch.object(helper.subprocess, "check_output", side_effect=inspect):
                with patch.object(helper.subprocess, "run", side_effect=subprocess.CalledProcessError(127, "runtime symbol lookup")):
                    with self.assertRaises(subprocess.CalledProcessError):
                        helper.record_release(directory)
                self.assertFalse((directory / "release.json").exists())
                with patch.object(helper.subprocess, "run") as runtime:
                    helper.record_release(directory)
                self.assertEqual(runtime.call_count, 3)
                for call in runtime.call_args_list:
                    argv = call.args[0]
                    self.assertTrue(call.kwargs["check"])
                    self.assertIn("--network=none", argv)
                    self.assertIn("--read-only", argv)
                    self.assertIn("LD_BIND_NOW=1", argv)
                    self.assertEqual(argv[-2:], ["sha256:" + "b" * 64, "--version"])
            record = json.loads((directory / "release.json").read_text())
            self.assertEqual(record["builder_image_id"], "sha256:" + "a" * 64)
            self.assertEqual(record["runtime_abi_checked"], ["router", "producer", "consumer"])
            for image in record["images"].values():
                self.assertTrue(image["tag"].endswith("-b" + "a" * 64))


if __name__ == "__main__":
    unittest.main()
