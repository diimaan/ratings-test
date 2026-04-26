const axios = require('axios');
const config = require('../config');
const redisClient = require('../cache/redisClient');
const logger = require('../utils/logger');

const PROVIDER_NAME = 'TMDb';
const SEASON_CACHE_PREFIX = 'tmdb:season:';
const SEASON_CACHE_TTL_SECONDS = 604800;
const seasonMemoryCache = new Map();

function formatTmdbAs100(voteAverage) {
    const num = Number(voteAverage);
    if (!Number.isFinite(num)) return null;

    return `${Math.round(num * 10)}/100`;
}

function ratingFromFindData(tmdbId, type, rating) {
    if (!tmdbId || !rating) return null;

    const value = formatTmdbAs100(rating.voteAverage);
    if (!value) return null;

    return {
        source: PROVIDER_NAME,
        value,
        count: rating.voteCount,
        url: `https://www.themoviedb.org/${type}/${tmdbId}`,
    };
}

function seasonCacheKey(tmdbId, season) {
    return `${SEASON_CACHE_PREFIX}${tmdbId}:${season}`;
}

function normalizeEpisodeRating(episodeData) {
    const voteAverage = Number(episodeData?.vote_average ?? episodeData?.voteAverage);
    const voteCount = Number(episodeData?.vote_count ?? episodeData?.voteCount);

    if (!Number.isFinite(voteAverage) || voteAverage <= 0) return null;
    if (!Number.isFinite(voteCount) || voteCount <= 0) return null;

    return {
        voteAverage,
        voteCount,
    };
}

function buildEpisodeRatingResult(tmdbId, season, episode, rating) {
    const normalized = normalizeEpisodeRating(rating);
    if (!normalized) return null;

    const value = formatTmdbAs100(normalized.voteAverage);
    if (!value) return null;

    return {
        source: 'TMDb Episode',
        value,
        count: normalized.voteCount,
        url: `https://www.themoviedb.org/tv/${tmdbId}/season/${season}/episode/${episode}`,
    };
}

function normalizeSeasonEpisodes(data) {
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    const out = {};

    for (const episode of episodes) {
        const episodeNumber = Number(episode?.episode_number ?? episode?.episodeNumber);
        if (!Number.isInteger(episodeNumber) || episodeNumber < 0) continue;

        const rating = normalizeEpisodeRating(episode);
        if (rating) {
            out[String(episodeNumber)] = rating;
        }
    }

    return out;
}

async function getCachedSeasonEpisodes(cacheKey) {
    const memoryCached = seasonMemoryCache.get(cacheKey);
    if (memoryCached) return memoryCached;

    if (!redisClient.isReady()) return null;

    try {
        const cached = await redisClient.getClient()?.get(cacheKey);
        if (!cached) return null;

        const parsed = JSON.parse(cached);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

        seasonMemoryCache.set(cacheKey, parsed);
        return parsed;
    } catch (err) {
        logger.debug(`[${PROVIDER_NAME}] Season cache read skipped for ${cacheKey}: ${err.message}`);
        return null;
    }
}

async function setCachedSeasonEpisodes(cacheKey, episodes) {
    seasonMemoryCache.set(cacheKey, episodes);

    if (!redisClient.isReady()) return;

    try {
        await redisClient.getClient()?.set(cacheKey, JSON.stringify(episodes), { EX: SEASON_CACHE_TTL_SECONDS });
    } catch (err) {
        logger.debug(`[${PROVIDER_NAME}] Season cache write skipped for ${cacheKey}: ${err.message}`);
    }
}

async function getTmdbRatingDetails(tmdbId, type, userConfig = config.userConfig) {
    const tmdbConfig = userConfig?.providers?.tmdb || config.tmdb;
    const endpoint = type === 'series' ? 'tv' : 'movie';
    const url = `/${endpoint}/${tmdbId}`;

    try {
        logger.debug(`[${PROVIDER_NAME}] Fetching ${url}`);

        const res = await axios.get(`${tmdbConfig.apiUrl}${url}`, {
            timeout: config.http.requestTimeoutMs || 8000,
            headers: { 'User-Agent': config.userAgent },
            params: { api_key: tmdbConfig.apiKey },
            validateStatus: status => status >= 200 && status < 500,
        });
        const { vote_average, vote_count } = res.data || {};

        if (res.status === 404) {
            logger.warn(`[${PROVIDER_NAME}] 404 Not Found for TMDb ID: ${tmdbId}`);
            return null;
        }

        if (res.status === 401) {
            logger.error(`[${PROVIDER_NAME}] 401 Unauthorized. Check TMDB_API_KEY.`);
            return null;
        }

        if (res.status !== 200) {
            logger.error(`[${PROVIDER_NAME}] Unexpected status ${res.status} for ID ${tmdbId}`);
            return null;
        }

        if (vote_average !== null && vote_average !== undefined && vote_count) {
            const rating = formatTmdbAs100(vote_average);
            if (!rating) return null;

            return {
                source: PROVIDER_NAME,
                value: rating,
                count: vote_count,
                url: `https://www.themoviedb.org/${type}/${tmdbId}`,
            };
        }

        logger.debug(`[${PROVIDER_NAME}] No valid rating data for TMDb ID ${tmdbId}`);
        return null;
    } catch (err) {
        logger.error(`[${PROVIDER_NAME}] Request error: ${err.message}`);
        return null;
    }
}

