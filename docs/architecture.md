# OpenSwitch platform boundaries

OpenSwitch-platform is the outer orchestration repository. The hyperswitch/ gitlink pins official Hyperswitch commit 568a91925fc7ae1948838e105afdd98210cb3152. Router, connectors, scheduler, drainer, migrations, and upstream configuration remain in the child repository. Update the gitlink only after release-note, migration, config, connector, test, staging, and rollback review; do not copy child files into the outer repository.

The outer repository can own deployment definitions, safe environment overlays, connector registry metadata, adapter references, and operational docs as actual requirements arise. The Coolify directories currently document staging and production separation; they are not live manifests. A customer-specific adapter should call supported Hyperswitch APIs rather than change generic payment logic. Connector code belongs in its authoritative repository; shared Hyperswitch integration changes need independent upstream-impact classification and possibly Category E approval.

The existing sibling OpenSwitch checkout has uncommitted Kashier code and shared registration edits. It is not the child submodule source. Its origin URL currently names the outer platform repository, so it must not be pushed there. Resolving Kashier ownership and any core approval is a separate task.
