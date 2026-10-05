FROM docker.juspay.io/juspaydotin/hyperswitch-control-center@sha256:388568f1f9081eefb1b75df2e8d366daf275ccafc8148a317e3104ef8cc1a85f

# Build the patched v1.38.8 Control Center first. Keep the official runtime,
# server command, user, and mounted OpenSwitch configuration intact.
COPY --chown=appuser:appgroup dist/ /usr/src/app/dist/
