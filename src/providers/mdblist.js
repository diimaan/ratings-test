const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

logger.info('[MDBList] Provider module loaded');

function endpointType(type) {
    return type === 'series' ? 'show' : 'movie';
}

function normalizeSourceName(key) {
    const map = {
        imdb: 'IMDb',
        tmdb: 'TMDb',
        letterboxd: 'Letterboxd',
        myanimelist: 'MAL',
        mal: 'MAL',
        metacritic: 'MC',
        tomatoes: 'RT',
        popcorn: 'PC',
        rogerebert: 'Roger Ebert',
        mdblist: 'MDBList',
        trakt: 'Trakt',
    };

    return map[String(key || '').toLowerCase()] || null;
}

function sourceScale(sourceKey, fallback = 10) {
    const key = String(sourceKey || '').toLowerCase();

    if (key === 'tmdb') return 100;
    if (key === 'metacritic') return 100;
    if (key === 'tomatoes') return 100;
    if (key === 'popcorn') return 100;
    if (key === 'trakt') return 100;
    if (key === 'mdblist') return 100;
    if (key === 'letterboxd') return 5;
    if (['imdb', 'myanimelist', 'mal'].includes(key)) return 10;
    if (key === 'rogerebert') return 100;

    return fallback;
}

function formatRogerEbertStars(score) {
    const num = Number(score);
    if (!Number.isFinite(num) || num <= 0) return null;

    let normalized = num;

    // MDBList sometimes returns Roger Ebert as 0-4,
    // sometimes as 0-100 style.
    if (normalized <= 4) {
        normalized = normalized * 25;
    }

    const stars = normalized / 25;
    const rounded = Math.round(stars * 2) / 2;

    const full = Math.floor(rounded);
    const half = rounded % 1 !== 0;

    let out = '⭐'.repeat(full);
    if (half) out += '✨';

    return out || null;
}

function formatValue(sourceKey, rawValue, scale) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;

    const num = Number(rawValue);
    if (!Number.isFinite(num) || num <= 0) return null;

    const key = String(sourceKey || '').toLowerCase();

    if (key === 'rogerebert') {
        return formatRogerEbertStars(num);
    }

    if (scale === 100) return `${Math.round(num)}/100`;
    if (scale === 10) return `${num.toFixed(1)}/10`;
    if (scale === 5) return `${num.toFixed(1)}/5`;

    return `${num}`;
}

function pushIfValid(out, sourceKey, sourceName, value, scale) {
    const normalized = normalizeSourceName(sourceName || sourceKey);
    const formatted = formatValue(sourceKey, value, scale);

    if (!normalized || !formatted) return;

    out.push({
        source: normalized,
        value: formatted,
    });
}

function extractPreferredMdbScore(data) {
    const preferred =
        data?.score_average !== undefined && data?.score_average !== null && Number(data.score_average) > 0
            ? data.score_average
            : data?.score !== undefined && data?.score !== null && Number(data.score) > 0
                ? data.score
                : null;

    if (preferred === null) return null;

    return {
        source: 'MDBList',
        value: `${Math.round(Number(preferred))}/100`,
    };
}

function normalizeKeywordName(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function extractKeywordNames(data) {
    if (!Array.isArray(data?.keywords)) return [];

    return [...new Set(
        data.keywords
            .map(item => normalizeKeywordName(item?.name ?? item?.title ?? item))
            .filter(Boolean)
    )];
}

function extractGenreNames(data) {
    if (!Array.isArray(data?.genres)) return [];

    return [...new Set(
        data.genres
            .map(item => normalizeKeywordName(item?.name ?? item?.title ?? item))
            .filter(Boolean)
    )];
}

function normalizeNumber(value) {
    const match = String(value ?? '').match(/([0-9]{1,2}(?:\.[0-9]+)?)/);
    const num = match ? Number(match[1]) : Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
}

function firstNormalizedNumber(...values) {
    for (const value of values) {
        const normalized = normalizeNumber(value);
        if (normalized) return normalized;
    }

    return null;
}

function firstPresentValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }

    return null;
}

function objectOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractStructuredMetadata(data) {
    if (!data || typeof data !== 'object') return null;

    const malId = data?.ids?.mal ?? data?.mal_id ?? data?.myanimelist_id ?? null;
    const imdbId = data?.ids?.imdb ?? data?.imdb_id ?? null;
    const tmdbId = data?.ids?.tmdb ?? data?.tmdb_id ?? null;
    const language = String(data.language || '').toLowerCase() || null;
    const genres = extractGenreNames(data);
    const keywords = extractKeywordNames(data);
    const commonSenseMedia = data?.commonsense_media || data?.common_sense_media || data?.commonsense || {};
    const parentalGuide = data?.parental_guide || data?.parental || {};
    const safety = objectOrEmpty(data?.safety);

    return {
        _mdblist: {
            ids: {
                imdb: imdbId || null,
                tmdb: tmdbId || null,
                mal: malId || null,
            },
            age: {
                commonSense: firstNormalizedNumber(
                    commonSenseMedia?.common_sense,
                    commonSenseMedia?.rating,
                    commonSenseMedia?.age,
                    commonSenseMedia?.minimum_age,
                    commonSenseMedia?.recommended_age,
                    commonSenseMedia?.age_rating,
                    data?.common_sense,
                    data?.commonsense,
                    data?.csm_age
                ),
                ageRating: firstNormalizedNumber(
                    data?.age_rating,
                    data?.certification_age,
                    data?.content_rating_age,
                    data?.minimum_age
                ),
                parentalNudity: firstNormalizedNumber(
                    commonSenseMedia?.parental_nudity,
                    commonSenseMedia?.sex,
                    commonSenseMedia?.sex_nudity,
                    parentalGuide?.nudity,
                    parentalGuide?.sex,
                    parentalGuide?.sex_nudity
                ),
            },
            safety: {
                parentSafe: firstPresentValue(
                    safety?.parent_safe,
                    safety?.parentSafe,
                    safety?.is_parent_safe,
                    safety?.certified_parent_safe,
                    commonSenseMedia?.parent_safe,
                    commonSenseMedia?.parentSafe,
                    commonSenseMedia?.is_parent_safe,
                    data?.parent_safe,
                    data?.parentSafe,
                    data?.is_parent_safe,
                    data?.cringemdb_parent_safe
                ),
                certification: firstPresentValue(
                    safety?.certification,
                    safety?.rating,
                    safety?.label,
                    commonSenseMedia?.certification,
                    commonSenseMedia?.rating_label,
                    data?.certification,
                    data?.safety_certification,
                    data?.parental_certification
                ),
            },
            language,
            genres,
            keywords,
            flags: {
                hasMalId: Boolean(malId),
                isJapaneseLanguage: language === 'ja',
                hasAnimeGenre: genres.some(genre => /anime/i.test(genre)),
                hasCommonSenseData: data?.commonsense === true || Boolean(commonSenseMedia?.common_sense),
            },
        },
    };
}

function extractRatings(data) {
    const out = [];
    if (!data || typeof data !== 'object') return out;

    // MDBList own score:
    // prefer score_average, fallback to score
    const preferredMdbScore = extractPreferredMdbScore(data);
    if (preferredMdbScore) {
        out.push(preferredMdbScore);
    }

    if (Array.isArray(data.ratings)) {
        for (const r of data.ratings) {
            if (!r) continue;

            const sourceKey = String(r.source || r.provider || r.name || '').toLowerCase();
            const scale = sourceScale(sourceKey, r.scale || r.best || r.max || 10);

            pushIfValid(
                out,
                sourceKey,
                r.source || r.provider || r.name,
                r.value ?? r.rating ?? r.score,
                scale
            );
        }
    }

    const candidates = [
        ['imdb_rating', 10, 'IMDb'],
        ['tmdb_rating', 100, 'TMDb'],
        ['letterboxd_rating', 5, 'Letterboxd'],
        ['myanimelist_rating', 10, 'MAL'],
        ['mal_rating', 10, 'MAL'],
        ['metacritic_rating', 100, 'MC'],
        ['tomatoes_rating', 100, 'RT'],
        ['popcorn_rating', 100, 'PC'],
        ['rogerebert_rating', 100, 'Roger Ebert'],
        ['trakt_rating', 100, 'Trakt'],
    ];

    for (const [field, scale, source] of candidates) {
        if (data[field] !== undefined && data[field] !== null && Number(data[field]) > 0) {
            pushIfValid(out, field.replace(/_rating$/, ''), source, data[field], scale);
        }
    }

    if (data.scores && typeof data.scores === 'object') {
        for (const [key, value] of Object.entries(data.scores)) {
            const scale = sourceScale(key, 10);
            if (Number(value) > 0) {
                pushIfValid(out, key, key, value, scale);
            }
        }
    }

    const deduped = new Map();
    for (const item of out) {
        if (!deduped.has(item.source)) {
            deduped.set(item.source, item);
        }
    }

    return Array.from(deduped.values());
}

