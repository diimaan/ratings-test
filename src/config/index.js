require('dotenv').config();

const pkg = require('../../package.json');
const addonManifest = require('./manifest');

const DEFAULT_HTTP_TIMEOUT_MS = 12000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function parseCsv(value, fallback = []) {
    if (!value || typeof value !== 'string') return fallback;
    return value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const defaultEnabledRatings = [
    'Common Sense',
    'Not Safe',
    'Sexual Violence',
    'Sex & Nudity',
    'IMDb (Movie)',
    'IMDb (Show)',
    'IMDb (Episode)',
    'TMDb (Movie)',
    'TMDb (Show)',
    'TMDb (Episode)',
    'MC',
    'RT',
    'PC',
    'Trakt',
    'MAL',
    'Letterboxd',
    'Roger Ebert',
];

const defaultRatingsOrder = [
    'Common Sense',
    'Not Safe',
    'Sexual Violence',
    'Sex & Nudity',
    'IMDb (Episode)',
    'IMDb (Show)',
    'IMDb (Movie)',
    'TMDb (Episode)',
    'TMDb (Show)',
    'TMDb (Movie)',
    'MAL',
    'Letterboxd',
    'MC',
    'RT',
    'PC',
    'Trakt',
    'Roger Ebert',
];

const compactCount = parsePositiveInt(process.env.COMPACT_RATINGS_LIMIT, 4);
const displayModeRaw = (process.env.DISPLAY_MODE || 'full').trim().toLowerCase();
const displayMode = ['compact', 'full'].includes(displayModeRaw) ? displayModeRaw : 'full';
const requestTimeoutMs = parsePositiveInt(
    process.env.HTTP_TIMEOUT_MS || process.env.PROVIDER_TIMEOUT,
    DEFAULT_HTTP_TIMEOUT_MS
);

const config = {
    port: process.env.PORT || 61262,
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
        requestTimeoutMs,
    },
    tmdb: {
        apiKey: process.env.TMDB_API_KEY,
        apiUrl: process.env.TMDB_API_URL || 'https://api.themoviedb.org/3',
    },
    mdblist: {
        apiKey: process.env.MDBLIST_API_KEY,
        apiUrl: process.env.MDBLIST_API_URL || 'https://api.mdblist.com',
    },
    publicmetadb: {
        apiKey: process.env.PUBLICMETADB_API_KEY || '',
        apiUrl: process.env.PUBLICMETADB_API_URL || 'https://publicmetadb.com/api',
    },
    jikan: {
        apiUrl: process.env.JIKAN_API_URL || 'https://api.jikan.moe/v4',
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    cache: {
        ttlSeconds: parsePositiveInt(process.env.CACHE_TTL_SECONDS, 259200),
        negativeTtlSeconds: parsePositiveInt(process.env.NEGATIVE_CACHE_TTL_SECONDS, 21600),
    },
    ratings: {
        enabled: parseCsv(process.env.ENABLED_RATINGS, defaultEnabledRatings),
        order: parseCsv(process.env.RATINGS_ORDER, defaultRatingsOrder),
        displayMode,
        compactLimit: compactCount,
    },
    sources: {
        imdbBaseUrl: process.env.IMDB_BASE_URL || 'https://www.imdb.com',
        metacriticBaseUrl: process.env.METACRITIC_BASE_URL || 'https://www.metacritic.com',
        rottentomatoesBaseUrl: process.env.ROTTENTOMATOES_BASE_URL || 'https://www.rottentomatoes.com',
        commonSenseBaseUrl: process.env.COMMONSENSE_BASE_URL || 'https://www.commonsensemedia.org',
        cringeMdbBaseUrl: process.env.CRINGEMDB_BASE_URL || 'https://cringemdb.com',
    },
    userAgent: process.env.USER_AGENT || DEFAULT_USER_AGENT,
    addon: addonManifest,
    package: pkg,
};

let hasFatalError = false;
let hasWarning = false;

if (!config.tmdb.apiKey) {
    console.error('FATAL ERROR: TMDB_API_KEY is not set.');
    hasFatalError = true;
}

if (!process.env.REDIS_URL) {
    console.warn('WARNING: REDIS_URL is not set. Caching will use default redis://localhost:6379.');
    hasWarning = true;
}

if (!config.mdblist.apiKey) {
    console.warn('WARNING: MDBLIST_API_KEY is not set. MDBList-dependent ratings will be skipped.');
    hasWarning = true;
}

if (!config.publicmetadb.apiKey) {
    console.warn('WARNING: PUBLICMETADB_API_KEY is not set. PublicMetaDB ratings will be skipped.');
    hasWarning = true;
}

if (hasFatalError) {
    console.error('Critical configuration missing. Please check environment variables. Exiting.');
    process.exit(1);
} else if (hasWarning) {
    console.warn('One or more configuration warnings detected. Service might not function fully.');
}

module.exports = config;
