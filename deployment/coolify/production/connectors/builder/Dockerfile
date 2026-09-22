# Immutable linux/amd64 official images; Debian bookworm ABI baseline.
FROM docker.io/library/node@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS node
FROM docker.io/library/rust@sha256:0ff31c9ffa641a62e48d543fb00b4960955ea375f40776f40f585b89e654cc5e

# A dated signed archive fixes native-library/compiler package resolution.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20250320T000000Z bookworm main' > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev libssl-dev libprotobuf-dev protobuf-compiler pkg-config file \
    && rm -rf /var/lib/apt/lists/*
RUN rustup component add --toolchain 1.85.0 rustfmt clippy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && rustc --version && node --version && npm --version
COPY compile-release.sh /usr/local/bin/compile-release
ENV CARGO_INCREMENTAL=0
# Fixed resource policy is part of the immutable builder identity.
ENV CARGO_BUILD_JOBS=1
ENV CARGO_PROFILE_TEST_DEBUG=0
ENV CARGO_PROFILE_DEV_DEBUG=0
WORKDIR /build
ENTRYPOINT ["/bin/sh", "/usr/local/bin/compile-release"]
