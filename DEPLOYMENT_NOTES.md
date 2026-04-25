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
- LMDB stores local IMDb lookup data derived from the mounted IMDb TSV datasets
- Redis should not be used as the primary IMDb dataset store
- IMDb dataset path is mounted read-only at `/app/data/imdb`
- `IMDB_DATASET_MODE=required` is appropriate on the VPS once the IMDb dataset files are mounted
- `IMDB_DATASET_MODE=optional` is useful for local development without the large IMDb dataset files
- Traefik should be the only public entrypoint for the app
