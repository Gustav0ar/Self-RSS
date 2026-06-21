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
APP_UID="${APP_UID:-$(id -u)}"
APP_GID="${APP_GID:-$(id -g)}"

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

rollback_deploy() {
	echo "=========================================="
	echo "ROLLBACK: Initiating rollback to previous image"
	echo "=========================================="

	PREV_IMAGE="${REGISTRY}/${IMAGE_OWNER}/self-feed-api:previous"
	echo "[ROLLBACK] Pulling previous image: ${PREV_IMAGE}"
	if ! docker pull "${PREV_IMAGE}" 2>&1 | tee /dev/stderr; then
		echo "[ROLLBACK] ERROR: Failed to pull previous image"
		fail_with_diagnostics
	fi

	echo "[ROLLBACK] Tagging image for deployment"
	docker tag "${PREV_IMAGE}" "${REGISTRY}/${IMAGE_OWNER}/self-feed-api:${IMAGE_TAG}" || true

	echo "[ROLLBACK] Restarting containers with previous image"
	"${COMPOSE_ARGS[@]}" -f docker-compose.yml up -d --remove-orphans || {
		echo "[ROLLBACK] ERROR: Failed to restart containers"
		fail_with_diagnostics
	}

	echo "[ROLLBACK] Verifying container health after rollback"
	if wait_for_container_health selffeed-redis Redis; then
		if wait_for_container_health selffeed-api API; then
			if wait_for_container_health selffeed-web Web; then
				if wait_for_container_health selffeed-worker Worker; then
					echo "=========================================="
					echo "ROLLBACK: Completed successfully - services healthy"
					echo "=========================================="
					echo "[ROLLBACK] New deployment failed; previous version restored and healthy."
					exit 2  # Exit code 2 indicates rollback was performed
				fi
			fi
		fi
	fi

	echo "[ROLLBACK] ERROR: Health checks failed after rollback"
	fail_with_diagnostics
}

save_current_image() {
	echo "Saving current API image as :previous for potential rollback"
	current_api_image="$("${CONTAINER_CLI}" images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep "${IMAGE_OWNER}/self-feed-api" | grep -v ":previous" | grep -v ":${IMAGE_TAG}" | head -n 1 || true)"
	if [ -n "${current_api_image}" ]; then
		echo "[PRE-DEPLOY] Found current image: ${current_api_image}"
		docker tag "${current_api_image}" "${REGISTRY}/${IMAGE_OWNER}/self-feed-api:previous"
		echo "[PRE-DEPLOY] Tagged as :previous for rollback capability"
	else
		echo "[PRE-DEPLOY] No existing self-feed-api image found; creating placeholder"
		docker tag "${REGISTRY}/${IMAGE_OWNER}/self-feed-api:${IMAGE_TAG}" "${REGISTRY}/${IMAGE_OWNER}/self-feed-api:previous" 2>/dev/null || true
	fi
}

