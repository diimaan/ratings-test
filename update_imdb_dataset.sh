#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/opt/docker/compose/ratings"
DATA_DIR="/opt/docker/data/ratings/imdb"
TMP_DIR="/opt/docker/data/ratings/imdb/.tmp"
LOG_FILE="/var/log/ratings-imdb-dataset-update.log"

RATINGS_URL="https://datasets.imdbws.com/title.ratings.tsv.gz"
EPISODES_URL="https://datasets.imdbws.com/title.episode.tsv.gz"

RATINGS_FILE="${DATA_DIR}/title.ratings.tsv.gz"
EPISODES_FILE="${DATA_DIR}/title.episode.tsv.gz"

TMP_RATINGS_FILE="${TMP_DIR}/title.ratings.tsv.gz"
TMP_EPISODES_FILE="${TMP_DIR}/title.episode.tsv.gz"

CONTAINER_APP="ratings-aggregator"
CONTAINER_REDIS="ratings-redis"

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

clear_imdb_dataset_keys() {
  log "Clearing Redis IMDb dataset keys..."

  sudo docker exec -i "${CONTAINER_REDIS}" sh -c \
    "redis-cli --scan --pattern 'rating:*' | xargs -r redis-cli DEL >/dev/null"

  sudo docker exec -i "${CONTAINER_REDIS}" sh -c \
    "redis-cli --scan --pattern 'ep:*' | xargs -r redis-cli DEL >/dev/null"

  sudo docker exec -i "${CONTAINER_REDIS}" redis-cli DEL imdb:loaded >/dev/null

  log "Redis IMDb dataset keys cleared."
}

restart_ratings_container() {
  log "Restarting ratings container..."
  cd "${BASE_DIR}"
  sudo docker compose restart "${CONTAINER_APP}" >/dev/null
  log "Ratings container restarted."
}

main() {
  log "===== IMDb dataset update started ====="

  rm -f "${TMP_RATINGS_FILE}" "${TMP_EPISODES_FILE}"

  log "Downloading ratings dataset..."
  download_file "${RATINGS_URL}" "${TMP_RATINGS_FILE}"

  log "Downloading episodes dataset..."
  download_file "${EPISODES_URL}" "${TMP_EPISODES_FILE}"

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
    clear_imdb_dataset_keys
    restart_ratings_container
    log "Dataset refresh completed."
  else
    log "No dataset changes detected. Nothing to restart."
  fi

  log "===== IMDb dataset update finished ====="
}

main "$@"
