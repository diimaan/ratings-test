const redisClient = require('../cache/redisClient');
const config = require('../config');
const logger = require('../utils/logger');
const { getTmdbData } = require('../utils/tmdbService');
const providers = require('../providers');
const imdbDataset = require('../utils/imdbRedisDataset');
const { parseMediaContext } = require('../utils/mediaContext');

const CACHE_PREFIX = 'ratings:';
const NO_RATINGS_MARKER = '___NO_RATINGS___';

const activeMetaProviders = [
    providers.publicMetaDbProvider,
].filter(Boolean);

const fallbackProviders = [
    providers.mdblistProvider,
].filter(Boolean);

const RATING_PRIORITY = {
    'Common Sense': ['MDBDERIVED'],
    'Not Safe': ['MDBDERIVED'],
    'Sexual Violence': ['MDBDERIVED'],
    'Sex & Nudity': ['MDBDERIVED'],
    IMDb: ['NATIVE', 'PMDB', 'MDBLIST'],
    TMDb: ['NATIVE', 'PMDB', 'MDBLIST'],
    MAL: ['JIKAN_ID', 'MDBLIST', 'PMDB'],
    Letterboxd: ['MDBLIST', 'PMDB'],
    MDBList: ['MDBLIST'],
    MC: ['PMDB', 'MDBLIST'],
    RT: ['PMDB', 'MDBLIST'],
    PC: ['PMDB', 'MDBLIST'],
    Trakt: ['PMDB', 'MDBLIST'],
    'Roger Ebert': ['MDBLIST', 'PMDB'],
};

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

function imdbLabel(type, isEpisode) {
    if (isEpisode) return 'IMDb (Episode)';
    return type === 'series' ? 'IMDb (Show)' : 'IMDb (Movie)';
}

function tmdbLabel(type, isEpisode) {
    if (isEpisode) return 'TMDb (Episode)';
    return type === 'series' ? 'TMDb (Show)' : 'TMDb (Movie)';
}

function normalizeOtherSourceLabel(source, type) {
    const s = String(source || '').trim();

    if (s === 'IMDb') return imdbLabel(type, false);
    if (s === 'IMDb Episode') return imdbLabel(type, true);

    if (s === 'TMDb') return tmdbLabel(type, false);
    if (s === 'TMDb Episode') return tmdbLabel(type, true);

    return s;
}

function sourceFamily(label) {
    if (!label) return null;
    if (label === 'Common Sense') return 'Common Sense';
    if (label === 'Not Safe') return 'Not Safe';
    if (label === 'Sexual Violence') return 'Sexual Violence';
    if (label === 'Sex & Nudity') return 'Sex & Nudity';
    if (label.startsWith('IMDb (')) return 'IMDb';
    if (label.startsWith('TMDb (')) return 'TMDb';
    if (label === 'MC') return 'MC';
    if (label === 'RT') return 'RT';
    if (label === 'PC') return 'PC';
    if (label === 'MDBList') return 'MDBList';
    if (label === 'Trakt') return 'Trakt';
    if (label === 'MAL') return 'MAL';
    if (label === 'Letterboxd') return 'Letterboxd';
    if (label === 'Roger Ebert') return 'Roger Ebert';
    return label;
}

function numericPrefix(value) {
    const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
}

function isRogerEbertStars(value) {
    const text = String(value || '').trim();
    return /^[⭐✨]+$/.test(text) && text.includes('⭐');
}

function looksLikeSafetyBlock(value) {
    const text = String(value || '').trim();
    if (!text) return false;

    return /⚠️|🫣|💔/.test(text);
}

function isDisplayableRatingValue(source, value) {
    if (value === null || value === undefined) return false;

    const text = String(value).trim();
    if (!text) return false;

    if (
        source === 'Common Sense' ||
        source === 'Not Safe' ||
        source === 'Sexual Violence' ||
        source === 'Sex & Nudity'
    ) {
        return true;
    }

    if (source === 'Roger Ebert' && isRogerEbertStars(text)) {
        return true;
    }

    const num = numericPrefix(text);
    if (!Number.isFinite(num)) return false;

    return num > 0;
}

