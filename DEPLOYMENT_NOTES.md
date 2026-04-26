# Ratings Deployment Notes

## File split

- `compose.yaml` is the VPS deployment wrapper
- `compose.local.yaml` is the local Docker Desktop test setup

## Why both exist

The VPS deployment needs:

- Traefik labels
- external Docker network
- persistent Redis, SQLite, LMDB, and IMDb dataset mounts
- env-driven hostname and deployment settings

The local setup avoids those production assumptions and instead uses:

- direct port mapping
- a local Redis volume
- local-only container names
- no Traefik labels
- no `/opt/docker/...` bind mounts

## Deployment guidance

- Keep secrets in `.env`, not in `compose.yaml`
- Use `compose.yaml` on the VPS
- Use `docker compose --env-file .env -f compose.local.yaml up -d` for local testing
- Keep `.env.example` in sync with `src/config/index.js`
- If this becomes public-facing beyond personal use, move toward user-config storage instead of env-only behavior

## Operational notes

- Redis is local to this stack and used for hot cache / final result cache
- SQLite stores user config and structured app data
- Provider keys inside saved user configs are encrypted with `CONFIG_ENCRYPTION_SECRET`
- Keep `CONFIG_ENCRYPTION_SECRET` stable and backed up; changing it will make existing encrypted provider keys unreadable
- `SAFETY_SOURCE=hybrid` is the production default; `direct` and `mdblist_conservative` are server-side debug modes, not normal user-facing choices
- LMDB stores local IMDb lookup data derived from the mounted IMDb TSV datasets
- Redis should not be used as the primary IMDb dataset store
- IMDb dataset path is mounted read-only at `/app/data/imdb`
- `IMDB_DATASET_MODE=required` is appropriate on the VPS once the IMDb dataset files are mounted
- `IMDB_DATASET_MODE=optional` is useful for local development without the large IMDb dataset files
- Traefik should be the only public entrypoint for the app

## IMDb dataset ingestion on VPS

The expected VPS paths are:

```text
/opt/docker/compose/ratings
/opt/docker/data/ratings/imdb
/opt/docker/data/ratings/lmdb
```

Before the first required-mode start, create the persistent directories:

```bash
sudo mkdir -p /opt/docker/data/ratings/imdb
sudo mkdir -p /opt/docker/data/ratings/lmdb
sudo mkdir -p /opt/docker/data/ratings/app
sudo mkdir -p /opt/docker/data/ratings/redis
```

Confirm `.env` contains:

```env
IMDB_DATASET_MODE=required
IMDB_DATA_DIR="/app/data/imdb"
LMDB_DATA_DIR="/app/data/lmdb"
RATINGS_IMDB_DATA_DIR=/opt/docker/data/ratings/imdb
RATINGS_LMDB_DATA_DIR=/opt/docker/data/ratings/lmdb
```

Run the dataset update helper from the compose directory:

```bash
cd /opt/docker/compose/ratings
sudo ./update_imdb_dataset.sh
```

The helper:

- downloads `title.ratings.tsv.gz` and `title.episode.tsv.gz`
- validates both gzip files before replacing existing files
- restarts the ratings container only when either dataset file changed
- waits for the container healthcheck
- prints recent IMDb/LMDB ingestion logs

Manual verification commands:

```bash
ls -lh /opt/docker/data/ratings/imdb
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail=120 ratings-aggregator | grep -E "IMDb LMDB|Dataset"
docker compose --env-file .env -f compose.yaml exec -T ratings-aggregator curl -sS http://localhost:${PORT:-61262}/health
```

Expected successful logs include:

```text
[IMDb LMDB] Ratings DONE: ...
[IMDb LMDB] Episode mappings DONE: ...
[IMDb LMDB] Dataset initialization COMPLETE: ... ratings, ... episode mappings
```
