# Ratings Deployment Notes

## File split

- `docker-compose.yml` is the simple upstream local/dev compose
- `compose.yaml` is the cleaner VPS deployment wrapper

## Why both exist

The upstream project ships a basic compose file that is useful for local testing.
This repo also needs a VPS-oriented wrapper with:

- Traefik labels
- external Docker network
- persistent Redis and IMDb dataset mounts
- env-driven hostname and deployment settings

## Deployment guidance

- Keep secrets in `.env`, not in `compose.yaml`
- Use `compose.yaml` on the VPS
- Keep `.env.example` in sync with `src/config/index.js`
- If this becomes public-facing beyond personal use, move toward user-config storage instead of env-only behavior

## Operational notes

- Redis is local to this stack and used for hot cache / final result cache
- IMDb dataset path is mounted read-only at `/app/data/imdb`
- Traefik should be the only public entrypoint for the app