function processSingleRating(rating, type) {
    if (!rating || rating._raw) return null;
    if (!rating.source || rating.value === undefined || rating.value === null) return null;

    const source = normalizeOtherSourceLabel(rating.source, type);
    const value = String(rating.value).trim();

    if (!isDisplayableRatingValue(source, value)) {
        return null;
    }

    return { source, value };
}

function sourceMatchesEnabled(source, enabledList) {
    if (!enabledList?.length) return true;
    if (enabledList.includes(source)) return true;

    const aliases = {
        'IMDb': ['IMDb (Movie)', 'IMDb (Show)', 'IMDb (Episode)'],
        'IMDb Episode': ['IMDb (Episode)'],
        'TMDb': ['TMDb (Movie)', 'TMDb (Show)', 'TMDb (Episode)'],
        'TMDb Episode': ['TMDb (Episode)'],
    };

    for (const [alias, expanded] of Object.entries(aliases)) {
        if (enabledList.includes(alias) && expanded.includes(source)) {
            return true;
        }
    }

    return false;
}

function orderIndexForSource(source, orderList) {
    if (!orderList?.length) return Number.MAX_SAFE_INTEGER;

    const aliases = {
        'IMDb': ['IMDb (Movie)', 'IMDb (Show)', 'IMDb (Episode)'],
        'IMDb Episode': ['IMDb (Episode)'],
        'TMDb': ['TMDb (Movie)', 'TMDb (Show)', 'TMDb (Episode)'],
        'TMDb Episode': ['TMDb (Episode)'],
    };

    let best = Number.MAX_SAFE_INTEGER;

    orderList.forEach((entry, index) => {
        if (entry === source) {
            best = Math.min(best, index);
        }

        const expanded = aliases[entry];
        if (expanded && expanded.includes(source)) {
            best = Math.min(best, index);
        }
    });

    return best;
}

function pickFirstValidFromArray(items, family, type) {
    if (!Array.isArray(items)) return null;

    for (const item of items) {
        const processed = processSingleRating(item, type);
        if (!processed) continue;
        if (sourceFamily(processed.source) !== family) continue;
        return processed;
    }

    return null;
}

function findMdblistRawPayload(mdblistResults) {
    if (!Array.isArray(mdblistResults)) return null;
    const rawEntry = mdblistResults.find(item => item && item._raw && typeof item._raw === 'object');
    return rawEntry?._raw || null;
}

function flattenResults(results) {
    return results
        .filter(Boolean)
        .flatMap(r => (Array.isArray(r) ? r : [r]));
}

function selectFamilyResult(family, candidates, type) {
    for (const candidate of candidates) {
        const picked = pickFirstValidFromArray(candidate, family, type);
        if (picked) return picked;
    }
    return null;
}

function isLikelyAnimeFromMdblistRaw(mdblistRaw) {
    if (!mdblistRaw || typeof mdblistRaw !== 'object') return false;

    if (mdblistRaw?.ids?.mal) return true;

    const language = String(mdblistRaw.language || '').toLowerCase();
    if (language === 'ja') return true;

    if (Array.isArray(mdblistRaw.genres)) {
        const hasAnimeGenre = mdblistRaw.genres.some(g =>
            /anime/i.test(String(g?.title || ''))
        );
        if (hasAnimeGenre) return true;
    }

    return false;
}

