#!/usr/bin/env bash
# Run on the VPS. Reads the deploy user's private key and pushes it
# straight to the GitHub repo's production-environment secret.
#
# Requires: gh CLI authenticated (run `gh auth login` first).

set -euo pipefail

REPO="${REPO:-Gustav0ar/Self-RSS}"
DEPLOY_USER="${1:-selffeed-deploy}"

PRIV_KEY="/var/lib/${DEPLOY_USER}/.ssh/id_ed25519"

if [ ! -f "${PRIV_KEY}" ]; then
  echo "ERROR: ${PRIV_KEY} not found." >&2
  exit 1
fi

# Sanity check it's actually a private key.
if ! head -1 "${PRIV_KEY}" | grep -q "PRIVATE KEY"; then
  echo "ERROR: ${PRIV_KEY} does not look like a private key." >&2
  exit 1
fi

# Get the public key fingerprint for verification.
echo "Server key fingerprint:"
ssh-keygen -l -f "${PRIV_KEY}"
echo

# Push the private key to GitHub. gh handles base64/encryption correctly.
gh secret set VPS_SSH_KEY \
  --repo "${REPO}" \
  --env production \
  < "${PRIV_KEY}"

echo "OK — VPS_SSH_KEY updated on ${REPO} (production environment)."
echo
echo "Next: re-run the Deploy workflow from the Actions tab."
