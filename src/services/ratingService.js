const redisClient = require('../cache/redisClient');
const config = require('../config');
const logger = require('../utils/logger');
const { getTmdbData } = require('../utils/tmdbService');
const providers = require('../providers');
const imdbDataset = require('../utils/imdbLmdbDataset');
const { parseMediaContext } = require('../utils/mediaContext');
const {
    imdbLabel,
    tmdbLabel,
    isDisplayableRatingValue,
    processSingleRating,
    flattenResults,
    sourceMatchesEnabled,
} = require('./ratingHelpers');
const {
    deriveMdblistSafetyResults,
} = require('./deriveSafety');
const {
    resolveMalRatings,
} = require('./resolveMal');
const {
    finalizeRatings,
} = require('./finalizeRatings');

const CACHE_PREFIX = 'ratings:';
const NO_RATINGS_MARKER = '___NO_RATINGS___';

// Provider strategy:
// - Native IMDb / TMDb stay authoritative for their own families.
// - MDBList is the primary aggregation layer and drives derived safety metadata.
// - PublicMetaDB is a fallback aggregation layer when MDBList is unavailable or empty.
// - Jikan is kept as the anime/MAL recovery path.
const primaryAggregateProviders = [
    providers.mdblistProvider,
].filter(Boolean);

const fallbackAggregateProviders = [
    providers.publicMetaDbProvider,
].filter(Boolean);

function calculateTTL(releaseDate, numRatings) {
    if (!releaseDate) return config.cache.ttlSeconds;

    const now = Date.now();
    const released = new Date(releaseDate).getTime();
    const ageDays = Math.floor((now - released) / (1000 * 60 * 60 * 24));

    let ttl = (() => {
        if (ageDays <= 14) return 1 * 86400;
        if (ageDays <= 30) return 7 * 86400;
        if (ageDays <= 90) return 30 * 86400;
        if (ageDays <= 180) return 60 * 86400;
        if (ageDays <= 365) return 120 * 86400;
        if (ageDays <= 730) return 240 * 86400;
        if (ageDays <= 1460) return 730 * 86400;
        return 1460 * 86400;
    })();

    if (numRatings <= 3) ttl = Math.min(ttl, 3 * 86400);

    return ttl;
}

async function resolveImdbRatings(type, rawId, ctx, streamInfo, tmdbId) {
    const results = [];

    if (ctx.isEpisode) {
        try {
            const imdbEpisode = await imdbDataset.getEpisodeRating(
                ctx.imdbId,
                ctx.season,
                ctx.episode
            );

            if (imdbEpisode && isDisplayableRatingValue(imdbLabel(type, true), imdbEpisode.value)) {
                logger.info('IMDb Episode rating found');
                results.push({
                    source: imdbLabel(type, true),
                    value: imdbEpisode.value,
                });
            } else {
                logger.info('IMDb Episode rating not found, falling back to native IMDb show/movie');

                const imdbShow = await providers.imdbProvider?.getRating(
                    type,
                    rawId,
                    { ...streamInfo, isEpisode: false, season: null, episode: null },
                    tmdbId
                );

                if (imdbShow && isDisplayableRatingValue(imdbLabel(type, false), imdbShow.value)) {
                    results.push({
                        source: imdbLabel(type, false),
                        value: imdbShow.value,
                    });
                }
            }
        } catch (err) {
            logger.warn(`IMDb episode/show resolution failed: ${err.message}`);
        }

        return results;
    }

    try {
        const imdbShow = await providers.imdbProvider?.getRating(
            type,
            rawId,
            streamInfo,
            tmdbId
        );

        if (imdbShow && isDisplayableRatingValue(imdbLabel(type, false), imdbShow.value)) {
            results.push({
                source: imdbLabel(type, false),
                value: imdbShow.value,
            });
        }
    } catch (err) {
        logger.warn(`IMDb show/movie resolution failed: ${err.message}`);
    }

    return results;
}

