# --- frontend builder ---
    FROM node:22-alpine AS frontend-builder

    ARG VITE_HOME_BLURB
    WORKDIR /app

    COPY frontend/package.json frontend/package-lock.json ./frontend/
    RUN cd frontend && npm ci

    COPY frontend ./frontend

    RUN cd frontend && npm run build

    # --- backend builder ---
    FROM node:22-alpine AS backend-builder
    WORKDIR /app

    RUN apk add --no-cache --virtual .build-deps python3 make g++

    COPY package.json package-lock.json ./
    RUN npm ci --omit=dev

    # --- final image ---
    FROM node:22-alpine
    WORKDIR /app

    RUN apk add --no-cache curl

    COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
    COPY --from=backend-builder /app/node_modules ./node_modules

    COPY package.json .
    COPY src ./src

    HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

    ENV NODE_ENV=production
    ENV PORT=61262
    EXPOSE 61262

    CMD ["npm", "start"]
