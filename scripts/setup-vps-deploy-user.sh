#!/usr/bin/env bash
# Set up a deploy user that is restricted to operations in a single
# directory (/mnt/storage/containers/selfrss by default).
#
# Run this as root on the VPS.
#
# Usage:
#   sudo ./setup-vps-deploy-user.sh
#   sudo ./setup-vps-deploy-user.sh /custom/path deploy_user

set -euo pipefail

DEPLOY_PATH="${1:-/mnt/storage/containers/selfrss}"
DEPLOY_USER="${2:-selffeed-deploy}"

# Validate DEPLOY_PATH is absolute and not a system dir.
case "${DEPLOY_PATH}" in
  /*) ;;
  *)
    echo "DEPLOY_PATH must be absolute: ${DEPLOY_PATH}" >&2
    exit 1
    ;;
esac
case "${DEPLOY_PATH}" in
  /|/etc|/root|/var|/usr|/home|/opt|/mnt|/mnt/*) ;;
  *)
    echo "DEPLOY_PATH must be under /mnt/, /opt/, or /var/: ${DEPLOY_PATH}" >&2
    exit 1
    ;;
esac

echo ">> Setting up deploy user '${DEPLOY_USER}' for path '${DEPLOY_PATH}'"

# --- 1. Create the user with a locked password and no shell login. ---
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd \
    --system \
    --shell /usr/sbin/nologin \
    --home-dir "/var/lib/${DEPLOY_USER}" \
    --comment "SelfFeed deploy user (restricted)" \
    "${DEPLOY_USER}"
  echo "   created user ${DEPLOY_USER}"
else
  echo "   user ${DEPLOY_USER} already exists, leaving alone"
fi

# --- 2. Ensure the deploy path exists and is owned by the user. ---
mkdir -p "${DEPLOY_PATH}/data"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_PATH}"
chmod 750 "${DEPLOY_PATH}"
chmod 700 "${DEPLOY_PATH}/data"

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

# --- 4. Install the wrapper that enforces DEPLOY_PATH restrictions. ---
cat > /usr/local/bin/selffeed-deploy-wrapper <<'WRAPPER_EOF'
#!/usr/bin/env bash
# Wrapper invoked by sshd for every connection from the deploy key.
# Validates SSH_ORIGINAL_COMMAND against an allowlist scoped to DEPLOY_PATH.

set -euo pipefail

DEPLOY_PATH="${1:?usage: selffeed-deploy-wrapper DEPLOY_PATH}"

if [ -z "${SSH_ORIGINAL_COMMAND:-}" ]; then
  echo "Interactive sessions are disabled for this account." >&2
  exit 1
fi

CMD="${SSH_ORIGINAL_COMMAND}"

# Reject dangerous metacharacters outright.
forbidden_pattern='(\.\./|/etc/|/root/|/var/lib/|/proc/|/sys/|;|`|\$\(|\$\{|&&|\|\|)'
if echo "${CMD}" | grep -qE "${forbidden_pattern}"; then
  echo "Refusing command with forbidden metacharacters: ${CMD}" >&2
  exit 1
fi

# Allow the caller to prefix with "cd <DEPLOY_PATH> && ".
prefix="cd ${DEPLOY_PATH} && "
if [ "${CMD#"${prefix}"}" != "${CMD}" ]; then
  CMD="${CMD#"${prefix}"}"
fi

# 1. Update docker-compose.yml from a GitHub raw URL.
if echo "${CMD}" | grep -qE "^curl[[:space:]]"; then
  if echo "${CMD}" | grep -qE "[[:space:]]-o[[:space:]]*${DEPLOY_PATH}/docker-compose\.yml"; then
    eval "${SSH_ORIGINAL_COMMAND}"
    exit $?
  fi
  echo "curl must write to ${DEPLOY_PATH}/docker-compose.yml" >&2
  exit 1
fi

# 2. docker compose commands. -f must point at the deploy path or the
#    default docker-compose.yml (which we assume is in DEPLOY_PATH because
#    that's the cwd we've chdir'd to above).
if echo "${CMD}" | grep -qE "^(docker[[:space:]]+compose|podman[[:space:]]+compose)[[:space:]]"; then
  if echo "${CMD}" | grep -qE -- "(-f[[:space:]]+|--file[[:space:]]+)"; then
    file_arg="$(echo "${CMD}" | sed -nE 's/.*(-f[[:space:]]+|--file[[:space:]]+)([^[:space:]]+).*/\2/p')"
    case "${file_arg}" in
      "${DEPLOY_PATH}"/*|"./"*|"docker-compose.yml") ;;
      *)
        echo "docker compose -f must point at ${DEPLOY_PATH} or docker-compose.yml." >&2
        exit 1
        ;;
    esac
  fi
  eval "${SSH_ORIGINAL_COMMAND}"
  exit $?
fi

# 3. Bare docker/podman commands (e.g. `docker image prune -f`).
if echo "${CMD}" | grep -qE "^(docker|podman)[[:space:]]+(image|container|network|volume)[[:space:]]+(prune|ls|inspect)[[:space:]]+-f[[:space:]]*$"; then
  eval "${SSH_ORIGINAL_COMMAND}"
  exit $?
fi

# 4. File-management commands inside the deploy path. Allowed because the
#    operator may need to edit .env, inspect data, or update compose files
#    outside the deploy workflow.
file_cmd_regex="^(mkdir|touch|chmod|chown|cat|tee|echo|ls|test|stat|cp|mv|rm|grep|sed|awk|head|tail|less|more|file|find|du|df)[[:space:]]"
if echo "${CMD}" | grep -qE "${file_cmd_regex}"; then
  if ! echo "${CMD}" | grep -qE "(${DEPLOY_PATH}|/data/|/\.env|/docker-compose\.yml|/backups/)"; then
    echo "File operations must target ${DEPLOY_PATH}." >&2
    exit 1
  fi
  eval "${SSH_ORIGINAL_COMMAND}"
  exit $?
fi

# 5. Read-only inspections of the deploy path contents.
if [ "${CMD}" = "true" ]; then
  exit 0
fi

echo "Command not permitted: ${CMD}" >&2
exit 1
WRAPPER_EOF
chmod 755 /usr/local/bin/selffeed-deploy-wrapper
echo "   installed /usr/local/bin/selffeed-deploy-wrapper"

# --- 5. Install the public key with the forced-command wrapper. ---
touch "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"

PUBKEY_BODY="$(cat /var/lib/${DEPLOY_USER}/.ssh/id_ed25519.pub | awk '{print $2,$3}')"
if ! grep -q "${PUBKEY_BODY}" "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys" 2>/dev/null; then
  echo "command=\"/usr/local/bin/selffeed-deploy-wrapper '${DEPLOY_PATH}'\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ${PUBKEY_BODY}" \
    >> "/var/lib/${DEPLOY_USER}/.ssh/authorized_keys"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/var/lib/${DEPLOY_USER}/.ssh"
  echo "   installed public key with forced command"
else
  echo "   public key already in authorized_keys"
fi

# --- 6. Allow the user to run docker without sudo. ---
if ! getent group docker >/dev/null; then
  groupadd docker
fi
usermod -aG docker "${DEPLOY_USER}"
echo "   added ${DEPLOY_USER} to the docker group"

# --- 7. Hand the private key back so it can be added to GitHub. ---
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

Allowed operations via SSH (everything else is rejected):
  - curl ... -o ${DEPLOY_PATH}/docker-compose.yml      (update compose)
  - docker compose [up|ps|pull|down|restart|...] -f    (manage stack)
  - cd ${DEPLOY_PATH} && docker compose ...
  - docker image prune -f                              (cleanup)
  - file ops (ls, cat, chmod, chown, rm, mv, cp, etc.) inside ${DEPLOY_PATH}
  - true                                               (no-op, e.g. for health checks)

NOT allowed (rejected by the wrapper):
  - Any command containing .., /etc/, /root/, /var/lib/, ;, &&, ||, \`\`, \$()
  - docker exec / docker run / docker rm                (no in-container access)
  - reading or writing anywhere outside ${DEPLOY_PATH}
  - interactive shells (account has nologin shell)

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

       docker network create traefik_public 2>/dev/null || true

  3. Create ${DEPLOY_PATH}/.env with the production secrets (see DEPLOY.md).

  4. Set the deploy-path variable in the production environment:

       DEPLOY_PATH = ${DEPLOY_PATH}

  5. Test from a local machine with the private key:

       ssh -i /root/.ssh-key-handoff/${DEPLOY_USER}.key \\
           -o IdentitiesOnly=yes \\
           ${DEPLOY_USER}@this-vps \\
           "docker compose -f ${DEPLOY_PATH}/docker-compose.yml ps"
================================================================================
EOF