async function resolveTmdbRatings(type, rawId, ctx, streamInfo, tmdbId, userConfig = config.userConfig) {
    const results = [];

    if (!tmdbId) {
        logger.info('TMDb ID not found, skipping native TMDb resolution');
        return results;
    }

    if (ctx.isEpisode) {
        try {
            const tmdbEpisode = await providers.tmdbProvider.getRating(
                type,
                rawId,
                streamInfo,
                tmdbId,
                userConfig
            );

            if (
                tmdbEpisode &&
                tmdbEpisode.source === 'TMDb Episode' &&
                isDisplayableRatingValue(tmdbLabel(type, true), tmdbEpisode.value)
            ) {
                logger.info('TMDb Episode rating found');
                results.push({
                    source: tmdbLabel(type, true),
                    value: tmdbEpisode.value,
                });
            } else {
                logger.info('TMDb Episode rating not found or invalid, falling back to native TMDb show/movie');

                const tmdbShow = await providers.tmdbProvider.getRating(
                    type,
                    ctx.imdbId,
                    { ...streamInfo, isEpisode: false, season: null, episode: null },
                    tmdbId,
                    userConfig
                );

                if (tmdbShow && isDisplayableRatingValue(tmdbLabel(type, false), tmdbShow.value)) {
                    results.push({
                        source: tmdbLabel(type, false),
                        value: tmdbShow.value,
                    });
                }
            }
        } catch (err) {
            logger.warn(`TMDb episode/show resolution failed: ${err.message}`);
        }

        return results;
    }

    try {
        const tmdbShow = await providers.tmdbProvider.getRating(
            type,
            rawId,
            streamInfo,
            tmdbId,
            userConfig
        );

        if (tmdbShow && isDisplayableRatingValue(tmdbLabel(type, false), tmdbShow.value)) {
            results.push({
                source: tmdbLabel(type, false),
                value: tmdbShow.value,
            });
        }
    } catch (err) {
        logger.warn(`TMDb show/movie resolution failed: ${err.message}`);
    }

    return results;
}

async function resolvePrimaryAggregateRatings(type, rawId, streamInfo, tmdbId, userConfig = config.userConfig) {
    const callableProviders = primaryAggregateProviders.filter(Boolean);

    if (!callableProviders.length) return [];

    return Promise.all(
        callableProviders.map((provider) =>
            provider.getRating(type, rawId, streamInfo, tmdbId, userConfig).catch((err) => {
                logger.error(`Error from ${provider.name} for ${rawId}: ${err.message}`);
                return null;
            })
        )
    );
}

async function resolveFallbackAggregateRatings(type, rawId, streamInfo, tmdbId, userConfig = config.userConfig) {
    const callableProviders = fallbackAggregateProviders.filter(Boolean);

    if (!callableProviders.length) return [];

    return Promise.all(
        callableProviders.map((provider) =>
            provider.getRating(type, rawId, streamInfo, tmdbId, userConfig).catch((err) => {
                logger.error(`Error from ${provider.name} for ${rawId}: ${err.message}`);
                return null;
            })
        )
    );
}

function hasEnabledAggregateResults(results, type, userConfig = config.userConfig) {
    const ratingsConfig = userConfig?.ratings || config.ratings;

    return flattenResults(results).some(item => {
        const processed = processSingleRating(item, type);
        return processed && sourceMatchesEnabled(processed.source, ratingsConfig.enabled);
    });
}

