const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const PROVIDER_NAME = 'TMDb';

function formatTmdbAs100(voteAverage) {
    const num = Number(voteAverage);
    if (!Number.isFinite(num)) return null;

    return `${Math.round(num * 10)}/100`;
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

async function getEpisodeRatingDetails(tmdbId, season, episode, userConfig = config.userConfig) {
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

        const voteAverage = res.data?.vote_average;
        if (voteAverage === null || voteAverage === undefined) {
            logger.debug(
                `[${PROVIDER_NAME}] No valid episode rating for TMDb episode: tv=${tmdbId} S${season}E${episode}`
            );
            return null;
        }

        const rating = formatTmdbAs100(voteAverage);
        if (!rating) return null;

        return {
            source: 'TMDb Episode',
            value: rating,
            url: `https://www.themoviedb.org/tv/${tmdbId}/season/${season}/episode/${episode}`,
        };
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

    return getTmdbRatingDetails(tmdbId, type, userConfig);
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
};
