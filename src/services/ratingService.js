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
const inFlightRequests = new Map();

// Provider strategy:
// - Local IMDb LMDB and native TMDb stay authoritative for their own families.
// - MDBList is the primary aggregation layer and drives derived safety metadata.
// - PublicMetaDB is a fallback aggregation layer when MDBList is unavailable or empty.
// - Jikan is kept as the anime/MAL recovery path.
const primaryAggregateProviders = [
    providers.mdblistProvider,
].filter(Boolean);

const fallbackAggregateProviders = [
    providers.publicMetaDbProvider,
].filter(Boolean);

function publicMetaDbFallbackMode() {
    return config.publicMetaDbFallbackMode || 'auto';
}

function shouldResolveFallbackAggregate(hasPrimaryRatings) {
    const mode = publicMetaDbFallbackMode();

    if (mode === 'off') return false;
    if (mode === 'force') return true;

    return !hasPrimaryRatings;
}

function safetySourceMode(userConfig = config.userConfig) {
    return userConfig?.ratings?.safetySource || config.ratings?.safetySource || 'hybrid';
}

function shouldUseDirectSafety(userConfig = config.userConfig) {
    const mode = safetySourceMode(userConfig);
    return mode === 'direct' || mode === 'hybrid';
}

function shouldUseMdblistKeywordSafety(ctx, userConfig = config.userConfig) {
    const mode = safetySourceMode(userConfig);
    if (mode === 'direct') return false;
    if (ctx?.isEpisode) return false;
    return true;
}

function splitSafetyBlock(result) {
    if (!result?.value) return [];

    return String(result.value)
        .split('\n')
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => {
            if (/parent safe/i.test(value) && !/not parent safe/i.test(value)) {
                return { source: 'Parent Safe', value };
            }

            if (/not parent safe|not safe/i.test(value)) {
                return { source: 'Not Safe', value };
            }

            if (/sexual violence/i.test(value)) {
                return { source: 'Sexual Violence', value };
            }

            if (/sex|nudity/i.test(value)) {
                return { source: 'Sex & Nudity', value };
            }

            return null;
        })
        .filter(Boolean);
}

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

function elapsedMs(startedAt) {
    return Date.now() - startedAt;
}

