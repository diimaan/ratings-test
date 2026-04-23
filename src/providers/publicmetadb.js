const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const PROVIDER_NAME = 'PublicMetaDB';

const API_URL = config.publicmetadb?.apiUrl;
const API_KEY = config.publicmetadb?.apiKey;

const client = axios.create({
    baseURL: API_URL,
    timeout: config.http.requestTimeoutMs || 8000,
    headers: {
        'User-Agent': config.userAgent,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    validateStatus: status => status >= 200 && status < 500,
});

function mapLabel(label) {
    switch (String(label || '').trim().toUpperCase()) {
        case 'IM': return 'IMDb';
        case 'TM': return 'TMDb';
        case 'MC': return 'MC';
        case 'RT': return 'RT';
        case 'PC': return 'PC';
        case 'TR': return 'Trakt';
        case 'LB': return 'Letterboxd';
        case 'RE': return 'Roger Ebert';
        case 'MAL': return 'MAL';
        default: return null;
    }
}

function formatRogerEbertStars(score) {
    const num = Number(score);
    if (!Number.isFinite(num) || num <= 0) return null;

    const stars = num / 25;
    const rounded = Math.round(stars * 2) / 2;

    const full = Math.floor(rounded);
    const half = rounded % 1 !== 0;

    let out = '⭐'.repeat(full);
    if (half) out += '✨';

    return out || null;
}

function formatScore(score, label) {
    const num = Number(score);
    if (!Number.isFinite(num) || num <= 0) return null;

    const upper = String(label || '').trim().toUpperCase();

    if (upper === 'LB') {
        return `${(num / 20).toFixed(1)}/5`;
    }

    if (upper === 'RE') {
        return formatRogerEbertStars(num);
    }

    if (upper === 'IM' || upper === 'MAL') {
        return `${(num / 10).toFixed(1)}/10`;
    }

    return `${Math.round(num)}/100`;
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) return null;

    const valid = values.map(Number).filter(v => Number.isFinite(v) && v > 0);
    if (!valid.length) return null;

    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

async function getRating(type, _imdbId, streamInfo, tmdbId) {
    if (!API_URL) {
        logger.warn(`[${PROVIDER_NAME}] API URL not configured`);
        return null;
    }

    if (!API_KEY) {
        logger.warn(`[${PROVIDER_NAME}] API key not configured`);
        return null;
    }

    if (!tmdbId) {
        logger.debug(`[${PROVIDER_NAME}] Missing TMDb ID, skipping`);
        return null;
    }

    // Keep PMDB out of episode flow for now.
    // Episode requests already get IMDb/TMDb episode ratings natively
    // and show-level fallback from MDBList / other providers.
    if (streamInfo?.isEpisode) {
        logger.debug(`[${PROVIDER_NAME}] Skipping episode request`);
        return null;
    }

    const mediaType = type === 'series' ? 'tv' : 'movie';

    try {
        logger.debug(`[${PROVIDER_NAME}] Fetching ratings for tmdb=${tmdbId} type=${mediaType}`);

        const res = await client.get('/api/external/ratings', {
            params: {
                tmdb_id: tmdbId,
                media_type: mediaType,
            },
        });

        if (res.status === 401) {
            logger.warn(`[${PROVIDER_NAME}] Unauthorized (401). Check PUBLICMETADB_API_KEY / Bearer token format.`);
            return null;
        }

        if (res.status !== 200) {
            logger.warn(`[${PROVIDER_NAME}] Non-200 response: ${res.status}`);
            return null;
        }

        const payload = res.data;

        if (!payload || !Array.isArray(payload.items)) {
            logger.debug(`[${PROVIDER_NAME}] No items array in response`);
            return null;
        }

        const grouped = new Map();

        for (const item of payload.items) {
            const rawLabel = String(item?.label || '').trim().toUpperCase();

            // Ignore PMDB overall aggregate for now
            if (!rawLabel || rawLabel === 'OVERALL') continue;

            const mapped = mapLabel(rawLabel);
            if (!mapped) continue;

            const score = Number(item?.score);
            if (!Number.isFinite(score) || score <= 0) continue;

            if (!grouped.has(rawLabel)) {
                grouped.set(rawLabel, []);
            }

            grouped.get(rawLabel).push(score);
        }

        const results = [];

        for (const [rawLabel, scores] of grouped.entries()) {
            const avg = average(scores);
            if (!Number.isFinite(avg) || avg <= 0) continue;

            const mapped = mapLabel(rawLabel);
            if (!mapped) continue;

            const value = formatScore(avg, rawLabel);
            if (!value) continue;

            results.push({
                source: mapped,
                value,
            });
        }

        if (results.length === 0) {
            logger.debug(`[${PROVIDER_NAME}] No usable ratings extracted`);
            return null;
        }

        logger.debug(`[${PROVIDER_NAME}] Extracted ${results.length} ratings from ${payload.items.length} items`);

        return results;
    } catch (err) {
        logger.error(`[${PROVIDER_NAME}] Request error: ${err.message}`);
        return null;
    }
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
};