async function fetchSeasonEpisodeRating(tmdbId, season, episode, userConfig = config.userConfig) {
    const tmdbConfig = userConfig?.providers?.tmdb || config.tmdb;
    const url = `/tv/${tmdbId}/season/${season}`;
    const cacheKey = seasonCacheKey(tmdbId, season);

    const cached = await getCachedSeasonEpisodes(cacheKey);
    const cachedRating = cached?.[String(episode)];
    if (cachedRating) {
        logger.info(`[${PROVIDER_NAME}] Using cached season rating for tv=${tmdbId} S${season}E${episode}`);
        return buildEpisodeRatingResult(tmdbId, season, episode, cachedRating);
    }
    if (cached) {
        logger.debug(`[${PROVIDER_NAME}] Cached season has no usable rating for tv=${tmdbId} S${season}E${episode}`);
        return null;
    }

    try {
        logger.debug(`[${PROVIDER_NAME}] Fetching ${url}`);

        const res = await axios.get(`${tmdbConfig.apiUrl}${url}`, {
            timeout: config.http.requestTimeoutMs || 8000,
            headers: { 'User-Agent': config.userAgent },
            params: { api_key: tmdbConfig.apiKey },
            validateStatus: status => status >= 200 && status < 500,
        });

        if (res.status === 404) {
            logger.warn(`[${PROVIDER_NAME}] 404 Not Found for TMDb season: tv=${tmdbId} S${season}`);
            return null;
        }

        if (res.status === 401) {
            logger.error(`[${PROVIDER_NAME}] 401 Unauthorized. Check TMDB_API_KEY.`);
            return null;
        }

        if (res.status !== 200) {
            logger.error(`[${PROVIDER_NAME}] Unexpected status ${res.status} for TMDb season: tv=${tmdbId} S${season}`);
            return null;
        }

        const seasonEpisodes = normalizeSeasonEpisodes(res.data);
        await setCachedSeasonEpisodes(cacheKey, seasonEpisodes);

        const rating = seasonEpisodes[String(episode)];
        if (!rating) {
            logger.debug(`[${PROVIDER_NAME}] No season-level episode rating for tv=${tmdbId} S${season}E${episode}`);
            return null;
        }

        logger.info(`[${PROVIDER_NAME}] Using rating from TMDb season payload`);
        return buildEpisodeRatingResult(tmdbId, season, episode, rating);
    } catch (err) {
        logger.error(`[${PROVIDER_NAME}] Season request error for tv=${tmdbId} S${season}: ${err.message}`);
        return null;
    }
}

async function getEpisodeRatingDetails(tmdbId, season, episode, userConfig = config.userConfig) {
    const seasonRating = await fetchSeasonEpisodeRating(tmdbId, season, episode, userConfig);
    if (seasonRating) return seasonRating;

    const tmdbConfig = userConfig?.providers?.tmdb || config.tmdb;
    const url = `/tv/${tmdbId}/season/${season}/episode/${episode}`;

    try {
        logger.debug(`[${PROVIDER_NAME}] Fetching ${url}`);

        const res = await axios.get(`${tmdbConfig.apiUrl}${url}`, {
            timeout: config.http.requestTimeoutMs || 8000,
            headers: { 'User-Agent': config.userAgent },
            params: { api_key: tmdbConfig.apiKey },
            validateStatus: status => status >= 200 && status < 500,
        });

        if (res.status === 404) {
            logger.warn(`[${PROVIDER_NAME}] 404 Not Found for TMDb episode: tv=${tmdbId} S${season}E${episode}`);
            return null;
        }

        if (res.status === 401) {
            logger.error(`[${PROVIDER_NAME}] 401 Unauthorized. Check TMDB_API_KEY.`);
            return null;
        }

        if (res.status !== 200) {
            logger.error(
                `[${PROVIDER_NAME}] Unexpected status ${res.status} for TMDb episode: tv=${tmdbId} S${season}E${episode}`
            );
            return null;
        }

        const ratingResult = buildEpisodeRatingResult(tmdbId, season, episode, res.data);
        if (!ratingResult) {
            logger.debug(
                `[${PROVIDER_NAME}] No valid episode rating for TMDb episode: tv=${tmdbId} S${season}E${episode}`
            );
            return null;
        }

        return ratingResult;
    } catch (err) {
        logger.error(
            `[${PROVIDER_NAME}] Episode request error for tv=${tmdbId} S${season}E${episode}: ${err.message}`
        );
        return null;
    }
}

async function getRating(type, _imdbId, streamInfo, tmdbId, userConfig = config.userConfig) {
    if (!tmdbId) return null;

    if (streamInfo?.isEpisode) {
        const season = streamInfo.season;
        const episode = streamInfo.episode;

        if (season == null || episode == null) {
            logger.warn(`[${PROVIDER_NAME}] Episode mode requested but season/episode is missing.`);
            return null;
        }

        return getEpisodeRatingDetails(tmdbId, season, episode, userConfig);
    }

    const findRating = ratingFromFindData(tmdbId, type, streamInfo?.tmdbFindRating);
    if (findRating) {
        logger.info(`[${PROVIDER_NAME}] Using rating from TMDb find payload`);
        return findRating;
    }

    return getTmdbRatingDetails(tmdbId, type, userConfig);
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
    ratingFromFindData,
    normalizeSeasonEpisodes,
    buildEpisodeRatingResult,
};
