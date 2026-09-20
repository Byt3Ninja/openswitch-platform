# Connector ownership registry

Do not copy custom connector source into the platform repository. For each connector, record its authoritative repository, compatible Hyperswitch commit, supported flows, test evidence, and deployment dependency before enabling it.

| Connector | Current state | Authoritative implementation repository | Compatibility |
| --- | --- | --- | --- |
| Kashier | Uncommitted work exists in the original OpenSwitch checkout; not present in the pinned upstream submodule | Not established; decide in a separate connector task | Not verified for the platform repository |

Kashier's in-progress tests and documentation in the original checkout are not production approval. Any shared Hyperswitch enum/router change needs its own upstream-impact review and any required Category E authorization.
