#!/usr/bin/env bash
# Set up a dedicated deploy user for the GitHub Actions deploy workflow.
#
# Run this as root on the VPS.
#
# Usage:
#   sudo ./setup-vps-deploy-user.sh
#   sudo ./setup-vps-deploy-user.sh /custom/path deploy_user

set -euo pipefail

DEPLOY_PATH="${1:-/mnt/storage/containers/selfrss}"
DEPLOY_USER="${2:-selffeed-deploy}"

# Validate DEPLOY_PATH is an app directory, not a system root.
case "${DEPLOY_PATH}" in
  /mnt/*|/opt/*|/var/*) ;;
  *)
    echo "DEPLOY_PATH must be under /mnt/, /opt/, or /var/: ${DEPLOY_PATH}" >&2
    exit 1
    ;;
esac

echo ">> Setting up deploy user '${DEPLOY_USER}' for path '${DEPLOY_PATH}'"

# --- 1. Create the user with a locked password and a non-interactive purpose. ---
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd \
    --system \
    --shell /bin/bash \
    --home-dir "/var/lib/${DEPLOY_USER}" \
    --comment "SelfFeed deploy user (restricted)" \
    "${DEPLOY_USER}"
  echo "   created user ${DEPLOY_USER}"
else
  usermod \
    --home "/var/lib/${DEPLOY_USER}" \
    --shell /bin/bash \
    "${DEPLOY_USER}"
  echo "   user ${DEPLOY_USER} already exists, ensured home and shell"
fi

mkdir -p "/var/lib/${DEPLOY_USER}"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "/var/lib/${DEPLOY_USER}"
chmod 750 "/var/lib/${DEPLOY_USER}"

# --- 2. Ensure the deploy path exists and is owned by the user. ---
mkdir -p "${DEPLOY_PATH}/data"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_PATH}"
chmod 750 "${DEPLOY_PATH}"
chmod 777 "${DEPLOY_PATH}/data"

# --- 3. Generate a dedicated SSH key for GitHub Actions. ---
install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
  "/var/lib/${DEPLOY_USER}/.ssh"

if [ ! -f "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519" ]; then
  sudo -u "${DEPLOY_USER}" ssh-keygen \
    -t ed25519 \
    -N "" \
    -C "${DEPLOY_USER}@$(hostname)" \
    -f "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519"
  echo "   generated SSH keypair"
else
  echo "   SSH keypair already exists, skipping"
fi

# --- 4. Install the public key used by GitHub Actions. ---
AUTHORIZED_KEYS="/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
touch "${AUTHORIZED_KEYS}"
chmod 600 "${AUTHORIZED_KEYS}"

PUBKEY="$(cat "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519.pub")"
PUBKEY_BODY="$(printf '%s' "${PUBKEY}" | awk '{print $2}')"
TMP_AUTHORIZED_KEYS="$(mktemp)"
grep -vF "${PUBKEY_BODY}" "${AUTHORIZED_KEYS}" > "${TMP_AUTHORIZED_KEYS}" || true
cat "${TMP_AUTHORIZED_KEYS}" > "${AUTHORIZED_KEYS}"
rm -f "${TMP_AUTHORIZED_KEYS}"
printf '%s\n' "${PUBKEY}" >> "${AUTHORIZED_KEYS}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/var/lib/${DEPLOY_USER}/.ssh"
chmod 700 "/var/lib/${DEPLOY_USER}/.ssh"
chmod 600 "${AUTHORIZED_KEYS}"
echo "   installed public key in authorized_keys"

# --- 5. Allow the user to run docker without sudo. ---
if ! getent group docker >/dev/null; then
  groupadd docker
fi
usermod -aG docker "${DEPLOY_USER}"
echo "   added ${DEPLOY_USER} to the docker group"

# --- 6. Hand the private key back so it can be added to GitHub. ---
install -d -m 0700 /root/.ssh-key-handoff
cp "/var/lib/${DEPLOY_USER}/.ssh/id_ed25519" "/root/.ssh-key-handoff/${DEPLOY_USER}.key"
chmod 600 "/root/.ssh-key-handoff/${DEPLOY_USER}.key"
chown root:root "/root/.ssh-key-handoff/${DEPLOY_USER}.key"

cat <<EOF

================================================================================
  Setup complete
================================================================================

  Deploy user : ${DEPLOY_USER}
  Deploy path : ${DEPLOY_PATH}
  SSH key     : /root/.ssh-key-handoff/${DEPLOY_USER}.key

Next steps:

  1. Copy the private key for the GitHub secret:

       cat /root/.ssh-key-handoff/${DEPLOY_USER}.key

     Paste as VPS_SSH_KEY in
     Repo > Settings > Environments > production > Secrets.

     Also set:
       VPS_HOST        = <this VPS IP or hostname>
       VPS_USERNAME    = ${DEPLOY_USER}
       VPS_PORT        = 22

  2. Create the Traefik network if it doesn't exist:

       docker network create web 2>/dev/null || true

  3. Create ${DEPLOY_PATH}/.env with the production secrets (see DEPLOY.md).

  4. Set the deploy-path variable in the production environment:

       DEPLOY_PATH = ${DEPLOY_PATH}

  5. Test from a local machine with the private key:

       ssh -i /root/.ssh-key-handoff/${DEPLOY_USER}.key \\
           -o IdentitiesOnly=yes \\
           ${DEPLOY_USER}@this-vps \\
           true
================================================================================
EOF