function normalizeKeywordName(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function getMdblistKeywordNames(mdblistRaw) {
    if (!Array.isArray(mdblistRaw?.keywords)) return [];

    return [...new Set(
        mdblistRaw.keywords
            .map(item => normalizeKeywordName(item?.name))
            .filter(Boolean)
    )];
}

function deriveMdblistSafetyResults(mdblistResults) {
    const mdblistFlat = flattenResults(mdblistResults);
    const mdblistRaw = findMdblistRawPayload(mdblistFlat);

    if (!mdblistRaw || typeof mdblistRaw !== 'object') {
        return [];
    }

    const results = [];

    const commonSense = Number(mdblistRaw?.commonsense_media?.common_sense ?? mdblistRaw?.age_rating);
    const parentalNudity = Number(mdblistRaw?.commonsense_media?.parental_nudity);
    const keywords = getMdblistKeywordNames(mdblistRaw);

    if (Number.isFinite(commonSense) && commonSense > 0) {
        results.push({
            source: 'Common Sense',
            value: `${commonSense}+`,
        });
    }

    const sexualViolencePatterns = [
        /\brape\b/i,
        /\bsexual-assault\b/i,
        /\bsexual-violence\b/i,
        /\battempted-rape\b/i,
        /\bgang-rape\b/i,
        /\bprison-rape\b/i,
        /\bdate-rape\b/i,
        /\brape-scene\b/i,
        /\brape-victim\b/i,
        /\bfemale-rape-victim\b/i,
        /\bmale-rape\b/i,
        /\bmale-rape-victim\b/i,
        /\bmale-on-female-rape\b/i,
        /\bfemale-on-male-rape\b/i,
        /\bbrutal-rape\b/i,
        /\banal-rape\b/i,
        /\bsimulated-rape\b/i,
        /\bsimulated-anal-rape\b/i,
        /\bgay-rape\b/i,
        /\binterracial-rape\b/i,
        /\bconsensual-sex-turns-to-rape\b/i,
        /\bsexual assault\b/i,
        /\bsexual violence\b/i,
    ];

    const sexNudityPatterns = [
        /\bsex-scene\b/i,
        /\bsex-scenes\b/i,
        /\bgraphic-sex-scene\b/i,
        /\bnudity\b/i,
        /\bfull-frontal-nudity\b/i,
        /\bfemale-frontal-nudity\b/i,
        /\bfemale-full-frontal-nudity\b/i,
        /\bfemale-nudity\b/i,
        /\bfemale-rear-nudity\b/i,
        /\bfemale-topless-nudity\b/i,
        /\bmale-frontal-nudity\b/i,
        /\bmale-full-frontal-nudity\b/i,
        /\bmale-nudity\b/i,
        /\bmale-rear-nudity\b/i,
        /\bpublic-nudity\b/i,
        /\boutdoor-nudity\b/i,
        /\bgraphic-nudity\b/i,
        /\bbrief-male-frontal-nudity\b/i,
        /\bbrief-male-full-frontal-nudity\b/i,
        /\blesbian-sex-scene\b/i,
    ];

    const hasSexualViolence = keywords.some(keyword =>
        sexualViolencePatterns.some(pattern => pattern.test(keyword))
    );

    const hasSexAndNudityKeyword = keywords.some(keyword =>
        sexNudityPatterns.some(pattern => pattern.test(keyword))
    );

    const hasSexAndNudity = (
        (Number.isFinite(parentalNudity) && parentalNudity >= 4) ||
        hasSexAndNudityKeyword ||
        hasSexualViolence
    );

    if (hasSexualViolence || hasSexAndNudity) {
        results.push({
            source: 'Not Safe',
            value: '⚠️ Not Safe',
        });
    }

    if (hasSexualViolence) {
        results.push({
            source: 'Sexual Violence',
            value: '💔 Sexual Violence',
        });
    } else if (hasSexAndNudity) {
        results.push({
            source: 'Sex & Nudity',
            value: '🫣 Sex & Nudity',
        });
    }

    logger.debug(`[MDBSafety] Derived safety results: ${JSON.stringify(results)}`);

    return results;
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

async function resolveTmdbRatings(type, rawId, ctx, streamInfo, tmdbId) {
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
                tmdbId
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
                    tmdbId
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
            tmdbId
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

async function resolveMetaRatings(type, rawId, streamInfo, tmdbId) {
    const callableProviders = activeMetaProviders.filter(Boolean);

    if (!callableProviders.length) return [];

    return Promise.all(
        callableProviders.map((provider) =>
            provider.getRating(type, rawId, streamInfo, tmdbId).catch((err) => {
                logger.error(`Error from ${provider.name} for ${rawId}: ${err.message}`);
                return null;
            })
        )
    );
}

async function resolveMdblistFallbackRatings(type, rawId, streamInfo, tmdbId) {
    const callableProviders = fallbackProviders.filter(Boolean);

    if (!callableProviders.length) return [];

    return Promise.all(
        callableProviders.map((provider) =>
            provider.getRating(type, rawId, streamInfo, tmdbId).catch((err) => {
                logger.error(`Error from ${provider.name} for ${rawId}: ${err.message}`);
                return null;
            })
        )
    );
}

async function resolveMalRatings(type, rawId, ctx, streamInfo, tmdbId, mdblistResults, metaResults) {
    const lookupRawId = ctx.isEpisode ? ctx.imdbId : rawId;
    const lookupStreamInfo = ctx.isEpisode
        ? { ...streamInfo, isEpisode: false, season: null, episode: null }
        : streamInfo;

    const mdblistFlat = flattenResults(mdblistResults);
    const metaFlat = flattenResults(metaResults);

    const mdblistFamily = pickFirstValidFromArray(mdblistFlat, 'MAL', type);
    const mdblistRaw = findMdblistRawPayload(mdblistFlat);

    const looksAnime = isLikelyAnimeFromMdblistRaw(mdblistRaw);

    if (!looksAnime && mdblistRaw) {
        logger.info('Skipping MAL resolution for non-anime title');
        return [];
    }

    const malId = mdblistRaw?.ids?.mal;

    if (malId && providers.jikanProvider?.getByMalId) {
        try {
            const jikan = await providers.jikanProvider.getByMalId(malId);
            if (jikan && isDisplayableRatingValue('MAL', jikan.value)) {
                logger.info('MAL rating found via Jikan MAL ID');
                return [{
                    source: 'MAL',
                    value: jikan.value,
                }];
            }
        } catch (err) {
            logger.warn(`Jikan MAL ID lookup failed: ${err.message}`);
        }
    }

    if (mdblistFamily) {
        logger.info('MAL rating found via MDBList');
        return [mdblistFamily];
    }

    const pmdbFamily = pickFirstValidFromArray(metaFlat, 'MAL', type);
    if (pmdbFamily) {
        logger.info('MAL rating found via PMDB');
        return [pmdbFamily];
    }

    try {
        const jikanFallback = await providers.jikanProvider?.getRating(
            type,
            lookupRawId,
            lookupStreamInfo,
            tmdbId
        );

        if (jikanFallback && isDisplayableRatingValue('MAL', jikanFallback.value)) {
            logger.info('MAL rating found via Jikan search fallback');
            return [{
                source: 'MAL',
                value: jikanFallback.value,
            }];
        }
    } catch (err) {
        logger.warn(`Jikan fallback search failed: ${err.message}`);
    }

    logger.info('MAL rating not found');
    return [];
}

function finalizeRatings({
    type,
    imdbResults,
    tmdbResults,
    malResults,
    mdblistDerivedResults,
    metaResults,
    mdblistResults,
}) {
    const imdbFlat = flattenResults(imdbResults);
    const tmdbFlat = flattenResults(tmdbResults);
    const malFlat = flattenResults(malResults);
    const mdblistDerivedFlat = flattenResults(mdblistDerivedResults);
    const metaFlat = flattenResults(metaResults);
    const mdblistFlat = flattenResults(mdblistResults);

    const familyMap = new Map();

    const candidatesByFamily = {
        'Common Sense': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        'Not Safe': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        'Sexual Violence': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        'Sex & Nudity': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        IMDb: {
            NATIVE: imdbFlat,
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        TMDb: {
            NATIVE: tmdbFlat,
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        MC: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        RT: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        PC: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        Trakt: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        MAL: {
            JIKAN_ID: malFlat,
            MDBLIST: mdblistFlat,
            PMDB: metaFlat,
        },
        Letterboxd: {
            MDBLIST: mdblistFlat,
            PMDB: metaFlat,
        },
        'Roger Ebert': type === 'movie'
            ? {
                MDBLIST: mdblistFlat,
                PMDB: metaFlat,
            }
            : null,
        MDBList: {
            MDBLIST: mdblistFlat,
        },
    };

    for (const [family, order] of Object.entries(RATING_PRIORITY)) {
        const sources = candidatesByFamily[family];
        if (!sources) continue;

        let candidateArrays = order.map(step => sources[step]).filter(Boolean);

        if (
            family === 'Common Sense' ||
            family === 'Not Safe' ||
            family === 'Sexual Violence' ||
            family === 'Sex & Nudity'
        ) {
            candidateArrays = candidateArrays.map(arr =>
                Array.isArray(arr)
                    ? arr.filter(item => {
                        const processed = processSingleRating(item, type);
                        return processed?.source === family;
                    })
                    : arr
            );
        }

        const picked = selectFamilyResult(family, candidateArrays, type);

        if (picked && !familyMap.has(family)) {
            familyMap.set(family, picked);
        }
    }

    logger.debug(`[Ratings] familyMap before enabled filter: ${JSON.stringify(Array.from(familyMap.values()))}`);
    logger.debug(`[Ratings] enabled config: ${JSON.stringify(config.ratings.enabled)}`);

    const filtered = Array.from(familyMap.values()).filter(item =>
        sourceMatchesEnabled(item.source, config.ratings.enabled)
    );

    logger.debug(`[Ratings] after enabled filter: ${JSON.stringify(filtered)}`);

    filtered.sort((a, b) => {
        const aIndex = orderIndexForSource(a.source, config.ratings.order);
        const bIndex = orderIndexForSource(b.source, config.ratings.order);

        if (aIndex !== bIndex) return aIndex - bIndex;

        const aWarnings = looksLikeSafetyBlock(a.value);
        const bWarnings = looksLikeSafetyBlock(b.value);
        if (aWarnings !== bWarnings) return aWarnings ? 1 : -1;

        return a.source.localeCompare(b.source);
    });

    return filtered;
}

async function getRatings(type, rawId) {
    const ctx = parseMediaContext(type, rawId);
    if (!ctx) return null;

    const cacheKey = `${CACHE_PREFIX}${type}:${rawId}`;

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

    const { tmdbId, name, date } = await getTmdbData(ctx.imdbId, type);

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
    const tmdbPromise = resolveTmdbRatings(type, rawId, ctx, streamInfo, tmdbId);

    let metaPromise;
    let mdblistPromise;

    if (ctx.isEpisode) {
        metaPromise = resolveMetaRatings(type, showRawId, showStreamInfo, tmdbId);
        mdblistPromise = resolveMdblistFallbackRatings(type, showRawId, showStreamInfo, tmdbId);
    } else {
        metaPromise = resolveMetaRatings(type, rawId, streamInfo, tmdbId);
        mdblistPromise = resolveMdblistFallbackRatings(type, rawId, streamInfo, tmdbId);
    }

    const [
        imdbResults,
        tmdbResults,
        metaResults,
        mdblistResults,
    ] = await Promise.all([
        imdbPromise,
        tmdbPromise,
        metaPromise,
        mdblistPromise,
    ]);

    const mdblistDerivedResults = deriveMdblistSafetyResults(mdblistResults);

    const malResults = await resolveMalRatings(
        type,
        rawId,
        ctx,
        streamInfo,
        tmdbId,
        mdblistResults,
        metaResults
    );

    const finalRatings = finalizeRatings({
        type,
        imdbResults,
        tmdbResults,
        malResults,
        mdblistDerivedResults,
        metaResults,
        mdblistResults,
    });

    logger.info(`Resolved ${finalRatings.length} unique ratings for ${rawId}`);
    logger.info(`[Ratings] Final ratings: ${JSON.stringify(finalRatings)}`);

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
