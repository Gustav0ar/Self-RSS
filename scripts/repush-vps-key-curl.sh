#!/usr/bin/env bash
# Re-push the deploy user's private key to the GitHub repo's
# production-environment secret, using only curl + python3.
#
# Run as root on the VPS. No `gh` required.
#
# Requires:
#   - python3 with PyNaCl (pip install pynacl) — preferred
#     OR
#   - python3 with the system libsodium shared library
#   - A GitHub token in $GITHUB_TOKEN with the 'repo' scope
#     (or a fine-grained token with Actions: read+write on this repo)

set -euo pipefail

REPO="${REPO:-Gustav0ar/Self-RSS}"
DEPLOY_USER="${1:-selffeed-deploy}"
ENV_NAME="production"
SECRET_NAME="VPS_SSH_KEY"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: set GITHUB_TOKEN in the environment first." >&2
  echo "       (Use a PAT with 'repo' scope, or a fine-grained token with" >&2
  echo "        Actions: read+write on ${REPO}.)" >&2
  exit 1
fi

PRIV_KEY="/var/lib/${DEPLOY_USER}/.ssh/id_ed25519"
if [ ! -f "${PRIV_KEY}" ]; then
  echo "ERROR: ${PRIV_KEY} not found." >&2
  exit 1
fi
if ! head -1 "${PRIV_KEY}" | grep -q "PRIVATE KEY"; then
  echo "ERROR: ${PRIV_KEY} does not look like a private key." >&2
  exit 1
fi

echo ">> Server key fingerprint:"
ssh-keygen -l -f "${PRIV_KEY}"
echo

# 1. Fetch the repo's public key for secret encryption.
echo ">> Fetching repo public key from GitHub..."
PUBKEY_JSON=$(curl -fsSL \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/actions/secrets/public-key")

# 2. Encrypt the private key bytes using libsodium sealed box, then base64.
echo ">> Encrypting..."
ENCRYPTED_B64=$(PRIV_KEY_FILE="${PRIV_KEY}" PUBKEY_JSON="${PUBKEY_JSON}" python3 <<'PY'
import base64
import ctypes
import ctypes.util
import json
import os

priv = open(os.environ["PRIV_KEY_FILE"], "rb").read()
pk_obj = json.loads(os.environ["PUBKEY_JSON"])
pub = base64.b64decode(pk_obj["key"])

# Try PyNaCl first (cleanest path).
try:
    import nacl.public
    sealed = nacl.public.SealedBox(nacl.public.PublicKey(pub))
    print(base64.b64encode(sealed.encrypt(priv)).decode("ascii"))
    raise SystemExit(0)
except ImportError:
    pass

# Fall back to libsodium via ctypes.
soname = ctypes.util.find_library("sodium")
if not soname:
    for cand in ("libsodium.so.23", "libsodium.so", "libsodium-23.dll", "sodium.dll"):
        try:
            ctypes.cdll.LoadLibrary(cand)
            soname = cand
            break
        except OSError:
            continue
    if not soname:
        raise SystemExit(
            "ERROR: install PyNaCl on the VPS:  pip3 install pynacl\n"
            "       (or apt install libsodium23 if you have no pip)"
        )

lib = ctypes.cdll.LoadLibrary(soname)
lib.crypto_box_seal.argtypes = [
    ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulonglong, ctypes.c_char_p
]
lib.crypto_box_seal.restype = ctypes.c_int

ct = ctypes.create_string_buffer(len(priv) + 48)
rc = lib.crypto_box_seal(ct, priv, len(priv), pub)
if rc != 0:
    raise SystemExit(f"crypto_box_seal failed: rc={rc}")

print(base64.b64encode(ct.raw[: len(priv) + 48]).decode("ascii"))
PY
)

# 3. Build the JSON body and PUT it.
KEY_ID=$(echo "${PUBKEY_JSON}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["key_id"])')
BODY=$(ENCRYPTED_B64="${ENCRYPTED_B64}" KEY_ID="${KEY_ID}" python3 -c '
import json, os
print(json.dumps({
    "encrypted_value": os.environ["ENCRYPTED_B64"],
    "key_id": os.environ["KEY_ID"],
}))')

echo ">> Uploading to https://api.github.com/repos/${REPO}/environments/${ENV_NAME}/secrets/${SECRET_NAME} ..."
HTTP_CODE=$(curl -fsSL -o /tmp/gh-resp.json -w "%{http_code}" \
  -X PUT \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d "${BODY}" \
  "https://api.github.com/repos/${REPO}/environments/${ENV_NAME}/secrets/${SECRET_NAME}" \
  || echo "000")

if [ "${HTTP_CODE}" = "201" ] || [ "${HTTP_CODE}" = "204" ]; then
  echo
  echo "OK — ${SECRET_NAME} updated in ${REPO} (environment=${ENV_NAME})."
  echo "Re-run the Deploy workflow from the Actions tab."
else
  echo "FAILED (HTTP ${HTTP_CODE}):"
  cat /tmp/gh-resp.json 2>/dev/null || true
  exit 1
fi
