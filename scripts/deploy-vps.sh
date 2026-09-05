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
API_IMAGE="${REGISTRY}/${IMAGE_OWNER}/self-feed-api:${IMAGE_TAG}"
WEB_IMAGE="${REGISTRY}/${IMAGE_OWNER}/self-feed-web:${IMAGE_TAG}"
PREVIOUS_API_IMAGE="${REGISTRY}/${IMAGE_OWNER}/self-feed-api:previous"
PREVIOUS_WEB_IMAGE="${REGISTRY}/${IMAGE_OWNER}/self-feed-web:previous"
ROLLBACK_AVAILABLE=false
CONTAINER_HEALTH_ATTEMPTS="${CONTAINER_HEALTH_ATTEMPTS:-180}"

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
echo "Image       : ${API_IMAGE}"
echo "::endgroup::"

mkdir -p "${DEPLOY_PATH}"
cd "${DEPLOY_PATH}"
RECOVERY_DIR="${PWD}/.deploy-recovery/${HEAD_SHA}"

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

database_schema_fingerprint() {
	local image="$1"
	if [ ! -f data/self-feed.db ]; then
		printf '%s\n' missing
		return 0
	fi
	"${CONTAINER_CLI}" run --rm --pull never --network none --user 0:0 \
		--volume "${PWD}/data:/app/data:ro" --entrypoint bun "${image}" -e '
		import { Database } from "bun:sqlite";
		import { createHash } from "node:crypto";
		const db = new Database("/app/data/self-feed.db", { readonly: true });
		try {
			const snapshot = db.transaction(() => {
				const schema = db.query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all();
				const ledger = schema.some(row => row.type === "table" && row.name === "__drizzle_migrations")
					? db.query("SELECT * FROM __drizzle_migrations ORDER BY id").all() : [];
				return { schema, ledger };
			})();
			console.log(createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"));
		} finally { db.close(); }
	'
}

rollback_deploy() {
	echo "[ROLLBACK] Stopping API and worker before checking database compatibility"
	if ! "${COMPOSE_ARGS[@]}" -f docker-compose.yml stop api worker; then
		echo "[ROLLBACK] Cannot confirm writers stopped; refusing to start previous images. Fix forward."
		fail_with_diagnostics
	fi

	if [ "${ROLLBACK_AVAILABLE}" != true ]; then
		echo "[ROLLBACK] No complete recovery set is available. Target configuration and data retained; API/worker remain stopped. Fix forward."
		fail_with_diagnostics
	fi
	local current_fingerprint previous_fingerprint api_image image
	api_image="$(cat "${RECOVERY_DIR}/api-image")"
	previous_fingerprint="$(cat "${RECOVERY_DIR}/fingerprint")"
	if ! current_fingerprint="$(database_schema_fingerprint "${api_image}")"; then
		echo "[ROLLBACK] Database compatibility is unreadable. Target configuration and data retained; API/worker remain stopped. Fix forward."
		fail_with_diagnostics
	fi
	if [ "${current_fingerprint}" != "${previous_fingerprint}" ]; then
		echo "[ROLLBACK] Database schema or migration ledger changed. Previous images will not be started."
		echo "[ROLLBACK] Target configuration, images, and all user data retained. API/worker remain stopped; deploy a compatible forward fix."
		fail_with_diagnostics
	fi
	for image in api worker web; do
		if ! "${CONTAINER_CLI}" image inspect "$(cat "${RECOVERY_DIR}/${image}-image")" >/dev/null 2>&1; then
			echo "[ROLLBACK] A captured image is unavailable. Target configuration and data retained; fix forward."
			fail_with_diagnostics
		fi
	done

	echo "[ROLLBACK] Database schema is unchanged; restoring the matching previous configuration and images"
	cp "${RECOVERY_DIR}/docker-compose.yml" docker-compose.yml || fail_with_diagnostics
	cp "${RECOVERY_DIR}/.env" .env || fail_with_diagnostics
	chmod 600 .env
	# The deploy process exports target image metadata. Let the restored .env
	# supply the old configuration, with immutable image IDs pinned separately.
	if ! (
		unset IMAGE_TAG IMAGE_OWNER_LOWERCASE REGISTRY APP_UID APP_GID
		"${COMPOSE_ARGS[@]}" -f docker-compose.yml -f "${RECOVERY_DIR}/images.yml" \
			up -d --no-deps --remove-orphans --force-recreate --pull never api worker web
	); then
		echo "[ROLLBACK] Failed to restart the captured release"
		fail_with_diagnostics
	fi

	if wait_for_container_health selffeed-redis Redis && \
		wait_for_container_health selffeed-api API && \
		wait_for_container_health selffeed-web Web && \
		wait_for_container_health selffeed-worker Worker; then
		echo "[ROLLBACK] Previous release restored. Database files and post-deploy user writes were preserved."
		exit 2
	fi
	echo "[ROLLBACK] Health checks failed after restoring the captured release"
	fail_with_diagnostics
}

save_current_images() {
	local api_image worker_image web_image file
	# A successful deployment closes its attempt. Deploying the same SHA again
	# needs a fresh baseline, not the version that preceded its first success.
	if [ -f "${RECOVERY_DIR}/deployment-succeeded" ]; then
		mv "${RECOVERY_DIR}" "${RECOVERY_DIR}.completed-$(date -u +%Y%m%dT%H%M%S)-$$" || return 1
	fi
	if [ ! -d "${RECOVERY_DIR}" ]; then
		api_image="$("${CONTAINER_CLI}" inspect -f '{{.Image}}' selffeed-api 2>/dev/null || true)"
		worker_image="$("${CONTAINER_CLI}" inspect -f '{{.Image}}' selffeed-worker 2>/dev/null || true)"
		web_image="$("${CONTAINER_CLI}" inspect -f '{{.Image}}' selffeed-web 2>/dev/null || true)"
		(
			umask 077
			mkdir -p "${RECOVERY_DIR%/*}" || exit 1
			staging="$(mktemp -d "${RECOVERY_DIR}.capture.XXXXXX")" || exit 1
			trap 'rm -rf "${staging}"' EXIT
			if [ -z "${api_image}" ] || [ -z "${web_image}" ] || \
				[ "${api_image}" != "${worker_image}" ] || \
				[ ! -f docker-compose.yml ] || [ ! -f .env ]; then
				# Preserve the absence of a baseline on retries of an initial or
				# incomplete installation, instead of adopting partially new state.
				touch "${staging}/unavailable" || exit 1
			else
				local fingerprint
				if ! fingerprint="$(database_schema_fingerprint "${api_image}")" || \
					[[ ! "${fingerprint}" =~ ^([0-9a-f]{64}|missing)$ ]]; then
					echo "[PRE-DEPLOY] Cannot read the existing database schema; deployment stopped before changing configuration."
					exit 1
				fi
				cp docker-compose.yml "${staging}/docker-compose.yml" || exit 1
				cp .env "${staging}/.env" || exit 1
				chmod 600 "${staging}/.env" || exit 1
				printf '%s\n' "${fingerprint}" > "${staging}/fingerprint" || exit 1
				printf '%s\n' "${api_image}" > "${staging}/api-image" || exit 1
				printf '%s\n' "${worker_image}" > "${staging}/worker-image" || exit 1
				printf '%s\n' "${web_image}" > "${staging}/web-image" || exit 1
				printf 'services:\n  api:\n    image: %s\n  worker:\n    image: %s\n  web:\n    image: %s\n' \
					"${api_image}" "${worker_image}" "${web_image}" > "${staging}/images.yml" || exit 1
				# Keep the captured image IDs reachable through local tags when
				# a successful deployment prunes dangling images.
				"${CONTAINER_CLI}" tag "${api_image}" "${PREVIOUS_API_IMAGE}" || exit 1
				"${CONTAINER_CLI}" tag "${web_image}" "${PREVIOUS_WEB_IMAGE}" || exit 1
			fi
			touch "${staging}/ready" || exit 1
			mv "${staging}" "${RECOVERY_DIR}" || exit 1
		) || return 1
	fi
	if [ ! -f "${RECOVERY_DIR}/ready" ]; then
		echo "[PRE-DEPLOY] Recovery metadata is incomplete; refusing to replace it during a retry."
		return 1
	fi
	if [ -f "${RECOVERY_DIR}/unavailable" ]; then
		ROLLBACK_AVAILABLE=false
		echo "[PRE-DEPLOY] No complete previous release is available for automatic rollback"
	else
		for file in docker-compose.yml .env api-image worker-image web-image fingerprint images.yml; do
			[ -s "${RECOVERY_DIR}/${file}" ] || return 1
		done
		ROLLBACK_AVAILABLE=true
		echo "[PRE-DEPLOY] Preserved recovery set is ready for this deployment attempt"
	fi
}

mark_deploy_success() {
	touch "${RECOVERY_DIR}/deployment-succeeded"
}

wait_for_container_health() {
	container="$1"
	label="$2"
	for _ in $(seq 1 "${CONTAINER_HEALTH_ATTEMPTS}"); do
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

install_crowdsec_navigation_whitelist() {
	local whitelist_file="$1"
	local configured_container
	local required
	local container
	local container_id
	local container_status
	local crowdsec_ready
	local -a crowdsec_containers=()
	configured_container="$(read_env_var CROWDSEC_CONTAINER_NAME)"
	required="$(read_env_var CROWDSEC_REQUIRED)"

	if [ -n "${configured_container}" ]; then
		if ! "${CONTAINER_CLI}" inspect "${configured_container}" >/dev/null 2>&1; then
			echo "Configured CrowdSec container does not exist: ${configured_container}"
			return 1
		fi
		crowdsec_containers+=("${configured_container}")
	else
		while IFS= read -r container_id; do
			[ -n "${container_id}" ] && crowdsec_containers+=("${container_id}")
		done < <(
			"${CONTAINER_CLI}" ps --format '{{.ID}} {{.Image}} {{.Names}}' |
				awk 'tolower($0) ~ /crowdsec/ && tolower($0) !~ /bouncer/ { print $1 }'
		)
	fi

	if [ "${#crowdsec_containers[@]}" -eq 0 ]; then
		if [ "${required}" = "true" ]; then
			echo "CROWDSEC_REQUIRED=true, but no running CrowdSec container was found"
			return 1
		fi
		echo "No CrowdSec container found; skipping parser installation"
		return 0
	fi

	for container in "${crowdsec_containers[@]}"; do
		echo "Installing SelfFeed navigation whitelist in CrowdSec container ${container}"
		"${CONTAINER_CLI}" cp \
			"${whitelist_file}" \
			"${container}:/etc/crowdsec/parsers/s02-enrich/01-self-feed-navigation-whitelist.yaml"
		"${CONTAINER_CLI}" exec "${container}" crowdsec -t
		"${CONTAINER_CLI}" restart "${container}" >/dev/null

		crowdsec_ready=false
		for _ in $(seq 1 30); do
			container_status="$("${CONTAINER_CLI}" inspect -f '{{.State.Status}}' "${container}" 2>/dev/null || true)"
			if [ "${container_status}" = "running" ] && \
				"${CONTAINER_CLI}" exec "${container}" crowdsec -t >/dev/null 2>&1; then
				echo "CrowdSec navigation whitelist active in ${container}"
				crowdsec_ready=true
				break
			fi
			sleep 1
		done

		if [ "${crowdsec_ready}" != "true" ]; then
			echo "CrowdSec did not recover with a valid parser configuration: ${container}"
			return 1
		fi
	done
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

	local timestamp backup_name backup_path api_status backup_image backup_program
	timestamp="$(date -u +%Y%m%dT%H%M%S%NZ)"
	backup_name="self-feed-${timestamp}-${HEAD_SHA_SHORT}-$$.db"
	backup_path="data/backups/${backup_name}"
	api_status="$("${CONTAINER_CLI}" inspect -f '{{.State.Status}}' selffeed-api 2>/dev/null || true)"
	backup_program='import { Database } from "bun:sqlite";
import { chmodSync, chownSync } from "node:fs";
const destination = `/app/data/backups/${process.env.SELF_FEED_BACKUP_NAME}`;
const db = new Database("/app/data/self-feed.db", { readonly: true });
try { db.query("VACUUM INTO ?").run(destination); } finally { db.close(); }
const backup = new Database(destination, { readonly: true });
try {
  const rows = backup.query("PRAGMA integrity_check").values();
  if (rows.length !== 1 || rows[0][0] !== "ok") throw new Error("Backup integrity check failed");
} finally { backup.close(); }
chownSync(destination, Number(process.env.SELF_FEED_BACKUP_UID), Number(process.env.SELF_FEED_BACKUP_GID));
chmodSync(destination, 0o600);'
	local backup_env=(-e "SELF_FEED_BACKUP_NAME=${backup_name}" -e "SELF_FEED_BACKUP_UID=${APP_UID}" -e "SELF_FEED_BACKUP_GID=${APP_GID}")

	echo "Creating consistent SQLite pre-deploy backup: ${backup_path}"
	if [ "${api_status}" = "running" ]; then
		if ! "${CONTAINER_CLI}" exec --user 0:0 "${backup_env[@]}" selffeed-api bun -e "${backup_program}"; then
			echo "[PRE-DEPLOY] ERROR: SQLite backup failed; deployment stopped. Existing backups are unchanged."
			rm -f "${backup_path}"
			return 1
		fi
	else
		# A stopped API does not imply an idle database: a worker may still write.
		# Run only SQLite tooling in the existing image, never application startup.
		backup_image="$("${CONTAINER_CLI}" inspect -f '{{.Image}}' selffeed-api 2>/dev/null || true)"
		backup_image="${backup_image:-${API_IMAGE}}"
		if ! "${CONTAINER_CLI}" image inspect "${backup_image}" >/dev/null 2>&1 || \
			! "${CONTAINER_CLI}" run --rm --network none --user 0:0 --entrypoint bun \
				-v "${PWD}/data:/app/data" "${backup_env[@]}" "${backup_image}" -e "${backup_program}"; then
			echo "[PRE-DEPLOY] ERROR: Consistent backup unavailable; deployment stopped. Start the API or make its image available and retry."
			rm -f "${backup_path}"
			return 1
		fi
	fi

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

if [ ! -f .env ]; then
	echo ".env is missing in ${DEPLOY_PATH}; create it with the production secrets before deploying."
	exit 1
fi
# Capture the previous configuration before downloading or rewriting any files.
save_current_images || fail_with_diagnostics

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
curl -fsSL \
	"${curl_headers[@]}" \
	-o self-feed-navigation-whitelist.yaml \
	"https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${HEAD_SHA}/deploy/crowdsec/self-feed-navigation-whitelist.yaml"

normalize_domain_name
install_crowdsec_navigation_whitelist self-feed-navigation-whitelist.yaml

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

# Pull images, restart services, prune.
"${COMPOSE_ARGS[@]}" -f docker-compose.yml pull || fail_with_diagnostics
ensure_data_permissions
"${COMPOSE_ARGS[@]}" -f docker-compose.yml up -d --remove-orphans || {
	echo "[DEPLOY] Compose startup failed"
	rollback_deploy
}

wait_for_container_health selffeed-redis Redis || { echo "[DEPLOY] Redis health check failed"; rollback_deploy; }
wait_for_container_health selffeed-api API || { echo "[DEPLOY] API health check failed"; rollback_deploy; }
wait_for_container_health selffeed-web Web || { echo "[DEPLOY] Web health check failed"; rollback_deploy; }
wait_for_container_health selffeed-worker Worker || { echo "[DEPLOY] Worker health check failed"; rollback_deploy; }
verify_public_routes || { echo "[DEPLOY] Public route smoke check failed"; rollback_deploy; }

mark_deploy_success
"${CONTAINER_CLI}" image prune -f
