#!/usr/bin/env bash
# Diagnose why the SelfFeed deploy key isn't being accepted.
# Run as root on the VPS.

set -e

DEPLOY_USER="${1:-selffeed-deploy}"
echo "=== Checking ${DEPLOY_USER} ==="
id "${DEPLOY_USER}" || { echo "USER MISSING"; exit 1; }

echo
echo "=== Authorized keys (one per line) ==="
if [ -f "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys" ]; then
  echo "Path: /var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
  echo "Permissions:"
  ls -la "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
  echo
  echo "Fingerprints:"
  ssh-keygen -l -f "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
  echo
  echo "Command= field on each key:"
  awk '{ for (i=1;i<=NF;i++) if ($i ~ /^command=/) { print $i; break } }' "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
  echo
  echo "Wrapper path:"
  ls -la /usr/local/bin/selffeed-deploy-wrapper 2>&1 || echo "MISSING"
else
  echo "FILE MISSING"
fi

echo
echo "=== /etc/ssh/sshd_config relevant lines ==="
grep -E "^(AuthorizedKeysFile|PubkeyAuthentication|PasswordAuthentication|PermitRootLogin|UsePAM)" /etc/ssh/sshd_config || true

echo
echo "=== sshd -T (effective config) ==="
sshd -T 2>/dev/null | grep -iE "(authorizedkeysfile|pubkeyauthentication|passwordauthentication|permitorderedkeytypes|pubkeyacceptedalgorithms)" || true

echo
echo "=== Try authenticating with the server's own key locally ==="
# This proves the key + user combination is valid from a local SSH client.
if [ -f "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519" ]; then
  echo "Running: ssh -i /var/lib/${DEPLOY_USER}/.ssh/id_ed25519 -o IdentitiesOnly=yes -v ${DEPLOY_USER}@localhost true"
  sudo -u "${DEPLOY_USER}" ssh -i "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519" \
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=5 -v "${DEPLOY_USER}@localhost" true 2>&1 | head -40 || true
else
  echo "No key at /var/lib/${DEPLOY_USER}/.ssh/id_ed25519"
fi
