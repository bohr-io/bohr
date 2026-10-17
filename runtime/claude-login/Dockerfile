# syntax=docker/dockerfile:1
# The bohr sign-in image: the official Claude Code CLI and a small server that runs `claude setup-token` to
# connect a Claude subscription (the instance's ClaudeLoginContainer). Build it from the repository root, after
# building the server:
#   pnpm --filter @bohr/claude-login build
#   docker build --platform linux/amd64 -f runtime/claude-login/Dockerfile -t bohr-claude-login .
# Docker reads runtime/claude-login/Dockerfile.dockerignore, so only the files copied below leave the build context.

# The agent image's base, so the two share layers
FROM node:24-trixie-slim

# bsdutils has util-linux `script`, the pseudo-terminal `claude setup-token` needs; tini reaps the CLI's processes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini bsdutils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/bohr
# Only the CLI's native binary is installed (the Agent SDK's platform package, at the version the agent pins);
# everything else is bundled into server.mjs. No secrets: the container only relays the sign-in.
COPY runtime/claude-login/dist/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY runtime/claude-login/dist/server.mjs runtime/claude-login/dist/THIRD_PARTY_LICENSES.txt ./

ENV NODE_ENV=production
EXPOSE 4840
# Runs as root: the container is the isolation boundary. Only the server listens.
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/bohr/server.mjs"]
