const crypto = require('crypto');
const {
    DEFAULT_RATINGS_ORDER,
    DEFAULT_ENABLED_RATINGS,
} = require('./defaults');

function parseCsv(value, fallback = []) {
    if (!value || typeof value !== 'string') return [...fallback];
    return value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDisplayMode(value, fallback = 'full') {
    const normalized = String(value || fallback).trim().toLowerCase();
    return ['auto', 'compact', 'full'].includes(normalized) ? normalized : fallback;
}

function normalizeSafetySource(value, fallback = 'hybrid') {
    const normalized = String(value || fallback).trim().toLowerCase();
    return ['mdblist_conservative', 'direct', 'hybrid'].includes(normalized)
        ? normalized
        : fallback;
}

function hashValue(value) {
    if (!value) return null;
    return crypto
        .createHash('sha256')
        .update(String(value))
        .digest('hex')
        .slice(0, 16);
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`
        ).join(',')}}`;
    }

    return JSON.stringify(value);
}

// Cache fingerprint covers ONLY inputs that change which upstream data is
// fetched, AND the data is identical regardless of which API key fetched
// it (the upstreams we use have no per-user calculations or lists). So the
// fingerprint is derived from the upstream URLs and the server-controlled
// safetySource — NOT from per-user provider keys. This lets the cache be
// shared across all users on the same operator deployment, with richness-
// gated writes (in ratingService) preventing tier downgrades.
function buildCacheFingerprint(userConfig) {
    const fingerprint = {
        version: userConfig.version,
        providers: {
            tmdb: { apiUrl: userConfig.providers.tmdb.apiUrl },
            mdblist: { apiUrl: userConfig.providers.mdblist.apiUrl },
            publicmetadb: { apiUrl: userConfig.providers.publicmetadb.apiUrl },
        },
        safetySource: userConfig.ratings?.safetySource || null,
    };

    return crypto
        .createHash('sha256')
        .update(stableStringify(fingerprint))
        .digest('hex')
        .slice(0, 20);
}

// Retained for symmetry with how earlier versions hashed individual
// values; currently unused but kept for tests that hash arbitrary values.
void hashValue;

function buildUserConfigFromEnv(env = process.env) {
    const userConfig = {
        id: 'default',
        version: 1,
        providers: {
            tmdb: {
                apiKey: env.TMDB_API_KEY,
                apiUrl: env.TMDB_API_URL || 'https://api.themoviedb.org/3',
            },
            mdblist: {
                apiKey: env.MDBLIST_API_KEY,
                apiUrl: env.MDBLIST_API_URL || 'https://api.mdblist.com',
            },
            publicmetadb: {
                apiKey: env.PUBLICMETADB_API_KEY || '',
                apiUrl: env.PUBLICMETADB_API_URL || 'https://publicmetadb.com',
            },
            jikan: {
                apiUrl: env.JIKAN_API_URL || 'https://api.jikan.moe/v4',
            },
        },
        ratings: {
            enabled: parseCsv(env.ENABLED_RATINGS, DEFAULT_ENABLED_RATINGS),
            order: parseCsv(env.RATINGS_ORDER, DEFAULT_RATINGS_ORDER),
            displayMode: normalizeDisplayMode(env.DISPLAY_MODE || 'auto'),
            compactLimit: parsePositiveInt(env.COMPACT_RATINGS_LIMIT, 4),
            safetySource: normalizeSafetySource(env.SAFETY_SOURCE),
        },
    };

    userConfig.cacheKey = buildCacheFingerprint(userConfig);
    return userConfig;
}

function normalizeArray(value, fallback = []) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return parseCsv(value, fallback);
    }

    return [...fallback];
}

function buildUserConfigFromInput(input = {}, baseConfig) {
    const providers = input.providers || {};
    const ratings = input.ratings || {};
    const userConfig = {
        id: input.id,
        version: 1,
        providers: {
            tmdb: {
                apiKey: providers.tmdb?.apiKey || '',
                apiUrl: providers.tmdb?.apiUrl || baseConfig.providers.tmdb.apiUrl,
            },
            mdblist: {
                apiKey: providers.mdblist?.apiKey || '',
                apiUrl: providers.mdblist?.apiUrl || baseConfig.providers.mdblist.apiUrl,
            },
            publicmetadb: {
                apiKey: providers.publicmetadb?.apiKey || '',
                apiUrl: providers.publicmetadb?.apiUrl || baseConfig.providers.publicmetadb.apiUrl,
            },
            jikan: {
                apiUrl: providers.jikan?.apiUrl || baseConfig.providers.jikan.apiUrl,
            },
        },
        ratings: {
            enabled: normalizeArray(ratings.enabled, baseConfig.ratings.enabled),
            order: normalizeArray(ratings.order, baseConfig.ratings.order),
            displayMode: normalizeDisplayMode(ratings.displayMode, baseConfig.ratings.displayMode),
            compactLimit: parsePositiveInt(ratings.compactLimit, baseConfig.ratings.compactLimit),
            safetySource: normalizeSafetySource(baseConfig.ratings.safetySource),
        },
    };

    userConfig.cacheKey = buildCacheFingerprint(userConfig);
    return userConfig;
}

module.exports = {
    buildUserConfigFromEnv,
    buildUserConfigFromInput,
    buildCacheFingerprint,
    normalizeDisplayMode,
    normalizeSafetySource,
    parseCsv,
    parsePositiveInt,
};
