# Ratings Aggregator for Stremio

Ratings Aggregator is a self-hostable Stremio addon for showing movie and series ratings in stream results. This fork is being refactored around a cleaner public-addon architecture:

- Native IMDb and TMDb ratings as first-class sources
- MDBList as the main aggregation and metadata layer
- Public MetaDB as an experimental fallback when MDBList is unavailable or empty
- Derived age and warning signals from structured metadata where available
- UUID-based per-user configuration
- SQLite or Postgres for user configs (selected via `CONFIG_STORE_DRIVER`)
- LMDB for local IMDb episode lookup data
- Redis for hot cache and final result cache

## Current Status

This repo is still an active refactor, not a polished public release. It is suitable for controlled self-hosting and development testing.

Implemented:

- `/configure` UI for creating UUID manifests
- UUID + password based config retrieval and update
- Stable manifest routes such as `/stremio/<uuid>/manifest.json`
- Server-side storage of user provider keys
- At-rest encryption of saved provider keys with `CONFIG_ENCRYPTION_SECRET`
- Configuration-required base manifest for BYOB hosting
- Compact and full display modes
- Rating enable/disable and ordering controls
- Server-controlled Hybrid Conservative safety policy
- Operator-supplied "instance default" provider keys with stale-fallback caching and a user-facing rate-limit message
- SQLite or Postgres config storage
- Redis result caching
- LMDB-backed IMDb episode lookup foundation

Still planned:

- More UI polish
- Full IMDb LMDB ingestion test on VPS dataset files
- Automated tests for provider fallback and rating display behavior
- More complete production hardening

## Configuration Model

Users create a config from `/configure`.

Each saved config has:

- A UUID used in the Stremio manifest URL
- A password used only for retrieving, updating, exporting, or deleting the config
- Provider keys stored server-side

The manifest URL does not expose API keys or the config password.

Example:

```text
/stremio/00000000-0000-0000-0000-000000000000/manifest.json
```

Keep the UUID and password safe. There is intentionally no password recovery flow.

## Required Environment

Copy `.env.example` to `.env` and fill in the values.

Important values:

```env
TMDB_API_KEY="..."
MDBLIST_API_KEY="..."
PUBLICMETADB_API_KEY=""
REDIS_URL="redis://ratings-redis:6379"
CONFIG_STORE_DRIVER=sqlite                     # or "postgres"
SQLITE_DB_PATH="/app/data/app/ratings.sqlite"  # used when driver=sqlite
CONFIG_DATABASE_URL=""                         # used when driver=postgres
LMDB_DATA_DIR="/app/data/lmdb"
CONFIG_ENCRYPTION_SECRET="CHANGE_ME_TO_A_LONG_RANDOM_SECRET"
IMDB_DATASET_MODE=required
IMDB_DATA_DIR="/app/data/imdb"
SAFETY_SOURCE=hybrid
```

### Instance-default provider keys

When `TMDB_API_KEY`, `MDBLIST_API_KEY`, or `PUBLICMETADB_API_KEY` are set in the operator env, users can leave the corresponding field blank in `/configure` and the server will use the operator's key at request time. The operator's key is never returned to clients (the configure UI shows an "Instance default available" hint instead).

Quota and rate-limit considerations:

- TMDb's free tier is generous (≈50 req/s, no daily cap) — sharing one key across many users is normally fine.
- MDBList's free tier is **1000 calls/day per key**. A busy public instance will exhaust this. Either use a paid MDBList plan, or expect users to bring their own MDBList keys.
- When upstream returns 429, the addon falls back to a long-TTL stale copy of the same title's last-known-good ratings (`STALE_FALLBACK_TTL_SECONDS`, default 14 days).
- When stale fallback also misses, the addon surfaces a stream entitled `⚠️ Ratings rate-limited` with a prompt to add the user's own key at `/configure`.

The user's saved config still stores their actual input. If the operator rotates an instance key, all empty-key users automatically pick up the new key on their next request, and the cache fingerprint changes so stale results from the old key are not served.

### User-config store backends

- `CONFIG_STORE_DRIVER=sqlite` (default): single-file database at
  `SQLITE_DB_PATH`. Suitable for self-hosting one container with a bind
  mount.
- `CONFIG_STORE_DRIVER=postgres`: requires `CONFIG_DATABASE_URL` (or the
  standard `DATABASE_URL`). Recommended for shared / managed
  deployments. The driver creates the `user_configs` table and updated_at
  trigger on first start. For managed Postgres with TLS, set
  `CONFIG_DATABASE_SSL=require`.

`CONFIG_ENCRYPTION_SECRET` must remain stable. If it changes, existing encrypted provider keys cannot be decrypted.

This addon runs in BYOB mode. The base `/manifest.json` exists only to send users through configuration, and stream results require a saved UUID config.

`SAFETY_SOURCE` is intentionally server-controlled, not a public user setting. Keep `hybrid` for production. `direct` and `mdblist_conservative` are retained for debugging provider behaviour.

`PUBLICMETADB_FALLBACK_MODE` controls the experimental Public MetaDB fallback path:

- `auto`: production default. Use Public MetaDB only when MDBList has no usable enabled ratings.
- `compare`: diagnostic mode. Fetch and log Public MetaDB even when MDBList succeeds, but leave final stream output unchanged.
- `force`: diagnostic mode. Fetch Public MetaDB even when MDBList succeeds and allow it to participate in final rating selection.
- `off`: disable Public MetaDB fallback completely.

When testing `compare` or `force`, clear Redis or use a fresh title so cached final ratings do not hide provider behavior.

## Local Docker Desktop

For local testing:

```bash
docker compose --env-file .env -f compose.local.yaml up -d --build
```

The local compose setup:

- Uses direct port mapping
- Uses local named volumes
- Sets `IMDB_DATASET_MODE=optional`
- Does not require Traefik

Open:

```text
http://localhost:61262/configure
```

## VPS Deployment

For VPS deployment, use:

```bash
docker compose --env-file .env -f compose.yaml up -d --build
```

The VPS compose setup expects:

- Existing external Docker network, for example `aio_default`
- Traefik as the public entrypoint
- Persistent bind mounts for Redis, SQLite, LMDB, and IMDb dataset files

See `DEPLOYMENT_NOTES.md` for operational notes.

## IMDb Dataset

The addon expects these files when `IMDB_DATASET_MODE=required`:

```text
/app/data/imdb/title.ratings.tsv.gz
/app/data/imdb/title.episode.tsv.gz
```

The update helper downloads from IMDb's public dataset endpoint into `/opt/docker/data/ratings/imdb`:

```bash
sudo ./update_imdb_dataset.sh
```

When files change, the ratings container restarts and the LMDB lookup store refreshes during startup.

## Development Checks

```bash
npm run lint -- --max-warnings=0
npm run build:frontend
docker compose --env-file .env -f compose.local.yaml config --quiet
```

## Security Notes

- Provider keys are encrypted at rest using `CONFIG_ENCRYPTION_SECRET`
- UUID alone can install and use a config
- UUID + password is required to retrieve, update, export, or delete a config
- Working streams require a UUID config with user-supplied provider keys
- Redis is not used as the primary IMDb dataset store
- Public hosting should keep config routes rate-limited and proxied behind HTTPS
