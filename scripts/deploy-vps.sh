#!/usr/bin/env bash
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/self-feed}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"
REGISTRY="${REGISTRY:-ghcr.io}"
HEAD_SHA="${HEAD_SHA:?HEAD_SHA is required}"
HEAD_SHA_SHORT="$(printf '%s' "${HEAD_SHA}" | cut -c1-7)"
IMAGE_OWNER="${IMAGE_OWNER:?IMAGE_OWNER is required}"
IMAGE_TAG="${IMAGE_TAG:-sha-${HEAD_SHA_SHORT}}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

read -r -a COMPOSE_ARGS <<< "${COMPOSE_CMD}"
if [ "${#COMPOSE_ARGS[@]}" -eq 0 ]; then
	echo "COMPOSE_COMMAND is empty"
	exit 1
fi
if ! command -v "${COMPOSE_ARGS[0]}" >/dev/null 2>&1; then
	echo "Container CLI not found: ${COMPOSE_ARGS[0]}"
	exit 1
fi
CONTAINER_CLI="${COMPOSE_ARGS[0]}"
if [ "${CONTAINER_CLI}" = "docker-compose" ]; then
	CONTAINER_CLI="docker"
fi

echo "::group::Deploy self-feed"
echo "Target path : ${DEPLOY_PATH}"
echo "Compose     : ${COMPOSE_CMD}"
echo "Image       : ${REGISTRY}/${IMAGE_OWNER}/self-feed-api:${IMAGE_TAG}"
echo "::endgroup::"

mkdir -p "${DEPLOY_PATH}"
cd "${DEPLOY_PATH}"

dump_compose_diagnostics() {
	echo "::group::Compose diagnostics"
	"${COMPOSE_ARGS[@]}" -f docker-compose.yml ps || true
	"${COMPOSE_ARGS[@]}" -f docker-compose.yml logs --no-color --tail=120 api redis worker web || true
	echo "::endgroup::"
}

fail_with_diagnostics() {
	dump_compose_diagnostics
	exit 1
}

wait_for_container_health() {
	container="$1"
	label="$2"
	for _ in $(seq 1 30); do
		status="$("${CONTAINER_CLI}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
		if [ "${status}" = "healthy" ] || [ "${status}" = "running" ]; then
			echo "${label} healthy"
			return 0
		fi
		if [ "${status}" = "unhealthy" ] || [ "${status}" = "exited" ] || [ "${status}" = "dead" ]; then
			echo "${label} failed with container status: ${status}"
			return 1
		fi
		sleep 2
	done
	echo "${label} did not become healthy in time"
	return 1
}

upsert_env_var() {
	key="$1"
	value="$2"
	tmp_file="$(mktemp)"
	grep -v -E "^${key}=" .env > "${tmp_file}" || true
	printf '%s=%s\n' "${key}" "${value}" >> "${tmp_file}"
	cat "${tmp_file}" > .env
	rm -f "${tmp_file}"
}

read_env_var() {
	key="$1"
	grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true
}

normalize_domain_name() {
	raw_domain="$(read_env_var DOMAIN_NAME)"
	normalized_domain="$(printf '%s' "${raw_domain}" \
		| sed -E 's#^[[:alpha:]][[:alnum:]+.-]*://##; s#/.*$##; s#:[0-9]+$##' \
		| tr '[:upper:]' '[:lower:]')"

	if [ -z "${normalized_domain}" ]; then
		echo "DOMAIN_NAME is missing in ${DEPLOY_PATH}/.env. Set it to the bare host, for example rss.example.com."
		exit 1
	fi

	if [ "${raw_domain}" != "${normalized_domain}" ]; then
		echo "Normalizing DOMAIN_NAME from '${raw_domain}' to '${normalized_domain}' for Traefik Host matching."
		upsert_env_var DOMAIN_NAME "${normalized_domain}"
	fi
}

backup_existing_database() {
	db_file="data/self-feed.db"
	if [ ! -f "${db_file}" ]; then
		echo "No existing SQLite database found; skipping pre-deploy backup."
		return 0
	fi

	mkdir -p data/backups
	chmod 777 data/backups

	timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
	backup_name="self-feed-${timestamp}-${HEAD_SHA_SHORT}.db"
	backup_path="data/backups/${backup_name}"
	running="$("${CONTAINER_CLI}" inspect -f '{{.State.Running}}' selffeed-api 2>/dev/null || true)"

	if [ "${running}" = "true" ]; then
		echo "Creating SQLite pre-deploy backup with VACUUM INTO: ${backup_path}"
		"${CONTAINER_CLI}" exec selffeed-api bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/app/data/self-feed.db'); db.exec(\"VACUUM INTO '/app/data/backups/${backup_name}'\"); db.close();"
		"${CONTAINER_CLI}" exec selffeed-api chmod 600 "/app/data/backups/${backup_name}"
	else
		echo "API container is not running; copying SQLite files for pre-deploy backup: ${backup_path}"
		cp "${db_file}" "${backup_path}"
		if [ -f "${db_file}-wal" ]; then
			cp "${db_file}-wal" "${backup_path}-wal"
		fi
		if [ -f "${db_file}-shm" ]; then
			cp "${db_file}-shm" "${backup_path}-shm"
		fi
		chmod 600 "${backup_path}"*
	fi

	find data/backups -maxdepth 1 -type f -name 'self-feed-*.db' | sort | head -n -10 | while read -r old_backup; do
		rm -f "${old_backup}" "${old_backup}-wal" "${old_backup}-shm"
	done
}

# Ensure the data dir exists for the SQLite volume.
mkdir -p data
chmod 777 data

curl_headers=(-H "Accept: application/vnd.github.raw")
if [ -n "${GITHUB_TOKEN}" ]; then
	curl_headers+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

# Pull the deploy file from the repo so the VPS doesn't need to be a
# separate git checkout.
curl -fsSL \
	"${curl_headers[@]}" \
	-o docker-compose.yml \
	"https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${HEAD_SHA}/docker-compose.yml"

if [ ! -f .env ]; then
	echo ".env is missing in ${DEPLOY_PATH}; create it with the production secrets before deploying."
	exit 1
fi
normalize_domain_name

# Persist non-secret image metadata so manual commands like
# `docker compose logs` work on the VPS after deployment.
upsert_env_var REGISTRY "${REGISTRY}"
upsert_env_var IMAGE_OWNER_LOWERCASE "${IMAGE_OWNER}"
upsert_env_var IMAGE_TAG "${IMAGE_TAG}"

export IMAGE_TAG
export IMAGE_OWNER_LOWERCASE="${IMAGE_OWNER}"
export REGISTRY

backup_existing_database

# Pull images, restart services, prune.
"${COMPOSE_ARGS[@]}" -f docker-compose.yml pull || fail_with_diagnostics
"${COMPOSE_ARGS[@]}" -f docker-compose.yml up -d --remove-orphans || fail_with_diagnostics

wait_for_container_health selffeed-redis Redis || fail_with_diagnostics
wait_for_container_health selffeed-api API || fail_with_diagnostics
wait_for_container_health selffeed-web Web || fail_with_diagnostics
wait_for_container_health selffeed-worker Worker || fail_with_diagnostics

"${CONTAINER_CLI}" image prune -f
