const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const redisClient = require('../cache/redisClient');
const config = require('../config');
const lmdbStore = require('../storage/lmdbStore');
const logger = require('./logger');

const RATINGS_FILE_NAME = 'title.ratings.tsv.gz';
const EPISODES_FILE_NAME = 'title.episode.tsv.gz';
const META_VERSION_KEY = 'imdbDatasetVersion';
const META_STATUS_KEY = 'imdbDatasetStatus';
const HOT_CACHE_PREFIX = 'imdb:episode-rating:';

function ratingsFilePath() {
    return path.join(config.imdbDataset.dataDir, RATINGS_FILE_NAME);
}

function episodesFilePath() {
    return path.join(config.imdbDataset.dataDir, EPISODES_FILE_NAME);
}

function episodeKey(showId, season, episode) {
    return `${showId}:S${season}E${episode}`;
}

function ratingKey(id) {
    return id;
}

function hotCacheKey(showId, season, episode) {
    return `${HOT_CACHE_PREFIX}${episodeKey(showId, season, episode)}`;
}

function getRatingsDb() {
    return lmdbStore.getNamedDb('imdb-ratings');
}

function getEpisodesDb() {
    return lmdbStore.getNamedDb('imdb-episodes');
}

function getMetaDb() {
    return lmdbStore.getNamedDb('imdb-meta');
}

function isDatasetOptional() {
    return config.imdbDataset.mode === 'optional' || config.imdbDataset.mode === 'disabled';
}

function datasetFilesAvailable() {
    return fs.existsSync(ratingsFilePath()) && fs.existsSync(episodesFilePath());
}

function datasetVersion() {
    const ratingsStat = fs.statSync(ratingsFilePath());
    const episodesStat = fs.statSync(episodesFilePath());

    return {
        ratings: {
            file: RATINGS_FILE_NAME,
            size: ratingsStat.size,
            mtimeMs: Math.trunc(ratingsStat.mtimeMs),
        },
        episodes: {
            file: EPISODES_FILE_NAME,
            size: episodesStat.size,
            mtimeMs: Math.trunc(episodesStat.mtimeMs),
        },
    };
}

function stableVersionKey(version) {
    return JSON.stringify(version);
}

function createDatasetStream(filePath) {
    const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());

    stream.on('error', (err) => {
        logger.error(`[IMDb LMDB] Stream error for ${filePath}: ${err.message}`);
    });

    return stream;
}

async function flushRatingsBatch(db, batch) {
    if (!batch.length) return;

    await db.batch(() => {
        for (const item of batch) {
            db.putSync(ratingKey(item.id), {
                rating: item.rating,
                votes: item.votes,
            });
        }
    });

    batch.length = 0;
}

async function flushEpisodesBatch(db, batch) {
    if (!batch.length) return;

    await db.batch(() => {
        for (const item of batch) {
            db.putSync(episodeKey(item.showId, item.season, item.episode), item.episodeId);
        }
    });

    batch.length = 0;
}

async function loadRatings() {
    logger.info('[IMDb LMDB] Loading ratings dataset into LMDB...');

    const db = getRatingsDb();
    const rl = readline.createInterface({ input: createDatasetStream(ratingsFilePath()) });
    const batch = [];
    let count = 0;

    for await (const line of rl) {
        if (!line || line.startsWith('tconst')) continue;

        const [id, rating, votes] = line.split('\t');
        if (!id || !rating || rating === '\\N') continue;

        const numeric = parseFloat(rating);
        if (!Number.isFinite(numeric)) continue;

        batch.push({
            id,
            rating: numeric,
            votes: Number.isFinite(parseInt(votes, 10)) ? parseInt(votes, 10) : null,
        });

        count++;

        if (batch.length >= config.imdbDataset.batchSize) {
            await flushRatingsBatch(db, batch);
        }

        if (count % 100000 === 0) {
            logger.info(`[IMDb LMDB] Ratings loaded: ${count}`);
        }
    }

    await flushRatingsBatch(db, batch);
    logger.info(`[IMDb LMDB] Ratings DONE: ${count}`);
    return count;
}

async function loadEpisodes() {
    logger.info('[IMDb LMDB] Loading episode mapping dataset into LMDB...');

    const db = getEpisodesDb();
    const rl = readline.createInterface({ input: createDatasetStream(episodesFilePath()) });
    const batch = [];
    let count = 0;

    for await (const line of rl) {
        if (!line || line.startsWith('tconst')) continue;

        const [episodeId, showId, season, episode] = line.split('\t');
        if (!episodeId || !showId || !season || !episode) continue;
        if (season === '\\N' || episode === '\\N') continue;

        batch.push({
            episodeId,
            showId,
            season,
            episode,
        });

        count++;

        if (batch.length >= config.imdbDataset.batchSize) {
            await flushEpisodesBatch(db, batch);
        }

        if (count % 100000 === 0) {
            logger.info(`[IMDb LMDB] Episode mappings loaded: ${count}`);
        }
    }

    await flushEpisodesBatch(db, batch);
    logger.info(`[IMDb LMDB] Episode mappings DONE: ${count}`);
    return count;
}

