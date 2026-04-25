require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./utils/logger');
const config = require('./config');
const redisClient = require('./cache/redisClient');
const imdbDataset = require('./utils/imdbLmdbDataset');
const stremioConfigRoutes = require('./routes/stremioConfigRoutes');
const configApiRoutes = require('./routes/configApiRoutes');
const sqliteStore = require('./storage/sqliteStore');
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
    try {
        if (!redisClient.isReady()) {
            await redisClient.connect();
        }
        logger.info('Redis connected successfully.');
    } catch (err) {
        logger.warn('Redis unavailable:', err.message);
    }

    // =========================
    // IMDb Dataset Init
    // =========================
    (async () => {
        try {
            await waitForRedisReady(20, 500);
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

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            redis: redisClient.isReady(),
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
        logger.info(`Access the config-scoped manifest at ${url}/stremio/default/manifest.json`);
    });
}

// Graceful shutdown
async function shutdown(signal) {
    logger.warn(`Received ${signal}. Shutting down...`);
    await redisClient.disconnect();
    sqliteStore.close();
    lmdbStore.close();
    logger.info('Shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