async function resolveImdbRatings(type, _rawId, ctx) {
    const results = [];

    async function resolveShowOrMovieRating() {
        const imdbTitle = await imdbDataset.getTitleRating(ctx.imdbId);

        if (imdbTitle && isDisplayableRatingValue(imdbLabel(type, false), imdbTitle.value)) {
            logger.info('IMDb title rating found in LMDB');
            return {
                source: imdbLabel(type, false),
                value: imdbTitle.value,
            };
        }

        logger.info('IMDb title rating not found in LMDB');
        return null;
    }

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
                logger.info('IMDb Episode rating not found, falling back to IMDb show/movie');

                const imdbShow = await resolveShowOrMovieRating();

                if (imdbShow) {
                    results.push(imdbShow);
                }
            }
        } catch (err) {
            logger.warn(`IMDb episode/show resolution failed: ${err.message}`);
        }

        return results;
    }

    try {
        const imdbShow = await resolveShowOrMovieRating();

        if (imdbShow) {
            results.push(imdbShow);
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

async function resolveDirectSafetyRatings(type, rawId, streamInfo, userConfig = config.userConfig) {
    if (!shouldUseDirectSafety(userConfig)) return [];

    const results = [];
    const timings = {
        commonSense: 0,
        cringe: 0,
    };

    if (providers.commonSenseProvider) {
        const startedAt = Date.now();
        try {
            const commonSense = await providers.commonSenseProvider.getBoth(type, rawId, streamInfo);
            if (commonSense?.ageRating) {
                results.push(commonSense.ageRating);
            }
            // Common Sense category headings are useful for age context, but too broad
            // for direct warning extraction without severity parsing.
        } catch (err) {
            logger.warn(`Common Sense direct safety failed for ${rawId}: ${err.message}`);
        } finally {
            timings.commonSense = elapsedMs(startedAt);
        }
    }

    if (providers.cringeMdbProvider) {
        const startedAt = Date.now();
        try {
            const cringe = await providers.cringeMdbProvider.getRating(type, rawId, streamInfo);
            results.push(...splitSafetyBlock(cringe));
        } catch (err) {
            logger.warn(`CringeMDB direct safety failed for ${rawId}: ${err.message}`);
        } finally {
            timings.cringe = elapsedMs(startedAt);
        }
    }

    logger.info(
        `[DirectSafety] ${rawId}: commonSense=${timings.commonSense}ms ` +
        `cringe=${timings.cringe}ms results=${results.length}`
    );

    return results;
}

function hasEnabledAggregateResults(results, type, userConfig = config.userConfig) {
    const ratingsConfig = userConfig?.ratings || config.ratings;

    return flattenResults(results).some(item => {
        const processed = processSingleRating(item, type);
        return processed && sourceMatchesEnabled(processed.source, ratingsConfig.enabled);
    });
}

function hasTransientProviderIssue(results) {
    return flattenResults(results).some(item =>
        item?._providerStatus?.transient === true
    );
}

async function resolveRatingsFresh(type, rawId, ctx, userConfig, cacheKey) {
    logger.info(`Fetching ratings for ${ctx.imdbId} (${type})`);

    const requestStartedAt = Date.now();
    const timings = {};

    const tmdbFindStartedAt = Date.now();
    const { tmdbId, name, date, rating } = await getTmdbData(ctx.imdbId, type, userConfig);
    timings.tmdbFind = elapsedMs(tmdbFindStartedAt);

    const streamInfo = {
        name,
        year: date ? new Date(date).getFullYear().toString() : null,
        date,
        season: ctx.season,
        episode: ctx.episode,
        isEpisode: ctx.isEpisode,
        tmdbFindRating: rating,
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

    logger.info(`Resolved safety source ${safetySourceMode(userConfig)} for ${rawId}`);

    const imdbPromise = (async () => {
        const startedAt = Date.now();
        const result = await resolveImdbRatings(type, rawId, ctx, streamInfo, tmdbId);
        timings.imdb = elapsedMs(startedAt);
        return result;
    })();

    const tmdbPromise = (async () => {
        const startedAt = Date.now();
        const result = await resolveTmdbRatings(type, rawId, ctx, streamInfo, tmdbId, userConfig);
        timings.tmdbRating = elapsedMs(startedAt);
        return result;
    })();

    const aggregateRawId = ctx.isEpisode ? showRawId : rawId;
    const aggregateStreamInfo = ctx.isEpisode ? showStreamInfo : streamInfo;
    const primaryAggregatePromise = (async () => {
        const startedAt = Date.now();
        const result = await resolvePrimaryAggregateRatings(
            type,
            aggregateRawId,
            aggregateStreamInfo,
            tmdbId,
            userConfig
        );
        timings.mdblist = elapsedMs(startedAt);
        return result;
    })();

    const directSafetyPromise = (async () => {
        const startedAt = Date.now();
        const result = await resolveDirectSafetyRatings(
            type,
            rawId,
            streamInfo,
            userConfig
        );
        timings.directSafety = elapsedMs(startedAt);
        return result;
    })();

    const [
        imdbResults,
        tmdbResults,
        primaryAggregateResults,
        directSafetyResults,
    ] = await Promise.all([
        imdbPromise,
        tmdbPromise,
        primaryAggregatePromise,
        directSafetyPromise,
    ]);

    const mdblistResults = Array.isArray(primaryAggregateResults)
        ? primaryAggregateResults
        : [];
    const primaryAggregateTransient = hasTransientProviderIssue(mdblistResults);
    const hasMdblistRatings = hasEnabledAggregateResults(mdblistResults, type, userConfig);
    const pmdbFallbackMode = publicMetaDbFallbackMode();
    const shouldUsePublicMetaDbFallback = shouldResolveFallbackAggregate(hasMdblistRatings);

    logger.info(
        `[PublicMetaDB] Fallback mode ${pmdbFallbackMode} ` +
        `(hasMdblistRatings=${hasMdblistRatings ? 'true' : 'false'}, ` +
        `willFetch=${shouldUsePublicMetaDbFallback ? 'true' : 'false'})`
    );

    const fallbackAggregateResults = shouldUsePublicMetaDbFallback
        ? await (async () => {
            const startedAt = Date.now();
            const result = await resolveFallbackAggregateRatings(
                type,
                aggregateRawId,
                aggregateStreamInfo,
                tmdbId,
                userConfig
            );
            timings.publicMetaDb = elapsedMs(startedAt);
            return result;
        })()
        : [];
    const metaResults = Array.isArray(fallbackAggregateResults)
        ? fallbackAggregateResults
        : [];

    const mdblistDerivedResults = safetySourceMode(userConfig) === 'direct'
        ? []
        : deriveMdblistSafetyResults(mdblistResults, {
            useKeywordWarnings: shouldUseMdblistKeywordSafety(ctx, userConfig),
            type,
            isEpisode: ctx.isEpisode,
        });

    const malStartedAt = Date.now();
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
    timings.mal = elapsedMs(malStartedAt);

    const finalRatings = finalizeRatings({
        type,
        imdbResults,
        tmdbResults,
        malResults,
        directSafetyResults,
        mdblistDerivedResults,
        metaResults,
        mdblistResults,
        userConfig,
    });

    logger.info(`Resolved ${finalRatings.length} unique ratings for ${rawId}`);
    logger.info(
        `[Timing] ${rawId}: ` +
        `tmdbFind=${timings.tmdbFind ?? 0}ms ` +
        `imdb=${timings.imdb ?? 0}ms ` +
        `tmdb=${timings.tmdbRating ?? 0}ms ` +
        `directSafety=${timings.directSafety ?? 0}ms ` +
        `mdblist=${timings.mdblist ?? 0}ms ` +
        `pmdb=${timings.publicMetaDb ?? 0}ms ` +
        `mal=${timings.mal ?? 0}ms ` +
        `total=${elapsedMs(requestStartedAt)}ms`
    );
    logger.debug(`[Ratings] Final ratings: ${JSON.stringify(finalRatings)}`);

    if (redisClient.isReady()) {
        try {
            if (primaryAggregateTransient) {
                logger.warn(`Skipping cache write for ${rawId} because a primary aggregate provider had a transient failure`);
            } else if (finalRatings.length > 0) {
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

function getInFlightRequestCount() {
    return inFlightRequests.size;
}

async function runWithInFlight(cacheKey, label, factory) {
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
        logger.info(`Joining in-flight ratings request for ${label}`);
        return inFlight;
    }

    const requestPromise = factory();
    inFlightRequests.set(cacheKey, requestPromise);

    try {
        return await requestPromise;
    } finally {
        if (inFlightRequests.get(cacheKey) === requestPromise) {
            inFlightRequests.delete(cacheKey);
        }
    }
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

    return runWithInFlight(
        cacheKey,
        rawId,
        () => resolveRatingsFresh(type, rawId, ctx, userConfig, cacheKey)
    );
}

module.exports = {
    getRatings,
    hasTransientProviderIssue,
    getInFlightRequestCount,
    runWithInFlight,
    publicMetaDbFallbackMode,
    shouldResolveFallbackAggregate,
};
