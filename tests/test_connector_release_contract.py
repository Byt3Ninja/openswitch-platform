"""Release boundary tests: pins, isolated integration, and routing consistency."""
import importlib.util
import json
import subprocess
import tempfile
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
        self.assertIn("BASELINE METADATA DEFECT", result.stderr)
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