wait_for_container_health() {
	container="$1"
	label="$2"
	for _ in $(seq 1 30); do
		status="$("${CONTAINER_CLI}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck:{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
		if [ "${status}" = "healthy" ]; then
			echo "${label} healthy"
			return 0
		fi
		if [[ "${status}" == missing-healthcheck:* ]]; then
			echo "${label} has no container healthcheck: ${status#missing-healthcheck:}"
			return 1
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

curl_public_route() {
	domain="$1"
	path="$2"
	label="$3"
	url="https://${domain}${path}"
	attempts="${PUBLIC_ROUTE_RETRIES:-12}"
	delay_seconds="${PUBLIC_ROUTE_RETRY_DELAY_SECONDS:-5}"

	for attempt in $(seq 1 "${attempts}"); do
		if curl --fail --silent --max-time 15 \
			--resolve "${domain}:443:127.0.0.1" \
			-o /dev/null \
			"${url}"; then
			echo "${label} public route responded through local Traefik"
			return 0
		fi

		if curl --fail --silent --max-time 15 \
			-o /dev/null \
			"${url}"; then
			echo "${label} public route responded through DNS"
			return 0
		fi

		if [ "${attempt}" -lt "${attempts}" ]; then
			echo "${label} public route not ready yet; retrying in ${delay_seconds}s (${attempt}/${attempts})"
			sleep "${delay_seconds}"
		fi
	done

	echo "${label} public route did not respond after ${attempts} attempts"
	return 1
}

verify_public_routes() {
	domain="$(read_env_var DOMAIN_NAME)"
	if [ -z "${domain}" ]; then
		echo "[DEPLOY] DOMAIN_NAME is missing; cannot verify public routes"
		return 1
	fi

	curl_public_route "${domain}" "/health" "API health" &&
		curl_public_route "${domain}" "/" "Web root"
}

backup_existing_database() {
	db_file="data/self-feed.db"
	if [ ! -f "${db_file}" ]; then
		echo "No existing SQLite database found; skipping pre-deploy backup."
		return 0
	fi

	mkdir -p data/backups
	if ! chmod 750 data/backups 2>/dev/null; then
		echo "Warning: could not chmod data/backups before backup; continuing with existing permissions."
	fi

	timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
	backup_name="self-feed-${timestamp}-${HEAD_SHA_SHORT}.db"
	backup_path="data/backups/${backup_name}"
	api_status="$("${CONTAINER_CLI}" inspect -f '{{.State.Status}}' selffeed-api 2>/dev/null || true)"

	if [ "${api_status}" = "running" ]; then
		echo "Creating SQLite pre-deploy backup with VACUUM INTO: ${backup_path}"
		if "${CONTAINER_CLI}" exec --user 0:0 selffeed-api bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/app/data/self-feed.db'); db.exec(\"VACUUM INTO '/app/data/backups/${backup_name}'\"); db.close();" &&
			"${CONTAINER_CLI}" exec --user 0:0 selffeed-api chown "${APP_UID}:${APP_GID}" "/app/data/backups/${backup_name}" &&
			"${CONTAINER_CLI}" exec --user 0:0 selffeed-api chmod 600 "/app/data/backups/${backup_name}"; then
			find data/backups -maxdepth 1 -type f -name 'self-feed-*.db' | sort | head -n -10 | while read -r old_backup; do
				rm -f "${old_backup}" "${old_backup}-wal" "${old_backup}-shm"
			done
			return 0
		fi
		echo "Warning: container VACUUM backup failed; falling back to host-side SQLite file copy."
	else
		echo "API container status is '${api_status:-missing}'; copying SQLite files for pre-deploy backup: ${backup_path}"
	fi

	rm -f "${backup_path}" "${backup_path}-wal" "${backup_path}-shm"
	cp "${db_file}" "${backup_path}"
	if [ -f "${db_file}-wal" ]; then
		cp "${db_file}-wal" "${backup_path}-wal"
	fi
	if [ -f "${db_file}-shm" ]; then
		cp "${db_file}-shm" "${backup_path}-shm"
	fi
	chmod 600 "${backup_path}"*

	find data/backups -maxdepth 1 -type f -name 'self-feed-*.db' | sort | head -n -10 | while read -r old_backup; do
		rm -f "${old_backup}" "${old_backup}-wal" "${old_backup}-shm"
	done
}

ensure_data_permissions() {
	mkdir -p data data/backups
	api_status="$("${CONTAINER_CLI}" inspect -f '{{.State.Status}}' selffeed-api 2>/dev/null || true)"
	if [ "${api_status}" = "running" ]; then
		echo "Normalizing data directory ownership for runtime uid/gid ${APP_UID}:${APP_GID}"
		if "${CONTAINER_CLI}" exec --user 0:0 selffeed-api sh -c \
			"chown -R ${APP_UID}:${APP_GID} /app/data && find /app/data -type d -exec chmod 750 {} + && find /app/data -type f -exec chmod 600 {} +"; then
			return 0
		fi
		echo "Warning: container permission normalization failed; falling back to host-side permissions."
	else
		echo "API container status is '${api_status:-missing}'; normalizing host data directory permissions for runtime uid/gid ${APP_UID}:${APP_GID}"
	fi

	if ! chown -R "${APP_UID}:${APP_GID}" data 2>/dev/null; then
		echo "Warning: could not chown data to ${APP_UID}:${APP_GID}; continuing with existing ownership."
	fi
	chmod 750 data data/backups
	find data -type f -exec chmod 600 {} + 2>/dev/null || true
}

# Ensure the data dir exists for the SQLite volume.
mkdir -p data
if ! chmod 750 data 2>/dev/null; then
	echo "Warning: could not chmod data before permission normalization; continuing with existing permissions."
fi

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
upsert_env_var APP_UID "${APP_UID}"
upsert_env_var APP_GID "${APP_GID}"

export IMAGE_TAG
export IMAGE_OWNER_LOWERCASE="${IMAGE_OWNER}"
export REGISTRY

ensure_data_permissions
backup_existing_database

# Save current image before deploying for rollback capability
save_current_image

# Pull images, restart services, prune.
"${COMPOSE_ARGS[@]}" -f docker-compose.yml pull || fail_with_diagnostics
ensure_data_permissions
"${COMPOSE_ARGS[@]}" -f docker-compose.yml up -d --remove-orphans || fail_with_diagnostics

wait_for_container_health selffeed-redis Redis || { echo "[DEPLOY] Redis health check failed"; rollback_deploy; }
wait_for_container_health selffeed-api API || { echo "[DEPLOY] API health check failed"; rollback_deploy; }
wait_for_container_health selffeed-web Web || { echo "[DEPLOY] Web health check failed"; rollback_deploy; }
wait_for_container_health selffeed-worker Worker || { echo "[DEPLOY] Worker health check failed"; rollback_deploy; }
verify_public_routes || { echo "[DEPLOY] Public route smoke check failed"; fail_with_diagnostics; }

"${CONTAINER_CLI}" image prune -f
