FROM docker:27.5.1-cli AS dockercli
FROM alpine/helm:3.17.3 AS helmcli
FROM jenkins/inbound-agent:jdk21
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git curl jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=helmcli /usr/bin/helm /usr/local/bin/helm
USER jenkins
