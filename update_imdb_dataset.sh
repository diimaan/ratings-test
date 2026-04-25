#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/docker/compose/ratings}"
DATA_DIR="${DATA_DIR:-/opt/docker/data/ratings/imdb}"
TMP_DIR="${TMP_DIR:-/opt/docker/data/ratings/imdb/.tmp}"
LOG_FILE="${LOG_FILE:-/var/log/ratings-imdb-dataset-update.log}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-1800}"

RATINGS_URL="https://datasets.imdbws.com/title.ratings.tsv.gz"
EPISODES_URL="https://datasets.imdbws.com/title.episode.tsv.gz"

RATINGS_FILE="${DATA_DIR}/title.ratings.tsv.gz"
EPISODES_FILE="${DATA_DIR}/title.episode.tsv.gz"

TMP_RATINGS_FILE="${TMP_DIR}/title.ratings.tsv.gz"
TMP_EPISODES_FILE="${TMP_DIR}/title.episode.tsv.gz"

CONTAINER_APP="${CONTAINER_APP:-ratings-aggregator}"

mkdir -p "${DATA_DIR}" "${TMP_DIR}"
touch "${LOG_FILE}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

download_file() {
  local url="$1"
  local output="$2"

  curl -fL --retry 3 --connect-timeout 20 --max-time 1800 -o "${output}" "${url}"
}

validate_gzip() {
  local file="$1"
  local label="$2"

  log "Validating ${label} gzip..."
  gzip -t "${file}"

  if [[ ! -s "${file}" ]]; then
    log "ERROR: ${label} is empty after download."
    return 1
  fi
}

file_changed() {
  local old_file="$1"
  local new_file="$2"

  if [[ ! -f "${old_file}" ]]; then
    return 0
  fi

  if ! cmp -s "${old_file}" "${new_file}"; then
    return 0
  fi

  return 1
}

restart_ratings_container() {
  log "Restarting ratings container..."
  cd "${BASE_DIR}"
  sudo docker compose -f "${COMPOSE_FILE}" restart "${CONTAINER_APP}" >/dev/null
  log "Ratings container restarted."
}

wait_for_container_health() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local status=""

  log "Waiting for ${CONTAINER_APP} health, timeout ${HEALTH_TIMEOUT_SECONDS}s..."

  while (( SECONDS < deadline )); do
    status="$(sudo docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_APP}" 2>/dev/null || true)"

    if [[ "${status}" == "healthy" ]]; then
      log "${CONTAINER_APP} is healthy."
      return 0
    fi

    if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
      log "ERROR: ${CONTAINER_APP} status is ${status}."
      return 1
    fi

    sleep 10
  done

  log "ERROR: ${CONTAINER_APP} did not become healthy. Last status: ${status:-unknown}"
  return 1
}

show_dataset_logs() {
  log "Recent IMDb LMDB logs:"
  sudo docker logs --since 30m "${CONTAINER_APP}" 2>&1 \
    | grep -E "IMDb LMDB|LMDB|Dataset initialization|Dataset files|health" \
    | tail -n 80 \
    | tee -a "${LOG_FILE}" || true
}

main() {
  log "===== IMDb dataset update started ====="

  rm -f "${TMP_RATINGS_FILE}" "${TMP_EPISODES_FILE}"

  log "Downloading ratings dataset..."
  download_file "${RATINGS_URL}" "${TMP_RATINGS_FILE}"
  validate_gzip "${TMP_RATINGS_FILE}" "title.ratings.tsv.gz"

  log "Downloading episodes dataset..."
  download_file "${EPISODES_URL}" "${TMP_EPISODES_FILE}"
  validate_gzip "${TMP_EPISODES_FILE}" "title.episode.tsv.gz"

  local changed=0

  if file_changed "${RATINGS_FILE}" "${TMP_RATINGS_FILE}"; then
    log "title.ratings.tsv.gz changed."
    mv -f "${TMP_RATINGS_FILE}" "${RATINGS_FILE}"
    changed=1
  else
    log "title.ratings.tsv.gz unchanged."
    rm -f "${TMP_RATINGS_FILE}"
  fi

  if file_changed "${EPISODES_FILE}" "${TMP_EPISODES_FILE}"; then
    log "title.episode.tsv.gz changed."
    mv -f "${TMP_EPISODES_FILE}" "${EPISODES_FILE}"
    changed=1
  else
    log "title.episode.tsv.gz unchanged."
    rm -f "${TMP_EPISODES_FILE}"
  fi

  if [[ "${changed}" -eq 1 ]]; then
    log "Dataset changes detected."
    log "LMDB IMDb lookup data will refresh on ratings container restart."
    restart_ratings_container
    wait_for_container_health
    show_dataset_logs
    log "Dataset refresh completed."
  else
    log "No dataset changes detected. Nothing to restart."
  fi

  log "===== IMDb dataset update finished ====="
}

main "$@"
