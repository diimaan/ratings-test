require('dotenv').config();

const pkg = require('../../package.json');
const addonManifest = require('./manifest');
const {
    DEFAULT_HTTP_TIMEOUT_MS,
    DEFAULT_USER_AGENT,
} = require('./defaults');
const {
    buildUserConfigFromEnv,
    parseBoolean,
    parsePositiveInt,
} = require('./userConfig');

const userConfig = buildUserConfigFromEnv(process.env);
const defaultConfigEnabled = parseBoolean(process.env.ENABLE_DEFAULT_CONFIG, false);
const requestTimeoutMs = parsePositiveInt(
    process.env.HTTP_TIMEOUT_MS || process.env.PROVIDER_TIMEOUT,
    DEFAULT_HTTP_TIMEOUT_MS
);

const config = {
    port: process.env.PORT || 61262,
    logLevel: process.env.LOG_LEVEL || 'info',
    defaultConfigEnabled,
    http: {
        requestTimeoutMs,
    },
    userConfig,
    tmdb: userConfig.providers.tmdb,
    mdblist: userConfig.providers.mdblist,
    publicmetadb: userConfig.providers.publicmetadb,
    jikan: userConfig.providers.jikan,
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    storage: {
        sqlitePath: process.env.SQLITE_DB_PATH || '/app/data/app/ratings.sqlite',
        lmdbPath: process.env.LMDB_DATA_DIR || '/app/data/lmdb',
        configEncryptionEnabled: Boolean(process.env.CONFIG_ENCRYPTION_SECRET),
    },
    cache: {
        ttlSeconds: parsePositiveInt(process.env.CACHE_TTL_SECONDS, 259200),
        negativeTtlSeconds: parsePositiveInt(process.env.NEGATIVE_CACHE_TTL_SECONDS, 21600),
    },
    ratings: userConfig.ratings,
    sources: {
        imdbBaseUrl: process.env.IMDB_BASE_URL || 'https://www.imdb.com',
        metacriticBaseUrl: process.env.METACRITIC_BASE_URL || 'https://www.metacritic.com',
        rottentomatoesBaseUrl: process.env.ROTTENTOMATOES_BASE_URL || 'https://www.rottentomatoes.com',
    },
    imdbDataset: {
        mode: (process.env.IMDB_DATASET_MODE || 'required').trim().toLowerCase(),
        dataDir: process.env.IMDB_DATA_DIR || '/app/data/imdb',
        batchSize: parsePositiveInt(process.env.IMDB_DATASET_BATCH_SIZE, 5000),
        hotCacheTtlSeconds: parsePositiveInt(process.env.IMDB_EPISODE_CACHE_TTL_SECONDS, 604800),
    },
    userAgent: process.env.USER_AGENT || DEFAULT_USER_AGENT,
    addon: addonManifest,
    package: pkg,
};

let hasFatalError = false;
let hasWarning = false;

if (!config.defaultConfigEnabled) {
    console.info('ENABLE_DEFAULT_CONFIG is off. Legacy /manifest.json streams will require a UUID config.');
}

if (config.defaultConfigEnabled && !config.tmdb.apiKey) {
    console.error('FATAL ERROR: TMDB_API_KEY is required when ENABLE_DEFAULT_CONFIG is true.');
    hasFatalError = true;
}

if (!process.env.REDIS_URL) {
    console.warn('WARNING: REDIS_URL is not set. Caching will use default redis://localhost:6379.');
    hasWarning = true;
}

if (!process.env.CONFIG_ENCRYPTION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL ERROR: CONFIG_ENCRYPTION_SECRET is required in production.');
        hasFatalError = true;
    } else {
        console.warn('WARNING: CONFIG_ENCRYPTION_SECRET is not set. Saved user provider keys will not be encrypted at rest.');
        hasWarning = true;
    }
}

if (config.defaultConfigEnabled && !config.mdblist.apiKey) {
    console.warn('WARNING: MDBLIST_API_KEY is not set. MDBList-dependent ratings will be skipped.');
    hasWarning = true;
}

if (config.defaultConfigEnabled && !config.publicmetadb.apiKey) {
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
