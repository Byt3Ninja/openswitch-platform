import copy
import json
import unittest
from pathlib import Path

from scripts.validate_organization_manifest import validate_manifest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deployment/coolify/production/organization/desired-state.json"


class OrganizationManifestTests(unittest.TestCase):
    def load_manifest(self):
        return json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_approved_manifest_is_valid(self):
        self.assertEqual(validate_manifest(self.load_manifest()), [])

    def test_rejects_sandbox_profile_using_live_stripe_mode(self):
        data = self.load_manifest()
        data["merchants"][1]["profiles"][0]["stripe_mode"] = "live"
        self.assertIn(
            "profile mulkstay_sandbox must use Stripe test mode",
            validate_manifest(data),
        )

    def test_rejects_duplicate_application_domain(self):
        data = self.load_manifest()
        data["merchants"][1]["profiles"][0]["base_url"] = "https://mulkstay.com"
        self.assertIn("profile base_url values must be unique", validate_manifest(data))

    def test_rejects_missing_profile(self):
        data = self.load_manifest()
        data["merchants"][0]["profiles"].pop()
        self.assertIn(
            "merchant growthlabs_production profiles differ from approved state",
            validate_manifest(data),
        )

    def test_rejects_secret_shaped_fields(self):
        data = copy.deepcopy(self.load_manifest())
        data["stripe_secret_key"] = "not-a-credential"
        self.assertIn(
            "manifest contains forbidden secret-shaped key: stripe_secret_key",
            validate_manifest(data),
        )

    def test_rejects_unknown_root_field(self):
        data = copy.deepcopy(self.load_manifest())
        data["unapproved_setting"] = True
        self.assertIn(
            "manifest contains unknown field at root: unapproved_setting",
            validate_manifest(data),
        )

    def test_rejects_credential_like_key_variants_at_any_schema_level(self):
        cases = (
            ("api_key", lambda data: data),
            ("recovery_code", lambda data: data["organization"]),
            ("clientSecret", lambda data: data["merchants"][0]["profiles"][0]),
        )

        for key, target in cases:
            with self.subTest(key=key):
                data = copy.deepcopy(self.load_manifest())
                target(data)[key] = "not-a-credential"
                self.assertIn(
                    f"manifest contains forbidden secret-shaped key: {key}",
                    validate_manifest(data),
                )


if __name__ == "__main__":
    unittest.main()
