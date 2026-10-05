import copy
import json
import unittest
from pathlib import Path

from scripts.validate_connector_rollout_manifest import validate_manifest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deployment/coolify/production/connectors/desired-state.json"


class ConnectorRolloutManifestTests(unittest.TestCase):
    def load_manifest(self):
        return json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_approved_manifest_is_valid(self):
        self.assertEqual(validate_manifest(self.load_manifest()), [])

    def test_rejects_production_profile(self):
        data = self.load_manifest()
        data["profiles"][0]["profile"] = "MulkStay"
        self.assertIn("profiles differ from approved sandbox rollout", validate_manifest(data))

    def test_rejects_easykash_outside_wq3_sandbox(self):
        data = self.load_manifest()
        data["profiles"][0]["connectors"].append("easykash")
        self.assertIn("easykash is limited to WQ3 Sandbox", validate_manifest(data))

    def test_rejects_non_explicit_routing(self):
        data = self.load_manifest()
        data["routing"] = "default"
        self.assertIn("routing must be explicit_only", validate_manifest(data))

    def test_rejects_secret_shaped_and_unknown_fields(self):
        data = copy.deepcopy(self.load_manifest())
        data["providers"]["kashier"]["apiKey"] = "not-a-secret"
        errors = validate_manifest(data)
        self.assertIn("manifest contains forbidden secret-shaped key: apiKey", errors)
        self.assertIn("manifest contains unknown field at providers.kashier: apiKey", errors)
