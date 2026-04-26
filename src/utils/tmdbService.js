// src/utils/tmdbService.js
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

function normalizeImdbId(imdbId) {
    return imdbId?.split(':')[0];
}

function buildTmdbFindRating(item) {
    const voteAverage = Number(item?.vote_average);
    const voteCount = Number(item?.vote_count);

    if (!Number.isFinite(voteAverage) || voteAverage <= 0) {
        return null;
    }

    if (!Number.isFinite(voteCount) || voteCount <= 0) {
        return null;
    }

    return {
        voteAverage,
        voteCount,
    };
}

async function getTmdbData(imdbId, type, userConfig = config.userConfig) {
    const tmdbConfig = userConfig?.providers?.tmdb || config.tmdb;
    const baseImdb = normalizeImdbId(imdbId);

    if (!tmdbConfig.apiKey) {
        logger.error('TMDB API key not configured.');
        return { tmdbId: null, name: null, date: null, rating: null };
    }

    if (!baseImdb) {
        logger.warn('TMDB lookup skipped: IMDb ID missing or invalid.');
        return { tmdbId: null, name: null, date: null, rating: null };
    }

    const path = `/find/${baseImdb}`;

    try {
        logger.debug(`[TMDB] HTTP GET: ${tmdbConfig.apiUrl}${path}`);

        const response = await axios.get(`${tmdbConfig.apiUrl}${path}`, {
            timeout: config.http.requestTimeoutMs || 8000,
            headers: { 'User-Agent': config.userAgent },
            validateStatus: status => status >= 200 && status < 500,
            params: {
                api_key: tmdbConfig.apiKey,
                external_source: 'imdb_id',
            },
        });

        if (!response || response.status !== 200) {
            if (response?.status === 401) {
                logger.error('TMDB 401 Unauthorized. Check TMDB_API_KEY.');
            } else if (response?.status === 404) {
                logger.warn(`TMDB 404 Not Found for IMDb=${baseImdb}`);
            } else {
                logger.warn(
                    `TMDB lookup failed for IMDb=${baseImdb} with status ${response?.status ?? 'unknown'}`
                );
            }

            return { tmdbId: null, name: null, date: null, rating: null };
        }

        const data = response.data || {};
        const results = type === 'series' ? data.tv_results : data.movie_results;

        if (Array.isArray(results) && results.length > 0) {
            const item = results[0];
            const tmdbId = item.id ?? null;
            const name = item.title || item.name || null;
            const date = item.release_date || item.first_air_date || null;
            const rating = buildTmdbFindRating(item);

            logger.debug(
                `TMDB Data: IMDb=${baseImdb}, Type=${type} → ID=${tmdbId}, Name="${name}", Date="${date}"`
            );

            return { tmdbId, name, date, rating };
        }

        logger.warn(`No TMDB results for IMDb=${baseImdb} (type=${type}).`);
        return { tmdbId: null, name: null, date: null, rating: null };
    } catch (err) {
        logger.error(`TMDB API error for IMDb=${baseImdb}: ${err.message}`);
        return { tmdbId: null, name: null, date: null, rating: null };
    }
}

module.exports = {
    getTmdbData,
    buildTmdbFindRating,
};
