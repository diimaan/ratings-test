require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./utils/logger');
const config = require('./config');
const redisClient = require('./cache/redisClient');
const imdbDataset = require('./utils/imdbLmdbDataset');
const stremioConfigRoutes = require('./routes/stremioConfigRoutes');
const configApiRoutes = require('./routes/configApiRoutes');
const userConfigStore = require('./storage/userConfigStore');
const lmdbStore = require('./storage/lmdbStore');
const jsonErrorHandler = require('./middleware/jsonErrorHandler');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRedisReady(maxAttempts = 20, delayMs = 500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (redisClient.isReady()) {
            logger.info(`Redis ready confirmed after ${attempt} check(s).`);
            return true;
        }

        logger.debug(`Waiting for Redis ready... attempt ${attempt}/${maxAttempts}`);
        await sleep(delayMs);
    }

    logger.warn('Redis did not become ready in time.');
    return false;
}

async function startServer() {
    logger.info('Starting addon server...');

    // =========================
    // Redis Initialization
    // =========================
    // Redis is required: caching, in-flight result coalescing, and the
    // IMDb hot cache all depend on it. Fail fast at startup so the
    // orchestrator surfaces the misconfiguration instead of letting the
    // service run in a degraded state.
    try {
        if (!redisClient.isReady()) {
            await redisClient.connect();
        }

        const ready = await waitForRedisReady(
            config.redis.startupReadyAttempts,
            config.redis.startupReadyDelayMs
        );

        if (!ready) {
            throw new Error(
                `Redis at ${config.redis.url} did not become ready within ` +
                `${config.redis.startupReadyAttempts * config.redis.startupReadyDelayMs}ms.`
            );
        }

        logger.info('Redis connected successfully.');
    } catch (err) {
        if (config.redis.required) {
            logger.error(`Redis is required but unavailable: ${err.message}`);
            process.exit(1);
        }

        logger.warn(`Redis unavailable (REDIS_REQUIRED=false): ${err.message}`);
    }

    // =========================
    // User-config store init
    // =========================
    try {
        await userConfigStore.init();
    } catch (err) {
        logger.error(`User-config store failed to initialize: ${err.message}`);
        process.exit(1);
    }

    // =========================
    // IMDb Dataset Init
    // =========================
    (async () => {
        try {
            await imdbDataset.init();
            logger.info('IMDb dataset initialization task completed.');
        } catch (err) {
            logger.warn('IMDb dataset init failed:', err.message);
        }
    })();

    // =========================
    // Express App Setup
    // =========================
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json({ limit: '64kb' }));

    // Serve any static files you place in ./public
    const distPath = path.join(__dirname, '../frontend/dist');
    app.use('/configure', express.static(distPath));

    // Serve the index.html file for the root path
    app.get('/', (_req, res) => {
        res.redirect('/configure');
    });

    app.get('/configure', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });

    app.get('/health', async (_req, res) => {
        // Health must never be edge-cached: the orchestrator needs the
        // current up/down state of THIS replica, not a stale CDN copy.
        res.set('Cache-Control', 'no-store');

        const userConfigStoreHealth = await userConfigStore.health();
        const lmdb = lmdbStore.health();
        const storageOk = userConfigStoreHealth.ok && lmdb.ok;

        res.json({
            status: storageOk ? 'ok' : 'degraded',
            redis: redisClient.isReady(),
            storage: {
                userConfig: userConfigStoreHealth,
                lmdb,
            },
            uptime: process.uptime(),
        });
    });

    app.use(configApiRoutes);
    logger.info('Config API routes mounted.');

    app.use(stremioConfigRoutes);
    logger.info('Config-scoped Stremio routes mounted.');
    app.use(jsonErrorHandler);

    // Start HTTP server
    const port = config.port;
    app.listen(port, () => {
        const url = `http://localhost:${port}`;
        logger.info(`Addon server listening on ${url}`);
        logger.info(`Access the addon manifest at ${url}/manifest.json`);
        logger.info(`Create or retrieve UUID configs at ${url}/configure`);
    });
}

// Graceful shutdown
async function shutdown(signal) {
    logger.warn(`Received ${signal}. Shutting down...`);
    await redisClient.disconnect();
    await userConfigStore.close();
    lmdbStore.close();
    logger.info('Shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
