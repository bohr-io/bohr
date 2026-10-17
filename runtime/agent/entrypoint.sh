#!/bin/sh
# The project Worker intercepts HTTPS to api.anthropic.com and github.com to swap in real credentials, with a
# certificate from Cloudflare's CA. Node and the agent trust it through NODE_EXTRA_CA_CERTS; git and curl
# need it in the system store.
set -eu

ca=/etc/cloudflare/certs/cloudflare-containers-ca.crt
if [ -f "$ca" ]; then
  cp "$ca" /usr/local/share/ca-certificates/cloudflare-containers-ca.crt
  update-ca-certificates >/dev/null 2>&1 || echo "bohr: could not add the Cloudflare CA to the system store" >&2
fi

exec node /opt/bohr/runner.mjs
