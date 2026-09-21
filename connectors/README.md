# Connector ownership registry

Kashier and EasyKash are independent Git submodules. The platform repository tracks their commit pointers, not their source files. Both kits include integration patches for official Hyperswitch commit `568a91925fc7ae1948838e105afdd98210cb3152`; neither is a dynamically loaded plugin. Adding these submodules does not enable a connector in a Hyperswitch binary or change the separately managed production service.

| Connector | Authoritative repository | Pinned commit | Integration boundary |
| --- | --- | --- | --- |
| Kashier | [hyperswitch-kashier-connector](https://github.com/Byt3Ninja/hyperswitch-kashier-connector) | `10f0957a1d1cd9342bed25d41869c8c0a5a60c7f` | Patch targets the pinned upstream commit; the kit also documents later integration work. Its presence here is not deployment approval. |
| EasyKash | [hyperswitch-easykash-connector](https://github.com/Byt3Ninja/hyperswitch-easykash-connector) | `7e44e7335c7cc1716294bc1a862c47fb5921b796` | Patch targets the pinned upstream commit; not ported to Hyperswitch v1.126.0 or validated with a live EasyKash account. |

Do not copy connector source into the parent repository. Review each kit's own README, docs, tests, and patch before integration. Shared Hyperswitch enum, router, schema, or registration changes may require Category E approval. Do not apply both patches blindly: they touch overlapping upstream files and need a separate integration plan and tests.