async function getHotCachedEpisodeRating(key) {
    if (!redisClient.isReady()) return null;

    const client = redisClient.getClient();
    if (!client) return null;

    try {
        const cached = await client.get(key);
        return cached ? JSON.parse(cached) : null;
    } catch (err) {
        logger.debug(`[IMDb LMDB] Hot cache read skipped for ${key}: ${err.message}`);
        return null;
    }
}

async function setHotCachedEpisodeRating(key, value) {
    if (!redisClient.isReady()) return;

    const client = redisClient.getClient();
    if (!client) return;

    try {
        await client.set(key, JSON.stringify(value), {
            EX: config.imdbDataset.hotCacheTtlSeconds,
        });
    } catch (err) {
        logger.debug(`[IMDb LMDB] Hot cache write skipped for ${key}: ${err.message}`);
    }
}

async function getEpisodeRating(showId, season, episode) {
    try {
        if (config.imdbDataset.mode === 'disabled') return null;

        const cacheKey = hotCacheKey(showId, season, episode);
        const cached = await getHotCachedEpisodeRating(cacheKey);
        if (cached) return cached;

        const episodeId = getEpisodesDb().get(episodeKey(showId, season, episode));
        if (!episodeId) return null;

        const rating = getRatingsDb().get(ratingKey(episodeId));
        if (!rating || !Number.isFinite(rating.rating)) return null;

        const result = {
            source: 'IMDb Episode',
            value: `${rating.rating.toFixed(1)}/10`,
        };

        await setHotCachedEpisodeRating(cacheKey, result);
        return result;
    } catch (err) {
        logger.error(`[IMDb LMDB] Episode rating error: ${err.message}`);
        return null;
    }
}

async function getTitleRating(imdbId) {
    try {
        if (config.imdbDataset.mode === 'disabled') return null;

        const baseId = String(imdbId || '').split(':')[0];
        if (!/^tt\d+$/.test(baseId)) return null;

        const rating = getRatingsDb().get(ratingKey(baseId));
        if (!rating || !Number.isFinite(rating.rating)) return null;

        return {
            source: 'IMDb',
            value: `${rating.rating.toFixed(1)}/10`,
        };
    } catch (err) {
        logger.error(`[IMDb LMDB] Title rating error: ${err.message}`);
        return null;
    }
}

async function init() {
    try {
        if (config.imdbDataset.mode === 'disabled') {
            logger.info('[IMDb LMDB] Dataset init disabled by IMDB_DATASET_MODE.');
            return false;
        }

        if (!datasetFilesAvailable()) {
            const message = `[IMDb LMDB] Dataset files not mounted at ${ratingsFilePath()} and ${episodesFilePath()}.`;
            if (isDatasetOptional()) {
                logger.info(`${message} Skipping because IMDB_DATASET_MODE=${config.imdbDataset.mode}.`);
                return false;
            }

            throw new Error(message);
        }

        const metaDb = getMetaDb();
        const currentVersion = datasetVersion();
        const currentVersionKey = stableVersionKey(currentVersion);
        const existingVersionKey = metaDb.get(META_VERSION_KEY);
        const existingStatus = metaDb.get(META_STATUS_KEY);

        if (existingStatus === 'ready' && existingVersionKey === currentVersionKey) {
            logger.info('[IMDb LMDB] Dataset already loaded. Skipping.');
            return true;
        }

        logger.info('[IMDb LMDB] Starting dataset initialization...');
        await metaDb.put(META_STATUS_KEY, 'loading');

        await getRatingsDb().clearAsync();
        await getEpisodesDb().clearAsync();

        const ratingsCount = await loadRatings();
        const episodesCount = await loadEpisodes();

        await metaDb.put(META_VERSION_KEY, currentVersionKey);
        await metaDb.put(META_STATUS_KEY, 'ready');

        logger.info(`[IMDb LMDB] Dataset initialization COMPLETE: ${ratingsCount} ratings, ${episodesCount} episode mappings`);
        return true;
    } catch (err) {
        logger.error(`[IMDb LMDB] Init failed: ${err.message}`);

        try {
            await getMetaDb().put(META_STATUS_KEY, 'error');
        } catch (metaErr) {
            logger.debug(`[IMDb LMDB] Could not persist error status: ${metaErr.message}`);
        }

        return false;
    }
}

module.exports = {
    init,
    getEpisodeRating,
    getTitleRating,
};
