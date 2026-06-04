#!/usr/bin/env bash
# Diagnose why the SelfFeed deploy key isn't being accepted.
# Run as root on the VPS.

set -e

DEPLOY_USER="${1:-selffeed-deploy}"
echo "=== Checking ${DEPLOY_USER} ==="
id "${DEPLOY_USER}" || { echo "USER MISSING"; exit 1; }
getent passwd "${DEPLOY_USER}" || true

echo
echo "=== Home and SSH directory permissions ==="
ls -ld "/var/lib/${DEPLOY_USER}" 2>&1 || true
ls -ld "/var/lib/${DEPLOY_USER}/.ssh" 2>&1 || true

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
  if ! awk '{ for (i=1;i<=NF;i++) if ($i ~ /^command=/) { print $i; found=1; break } } END { exit found ? 0 : 1 }' "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"; then
    echo "No forced-command entries found."
  fi
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
  echo "Private key fingerprint:"
  ssh-keygen -l -f "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519"
  echo
  echo "Running: ssh -i /var/lib/${DEPLOY_USER}/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -v ${DEPLOY_USER}@localhost true"
  ssh -i "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519" \
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    -o BatchMode=yes -o ConnectTimeout=5 -v "${DEPLOY_USER}@localhost" true 2>&1 | head -80 || true
else
  echo "No key at /var/lib/${DEPLOY_USER}/.ssh/id_ed25519"
fi
