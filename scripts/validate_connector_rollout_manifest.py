#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


FORBIDDEN_KEY = re.compile(
    r"(^|_)(api_?key|secret|password|token|private_?key|webhook_?secret|recovery_?code)(_|$)",
    re.IGNORECASE,
)
ROOT_FIELDS = {
    "schema_version",
    "routing",
    "providers",
    "profiles",
    "excluded_profiles",
    "supported_flows",
    "unsupported_flows",
}
PROVIDER_FIELDS = {"environment", "base_url"}
PROFILE_FIELDS = {"merchant", "profile", "connectors"}
APPROVED_PROVIDERS = {
    "kashier": {
        "environment": "test",
        "base_url": "https://test-api.kashier.io/",
    },
    "easykash": {
        "environment": "low_risk_live_pilot",
        "base_url": "https://back.easykash.net/",
    },
}
APPROVED_PROFILES = [
    {
        "merchant": "GrowthLabs Sandbox",
        "profile": "MulkStay Sandbox",
        "connectors": ["kashier"],
    },
    {
        "merchant": "GrowthLabs Sandbox",
        "profile": "Startpad Sandbox",
        "connectors": ["kashier"],
    },
    {
        "merchant": "GrowthLabs Sandbox",
        "profile": "Hackathon Sandbox",
        "connectors": ["kashier"],
    },
    {
        "merchant": "Healiot Egypt Sandbox",
        "profile": "WQ3 Sandbox",
        "connectors": ["kashier", "easykash"],
    },
]


def normalized_key(key: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key).lower()


def secret_shaped_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_KEY.search(normalized_key(key)):
                yield key
            yield from secret_shaped_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from secret_shaped_keys(child)


def unknown_fields(value, allowed_fields, location):
    if not isinstance(value, dict):
        return
    for key in sorted(set(value) - allowed_fields):
        yield f"manifest contains unknown field at {location}: {key}"


def schema_unknown_fields(data):
    yield from unknown_fields(data, ROOT_FIELDS, "root")

    providers = data.get("providers") if isinstance(data, dict) else None
    if isinstance(providers, dict):
        for provider_name, provider in providers.items():
            yield from unknown_fields(
                provider,
                PROVIDER_FIELDS,
                f"providers.{provider_name}",
            )

    profiles = data.get("profiles") if isinstance(data, dict) else None
    if isinstance(profiles, list):
        for index, profile in enumerate(profiles):
            yield from unknown_fields(profile, PROFILE_FIELDS, f"profiles[{index}]")


def validate_manifest(data: dict) -> list[str]:
    errors = []
    for key in sorted(set(secret_shaped_keys(data))):
        errors.append(f"manifest contains forbidden secret-shaped key: {key}")
    errors.extend(schema_unknown_fields(data))

    if not isinstance(data, dict):
        return errors + ["manifest must be an object"]
    if data.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    if data.get("routing") != "explicit_only":
        errors.append("routing must be explicit_only")
    if data.get("providers") != APPROVED_PROVIDERS:
        errors.append("providers differ from approved connector rollout")
    if data.get("profiles") != APPROVED_PROFILES:
        errors.append("profiles differ from approved sandbox rollout")
    if any(
        isinstance(profile.get("connectors"), list)
        and "easykash" in profile["connectors"]
        and profile.get("profile") != "WQ3 Sandbox"
        for profile in data.get("profiles", [])
        if isinstance(profile, dict)
    ):
        errors.append("easykash is limited to WQ3 Sandbox")
    if data.get("excluded_profiles") != ["MulkStay", "Startpad", "Hackathon", "WQ3"]:
        errors.append("excluded_profiles differ from approved production exclusions")
    if data.get("supported_flows") != [
        "hosted_card_automatic_capture",
        "payment_sync",
        "signed_payment_webhook",
    ]:
        errors.append("supported_flows differ from approved connector rollout")
    if data.get("unsupported_flows") != [
        "manual_capture",
        "void",
        "refund",
        "saved_card",
        "recurring_payment",
        "payout",
    ]:
        errors.append("unsupported_flows differ from approved connector rollout")
    return errors


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) == 2 else Path(
        "deployment/coolify/production/connectors/desired-state.json"
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
    print("connector rollout manifest valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
