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

- The addon supports horizontal scaling. The rate limiter for
  `/api/config/*` coordinates through Redis (`incrementFixedWindow`),
  the rating cache lives in Redis and is shared across users
  (richness-gated writes prevent tier downgrades), and provider-key
  validation results are cached in Redis with a short TTL so signup
  spikes don't burst-call upstream. The only remaining process-local
  state is intra-replica request coalescing (`inFlightRequests` Map):
  if two replicas miss cache for the same hot title at the same
  instant, each does its own upstream fetch, but only one of those
  fetches typically wins the richness gate and the result is then
  available to everyone via shared Redis. This is bounded by replica
  count, not user count.
- The addon emits `Cache-Control` headers suitable for an HTTP edge
  cache (Cloudflare, Fastly, Varnish):
  - `/manifest.json`, `/stremio/<uuid>/manifest.json`, and
    `/stremio/<uuid>/stream/<type>/<id>.json` set
    `public, max-age=300, s-maxage=300, stale-while-revalidate=...`,
    and stream responses set `Vary: User-Agent` so the auto display
    mode (TV vs desktop) doesn't bleed across UA families. TTLs are
    tunable via `EDGE_STREAM_MAX_AGE_SECONDS`,
    `EDGE_MANIFEST_MAX_AGE_SECONDS`, and `EDGE_DEFAULTS_MAX_AGE_SECONDS`.
  - All mutating `/api/config/*` endpoints set `Cache-Control: no-store`,
    so credentials and password-protected mutations are never edge-cached.
  - In Cloudflare, set "Cache Level: Standard" and "Origin Cache
    Control: On" for the addon hostname; CF will honour the headers
    above without further rules.
- Redis is local to this stack and used for hot cache / final result cache
- User config is stored in either SQLite (default) or Postgres,
  selected by `CONFIG_STORE_DRIVER`. Postgres is the recommended
  backend for shared/managed deployments (e.g. elfhosted): set
  `CONFIG_STORE_DRIVER=postgres` and `CONFIG_DATABASE_URL=...`.
  The driver creates its own table and trigger on first start.
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
