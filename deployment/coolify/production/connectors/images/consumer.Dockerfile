FROM docker.juspay.io/juspaydotin/hyperswitch-consumer@sha256:9c5059fd42d624393aa750c40a79dc9e7022d5bfb466be6534c977ba108f6468
USER root
COPY --chown=app:app scheduler /local/bin/scheduler
RUN chmod 0755 /local/bin/scheduler
USER app:app
