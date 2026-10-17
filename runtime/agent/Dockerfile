# syntax=docker/dockerfile:1
# The bohr agent runner image. Build it from the repository root, after building the runner:
#   pnpm --filter @bohr/agent build
#   docker build --platform linux/amd64 -f runtime/agent/Dockerfile -t bohr-agent .
# Docker reads runtime/agent/Dockerfile.dockerignore, so only the files copied below leave the build context.

FROM docker.io/cloudflare/sandbox:1.0.0 AS sandbox

FROM node:24-trixie-slim

# Tools the agent and typical dev servers expect; tini reaps the processes the agent leaves behind; bsdutils has
# util-linux `script`, the pseudo-terminal `claude setup-token` needs to connect the owner's Claude subscription.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl bash ripgrep python3 make g++ procps tini bsdutils \
  && rm -rf /var/lib/apt/lists/*

# The Sandbox SDK's file helper. The runner does not use it; the project Worker's SDK can.
COPY --from=sandbox /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

WORKDIR /opt/bohr
# Only the Claude Agent SDK is installed here (everything else is bundled into runner.mjs); npm picks the
# SDK's native binary for this platform, an optional dependency.
COPY runtime/agent/dist/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY runtime/agent/dist/runner.mjs runtime/agent/dist/THIRD_PARTY_LICENSES.txt ./
COPY runtime/agent/entrypoint.sh ./entrypoint.sh
RUN sed -i 's/\r$//' entrypoint.sh && chmod 755 entrypoint.sh

ENV IS_SANDBOX=1 \
    NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt
WORKDIR /workspace
EXPOSE 4840 4841
# Runs as root: the container is the isolation boundary.
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/bohr/entrypoint.sh"]
