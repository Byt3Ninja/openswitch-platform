#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


FORBIDDEN_KEY = re.compile(
    r"(^|_)(secret|password|token|private_key|api_key_value|webhook_secret)(_|$)",
    re.IGNORECASE,
)
EXPECTED_PROFILES = {
    "growthlabs_production": {
        "mulkstay_production": ("MulkStay", "mulkstay", "https://mulkstay.com", "live"),
        "startpad_production": ("Startpad", "startpad", "https://startpad.me", "live"),
        "hackathon_production": ("Hackathon", "hackathon", "https://play.catalystos.net", "live"),
    },
    "growthlabs_sandbox": {
        "mulkstay_sandbox": ("MulkStay Sandbox", "mulkstay", "https://staging.mulkstay.com", "test"),
        "startpad_sandbox": ("Startpad Sandbox", "startpad", "https://staging.startpad.me", "test"),
        "hackathon_sandbox": ("Hackathon Sandbox", "hackathon", "https://play-staging.catalystos.net", "test"),
    },
    "healiot_egypt_production": {
        "wq3_production": ("WQ3", "wq3", "https://econtract.tawqe3y.com", "live"),
    },
    "healiot_egypt_sandbox": {
        "wq3_sandbox": ("WQ3 Sandbox", "wq3", "https://econtract-staging.tawqe3y.com", "test"),
    },
}
EXPECTED_MERCHANTS = {
    "growthlabs_production": ("GrowthLabs", "production"),
    "growthlabs_sandbox": ("GrowthLabs Sandbox", "sandbox"),
    "healiot_egypt_production": ("Healiot Egypt", "production"),
    "healiot_egypt_sandbox": ("Healiot Egypt Sandbox", "sandbox"),
}


def secret_shaped_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_KEY.search(key):
                yield key
            yield from secret_shaped_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from secret_shaped_keys(child)


def validate_manifest(data: dict) -> list[str]:
    errors = []
    for key in sorted(set(secret_shaped_keys(data))):
        errors.append(f"manifest contains forbidden secret-shaped key: {key}")

    if data.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    if data.get("organization") != {
        "display_name": "Healiot LLC",
        "initial_admin_email": "info@healiot.com",
    }:
        errors.append("organization differs from approved state")
    if data.get("defaults") != {
        "country": "EG",
        "currency": "EGP",
        "connector": "stripe",
    }:
        errors.append("defaults must be country EG, currency EGP, connector stripe")
    if data.get("production_cutover_order") != ["startpad", "mulkstay", "hackathon", "wq3"]:
        errors.append("production_cutover_order differs from approved state")

    merchants = data.get("merchants")
    if not isinstance(merchants, list):
        return errors + ["merchants must be a list"]
    keyed_merchants = {merchant.get("key"): merchant for merchant in merchants if isinstance(merchant, dict)}
    if set(keyed_merchants) != set(EXPECTED_MERCHANTS) or len(merchants) != 4:
        errors.append("merchant keys differ from approved state")

    base_urls = []
    for merchant_key, (display_name, environment) in EXPECTED_MERCHANTS.items():
        merchant = keyed_merchants.get(merchant_key)
        if merchant is None:
            continue
        if merchant.get("display_name") != display_name or merchant.get("environment") != environment:
            errors.append(f"merchant {merchant_key} differs from approved state")
        profiles = merchant.get("profiles")
        if not isinstance(profiles, list):
            errors.append(f"merchant {merchant_key} profiles must be a list")
            continue
        keyed_profiles = {profile.get("key"): profile for profile in profiles if isinstance(profile, dict)}
        expected = EXPECTED_PROFILES[merchant_key]
        if set(keyed_profiles) != set(expected) or len(profiles) != len(expected):
            errors.append(f"merchant {merchant_key} profiles differ from approved state")
        for profile_key, expected_values in expected.items():
            profile = keyed_profiles.get(profile_key)
            if profile is None:
                continue
            actual_values = (
                profile.get("display_name"),
                profile.get("project"),
                profile.get("base_url"),
                profile.get("stripe_mode"),
            )
            if actual_values != expected_values:
                errors.append(f"profile {profile_key} differs from approved state")
            required_mode = "test" if environment == "sandbox" else "live"
            if profile.get("stripe_mode") != required_mode:
                errors.append(f"profile {profile_key} must use Stripe {required_mode} mode")
            base_url = profile.get("base_url")
            if isinstance(base_url, str):
                base_urls.append(base_url)

    if len(base_urls) != len(set(base_urls)):
        errors.append("profile base_url values must be unique")
    return errors


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) == 2 else Path(
        "deployment/coolify/production/organization/desired-state.json"
    )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"manifest read failed: {error}", file=sys.stderr)
        return 2
    errors = validate_manifest(data)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("organization manifest valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
