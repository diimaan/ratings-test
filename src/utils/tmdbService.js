// src/utils/tmdbService.js
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

function normalizeImdbId(imdbId) {
    return imdbId?.split(':')[0];
}

const tmdbFindClient = axios.create({
    baseURL: config.tmdb.apiUrl,
    timeout: config.http.requestTimeoutMs || 8000,
    headers: { 'User-Agent': config.userAgent },
    validateStatus: status => status >= 200 && status < 500,
});

async function getTmdbData(imdbId, type) {
    const baseImdb = normalizeImdbId(imdbId);

    if (!config.tmdb.apiKey) {
        logger.error('TMDB API key not configured.');
        return { tmdbId: null, name: null, date: null };
    }

    if (!baseImdb) {
        logger.warn('TMDB lookup skipped: IMDb ID missing or invalid.');
        return { tmdbId: null, name: null, date: null };
    }

    const path = `/find/${baseImdb}`;

    try {
        logger.debug(`[TMDB] HTTP GET: ${config.tmdb.apiUrl}${path}`);

        const response = await tmdbFindClient.get(path, {
            params: {
                api_key: config.tmdb.apiKey,
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

            return { tmdbId: null, name: null, date: null };
        }

        const data = response.data || {};
        const results = type === 'series' ? data.tv_results : data.movie_results;

        if (Array.isArray(results) && results.length > 0) {
            const item = results[0];
            const tmdbId = item.id ?? null;
            const name = item.title || item.name || null;
            const date = item.release_date || item.first_air_date || null;

            logger.debug(
                `TMDB Data: IMDb=${baseImdb}, Type=${type} → ID=${tmdbId}, Name="${name}", Date="${date}"`
            );

            return { tmdbId, name, date };
        }

        logger.warn(`No TMDB results for IMDb=${baseImdb} (type=${type}).`);
        return { tmdbId: null, name: null, date: null };
    } catch (err) {
        logger.error(`TMDB API error for IMDb=${baseImdb}: ${err.message}`);
        return { tmdbId: null, name: null, date: null };
    }
}

module.exports = { getTmdbData };
