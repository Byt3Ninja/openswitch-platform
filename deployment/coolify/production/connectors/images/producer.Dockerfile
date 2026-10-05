FROM docker.juspay.io/juspaydotin/hyperswitch-producer@sha256:be3ec8af9648c278c8ab7331234e6e4b15318197ce098e052e60b3b5694dcd2c
USER root
COPY --chown=app:app scheduler /local/bin/scheduler
RUN chmod 0755 /local/bin/scheduler
USER app:app
