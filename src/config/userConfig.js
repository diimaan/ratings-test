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

function buildCacheFingerprint(userConfig) {
    const fingerprint = {
        version: userConfig.version,
        providers: {
            tmdb: {
                apiUrl: userConfig.providers.tmdb.apiUrl,
                keyHash: hashValue(userConfig.providers.tmdb.apiKey),
            },
            mdblist: {
                apiUrl: userConfig.providers.mdblist.apiUrl,
                keyHash: hashValue(userConfig.providers.mdblist.apiKey),
            },
            publicmetadb: {
                apiUrl: userConfig.providers.publicmetadb.apiUrl,
                keyHash: hashValue(userConfig.providers.publicmetadb.apiKey),
            },
        },
        ratings: userConfig.ratings,
    };

    return crypto
        .createHash('sha256')
        .update(stableStringify(fingerprint))
        .digest('hex')
        .slice(0, 20);
}

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
    parseCsv,
    parsePositiveInt,
};
