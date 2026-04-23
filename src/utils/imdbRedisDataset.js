const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const redisClient = require('../cache/redisClient');
const logger = require('./logger');

const RATINGS_FILE = '/app/data/imdb/title.ratings.tsv.gz';
const EPISODES_FILE = '/app/data/imdb/title.episode.tsv.gz';
const LOADED_FLAG_KEY = 'imdb:loaded';

function episodeKey(showId, season, episode) {
    return `ep:${showId}:S${season}E${episode}`;
}

function ratingKey(id) {
    return `rating:${id}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRedisLoadingError(err) {
    if (!err) return false;
    const msg = String(err.message || err);
    return msg.includes('LOADING Redis is loading the dataset in memory');
}

function createSafeStream(filePath) {
    if (!fs.existsSync(filePath)) {
        logger.warn(`[IMDb Redis] File not found: ${filePath}`);
        return null;
    }

    const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());

    stream.on('error', (err) => {
        logger.error(`[IMDb Redis] Stream error for ${filePath}: ${err.message}`);
    });

    return stream;
}

async function execPipelineWithRetry(pipeline, maxAttempts = 20, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await pipeline.exec();
        } catch (err) {
            if (isRedisLoadingError(err)) {
                logger.warn(`[IMDb Redis] Redis still loading during pipeline exec, retry ${attempt}/${maxAttempts}`);
                await sleep(delayMs);
                continue;
            }
            throw err;
        }
    }

    throw new Error('Redis remained in LOADING state for too long during pipeline exec');
}

async function getRedisValueWithRetry(key, maxAttempts = 20, delayMs = 1000) {
    const client = redisClient.getClient();
    if (!client) {
        throw new Error('Redis client unavailable');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await client.get(key);
        } catch (err) {
            if (isRedisLoadingError(err)) {
                logger.warn(`[IMDb Redis] Redis still loading during GET ${key}, retry ${attempt}/${maxAttempts}`);
                await sleep(delayMs);
                continue;
            }
            throw err;
        }
    }

    throw new Error(`Redis remained in LOADING state for too long while reading key: ${key}`);
}

async function setRedisValueWithRetry(key, value, maxAttempts = 20, delayMs = 1000) {
    const client = redisClient.getClient();
    if (!client) {
        throw new Error('Redis client unavailable');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await client.set(key, value);
        } catch (err) {
            if (isRedisLoadingError(err)) {
                logger.warn(`[IMDb Redis] Redis still loading during SET ${key}, retry ${attempt}/${maxAttempts}`);
                await sleep(delayMs);
                continue;
            }
            throw err;
        }
    }

    throw new Error(`Redis remained in LOADING state for too long while setting key: ${key}`);
}

async function flushBatch(batch) {
    if (!batch.length) return;

    const client = redisClient.getClient();
    if (!client) {
        throw new Error('Redis client unavailable during batch flush');
    }

    const pipeline = client.multi();

    for (const item of batch) {
        if (item.type === 'rating') {
            pipeline.set(ratingKey(item.id), item.value);
        } else if (item.type === 'episode') {
            pipeline.set(episodeKey(item.showId, item.season, item.episode), item.episodeId);
        }
    }

    await execPipelineWithRetry(pipeline);
    batch.length = 0;
}

async function loadRatings() {
    logger.info('[IMDb Redis] Loading ratings into Redis...');

    const stream = createSafeStream(RATINGS_FILE);
    if (!stream) {
        throw new Error(`Missing ratings dataset: ${RATINGS_FILE}`);
    }

    const rl = readline.createInterface({ input: stream });

    let count = 0;
    const batch = [];

    for await (const line of rl) {
        if (!line || line.startsWith('tconst')) continue;

        const [id, rating] = line.split('\t');
        if (!id || !rating || rating === '\\N') continue;

        batch.push({
            type: 'rating',
            id,
            value: rating,
        });

        count++;

        if (batch.length >= 1000) {
            await flushBatch(batch);
        }

        if (count % 100000 === 0) {
            logger.info(`[IMDb Redis] Ratings loaded: ${count}`);
        }
    }

    await flushBatch(batch);

    logger.info(`[IMDb Redis] Ratings DONE: ${count}`);
}

async function loadEpisodes() {
    logger.info('[IMDb Redis] Loading episodes into Redis...');

    const stream = createSafeStream(EPISODES_FILE);
    if (!stream) {
        throw new Error(`Missing episodes dataset: ${EPISODES_FILE}`);
    }

    const rl = readline.createInterface({ input: stream });

    let count = 0;
    const batch = [];

    for await (const line of rl) {
        if (!line || line.startsWith('tconst')) continue;

        const [episodeId, showId, season, episode] = line.split('\t');
        if (!episodeId || !showId || !season || !episode) continue;
        if (season === '\\N' || episode === '\\N') continue;

        batch.push({
            type: 'episode',
            showId,
            season,
            episode,
            episodeId,
        });

        count++;

        if (batch.length >= 1000) {
            await flushBatch(batch);
        }

        if (count % 100000 === 0) {
            logger.info(`[IMDb Redis] Episodes loaded: ${count}`);
        }
    }

    await flushBatch(batch);

    logger.info(`[IMDb Redis] Episodes DONE: ${count}`);
}

async function getEpisodeRating(showId, season, episode) {
    try {
        const client = redisClient.getClient();
        if (!client) return null;

        const episodeId = await getRedisValueWithRetry(episodeKey(showId, season, episode));
        if (!episodeId) return null;

        const rating = await getRedisValueWithRetry(ratingKey(episodeId));
        if (!rating) return null;

        const numeric = parseFloat(rating);
        if (!Number.isFinite(numeric)) return null;

        return {
            source: 'IMDb Episode',
            value: `${numeric.toFixed(1)}/10`,
        };
    } catch (err) {
        logger.error(`[IMDb Redis] Episode rating error: ${err.message}`);
        return null;
    }
}

async function init() {
    try {
        if (!redisClient.isReady()) {
            logger.warn('[IMDb Redis] Redis not ready, skipping dataset init');
            return false;
        }

        const client = redisClient.getClient();
        if (!client) {
            logger.warn('[IMDb Redis] Redis client unavailable, skipping dataset init');
            return false;
        }

        const flag = await getRedisValueWithRetry(LOADED_FLAG_KEY);

        if (flag) {
            logger.info('[IMDb Redis] Dataset already loaded. Skipping.');
            return true;
        }

        logger.info('[IMDb Redis] Starting dataset initialization...');

        await loadRatings();
        await loadEpisodes();

        await setRedisValueWithRetry(LOADED_FLAG_KEY, 'true');

        logger.info('[IMDb Redis] Dataset initialization COMPLETE');
        return true;
    } catch (err) {
        logger.error(`[IMDb Redis] Init failed: ${err.message}`);
        return false;
    }
}

module.exports = {
    init,
    getEpisodeRating,
};
