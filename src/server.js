require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./utils/logger');
const config = require('./config');
const addonInterface = require('./addon');
const { getRouter } = require('stremio-addon-sdk');
const redisClient = require('./cache/redisClient');
const imdbDataset = require('./utils/imdbRedisDataset');

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
    // Fast boot with a small readiness wait so Redis is actually usable
    (async () => {
        try {
            const ready = await waitForRedisReady(20, 500);
            if (!ready) {
                logger.warn('Skipping IMDb dataset initialization because Redis is not ready.');
                return;
            }

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

    // Mount the Stremio addon (manifest.json, API, etc.)
    app.use(getRouter(addonInterface));
    logger.info('Addon router mounted.');

    // Start HTTP server
    const port = config.port;
    app.listen(port, () => {
        const url = `http://localhost:${port}`;
        logger.info(`Addon server listening on ${url}`);
        logger.info(`Access the addon manifest at ${url}/manifest.json`);
    });
}

// Graceful shutdown
async function shutdown(signal) {
    logger.warn(`Received ${signal}. Shutting down...`);
    await redisClient.disconnect();
    logger.info('Shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
