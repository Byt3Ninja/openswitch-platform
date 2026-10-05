FROM docker.juspay.io/juspaydotin/hyperswitch-router@sha256:3d4a381b9de532dff2b9d71abd503273ee9efd58675b0f4cca6570889d11d4ed
USER root
COPY --chown=app:app router /local/bin/router
RUN chmod 0755 /local/bin/router
USER app:app