async function fetchByTmdb(type, tmdbId, providerConfig) {
    logger.info(`[MDBList] Fetching by TMDb: type=${type} tmdbId=${tmdbId}`);
    const mediaType = endpointType(type);
    const url = `${providerConfig.apiUrl}/tmdb/${mediaType}/${tmdbId}`;

    logger.debug(`[MDBList] Fetching ${url}`);

    const res = await axios.get(url, {
        timeout: config.http.requestTimeoutMs || 12000,
        headers: { 'User-Agent': config.userAgent },
        params: { apikey: providerConfig.apiKey },
        validateStatus: status => status >= 200 && status < 500,
    });

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
        logger.error('[MDBList] Unauthorized. Check MDBLIST_API_KEY.');
        return null;
    }
    if (res.status !== 200) {
        logger.warn(`[MDBList] Unexpected status ${res.status} for TMDb ID ${tmdbId}`);
        return null;
    }

    logger.debug(`[MDBList] Raw payload: ${JSON.stringify(res.data).slice(0, 4000)}`);
    const ratings = extractRatings(res.data);

    const metadata = extractStructuredMetadata(res.data);
    if (metadata) {
        ratings.push(metadata);
    }

    return ratings;
}

async function fetchByImdb(type, imdbId, providerConfig) {
    logger.info(`[MDBList] Fetching by IMDb: type=${type} imdbId=${imdbId}`);
    const baseId = imdbId?.split(':')[0];
    const mediaType = endpointType(type);
    const url = `${providerConfig.apiUrl}/imdb/${mediaType}/${baseId}`;

    logger.debug(`[MDBList] Fallback fetching ${url}`);

    const res = await axios.get(url, {
        timeout: config.http.requestTimeoutMs || 12000,
        headers: { 'User-Agent': config.userAgent },
        params: { apikey: providerConfig.apiKey },
        validateStatus: status => status >= 200 && status < 500,
    });

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
        logger.error('[MDBList] Unauthorized. Check MDBLIST_API_KEY.');
        return null;
    }
    if (res.status !== 200) {
        logger.warn(`[MDBList] Unexpected status ${res.status} for IMDb ID ${baseId}`);
        return null;
    }

    logger.debug(`[MDBList] Raw payload: ${JSON.stringify(res.data).slice(0, 4000)}`);
    const ratings = extractRatings(res.data);

    const metadata = extractStructuredMetadata(res.data);
    if (metadata) {
        ratings.push(metadata);
    }

    return ratings;
}

async function getRating(type, imdbId, _streamInfo, tmdbId, userConfig = config.userConfig) {
    const providerConfig = userConfig?.providers?.mdblist || config.mdblist;

    logger.info(`[MDBList] getRating called for type=${type} imdbId=${imdbId} tmdbId=${tmdbId}`);

    if (!providerConfig.apiKey) {
        logger.warn('[MDBList] API key missing. MDBList-backed ratings will not be returned.');
        return null;
    }

    try {
        if (tmdbId) {
            const byTmdb = await fetchByTmdb(type, tmdbId, providerConfig);
            if (byTmdb?.length) return byTmdb;
        }

        return await fetchByImdb(type, imdbId, providerConfig);
    } catch (err) {
        logger.error(`[MDBList] Request error: ${err.message}`);
        return {
            _providerStatus: {
                provider: 'MDBList',
                transient: true,
                error: err.message,
            },
        };
    }
}

module.exports = {
    name: 'MDBList',
    getRating,
    extractStructuredMetadata,
};