async function getRatings(type, rawId, options = {}) {
    const userConfig = options.userConfig || config.userConfig;
    const ctx = parseMediaContext(type, rawId);
    if (!ctx) return null;

    const cacheScope = userConfig?.cacheKey || 'default';
    const cacheKey = `${CACHE_PREFIX}${cacheScope}:${type}:${rawId}`;

    if (redisClient.isReady()) {
        try {
            const cached = await redisClient.getRatingsHashOrMarker(cacheKey);

            if (cached === NO_RATINGS_MARKER) {
                logger.debug(`Negative cache hit for ${rawId}`);
                return null;
            }

            if (cached) {
                logger.debug(`Cache hit for ${rawId}`);
                return cached;
            }

            logger.debug(`Cache miss for ${rawId}`);
        } catch (err) {
            logger.error(`Cache error (${cacheKey}): ${err.message}`);
        }
    }

    logger.info(`Fetching ratings for ${ctx.imdbId} (${type})`);

    const { tmdbId, name, date } = await getTmdbData(ctx.imdbId, type, userConfig);

    const streamInfo = {
        name,
        year: date ? new Date(date).getFullYear().toString() : null,
        date,
        season: ctx.season,
        episode: ctx.episode,
        isEpisode: ctx.isEpisode,
    };

    const showStreamInfo = {
        ...streamInfo,
        isEpisode: false,
        season: null,
        episode: null,
    };

    const showRawId = ctx.imdbId;

    if (ctx.isEpisode) {
        logger.info(`[Episode Mode] S${ctx.season}E${ctx.episode}`);
    }

    const imdbPromise = resolveImdbRatings(type, rawId, ctx, streamInfo, tmdbId);
    const tmdbPromise = resolveTmdbRatings(type, rawId, ctx, streamInfo, tmdbId, userConfig);

    const aggregateRawId = ctx.isEpisode ? showRawId : rawId;
    const aggregateStreamInfo = ctx.isEpisode ? showStreamInfo : streamInfo;
    const primaryAggregatePromise = resolvePrimaryAggregateRatings(
        type,
        aggregateRawId,
        aggregateStreamInfo,
        tmdbId,
        userConfig
    );

    const [
        imdbResults,
        tmdbResults,
        primaryAggregateResults,
    ] = await Promise.all([
        imdbPromise,
        tmdbPromise,
        primaryAggregatePromise,
    ]);

    const mdblistResults = Array.isArray(primaryAggregateResults)
        ? primaryAggregateResults
        : [];
    const hasMdblistRatings = hasEnabledAggregateResults(mdblistResults, type, userConfig);
    const fallbackAggregateResults = hasMdblistRatings
        ? []
        : await resolveFallbackAggregateRatings(
            type,
            aggregateRawId,
            aggregateStreamInfo,
            tmdbId,
            userConfig
        );
    const metaResults = Array.isArray(fallbackAggregateResults)
        ? fallbackAggregateResults
        : [];

    const mdblistDerivedResults = deriveMdblistSafetyResults(mdblistResults);

    const malResults = await resolveMalRatings(
        type,
        rawId,
        ctx,
        streamInfo,
        tmdbId,
        mdblistResults,
        metaResults,
        userConfig
    );

    const finalRatings = finalizeRatings({
        type,
        imdbResults,
        tmdbResults,
        malResults,
        mdblistDerivedResults,
        metaResults,
        mdblistResults,
        userConfig,
    });

    logger.info(`Resolved ${finalRatings.length} unique ratings for ${rawId}`);
    logger.debug(`[Ratings] Final ratings: ${JSON.stringify(finalRatings)}`);

    if (redisClient.isReady()) {
        try {
            if (finalRatings.length > 0) {
                const ttl = calculateTTL(date, finalRatings.length);
                const ok = await redisClient.setRatingsHash(cacheKey, finalRatings, ttl);

                if (ok) {
                    logger.debug(`Cached ${rawId} for ${ttl}s`);
                } else {
                    logger.warn(`Failed to cache ratings for ${rawId}`);
                }
            } else {
                const ok = await redisClient.setNegativeMarker(
                    cacheKey,
                    NO_RATINGS_MARKER,
                    config.cache.negativeTtlSeconds
                );

                if (ok) {
                    logger.debug(`Negative marker cached for ${rawId}`);
                } else {
                    logger.warn(`Failed to cache negative marker for ${rawId}`);
                }
            }
        } catch (err) {
            logger.error(`Cache write error (${cacheKey}): ${err.message}`);
        }
    }

    return finalRatings.length ? finalRatings : null;
}

module.exports = { getRatings };
