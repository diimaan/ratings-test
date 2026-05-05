require('dotenv').config();

const pkg = require('../../package.json');
const addonManifest = require('./manifest');
const {
    DEFAULT_HTTP_TIMEOUT_MS,
    DEFAULT_USER_AGENT,
} = require('./defaults');
const {
    buildUserConfigFromEnv,
    parsePositiveInt,
} = require('./userConfig');

const userConfig = buildUserConfigFromEnv(process.env);
const requestTimeoutMs = parsePositiveInt(
    process.env.HTTP_TIMEOUT_MS || process.env.PROVIDER_TIMEOUT,
    DEFAULT_HTTP_TIMEOUT_MS
);

function normalizePublicMetaDbFallbackMode(value) {
    const normalized = String(value || 'auto').trim().toLowerCase();
    return ['auto', 'compare', 'force', 'off'].includes(normalized) ? normalized : 'auto';
}

const config = {
    port: process.env.PORT || 61262,
    logLevel: process.env.LOG_LEVEL || 'info',
    http: {
        requestTimeoutMs,
    },
    userConfig,
    tmdb: userConfig.providers.tmdb,
    mdblist: userConfig.providers.mdblist,
    publicmetadb: userConfig.providers.publicmetadb,
    publicMetaDbFallbackMode: normalizePublicMetaDbFallbackMode(process.env.PUBLICMETADB_FALLBACK_MODE),
    jikan: userConfig.providers.jikan,
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    storage: {
        // User-config store driver. Defaults to sqlite. Set to "postgres"
        // to use the Postgres backend; that driver requires
        // CONFIG_DATABASE_URL (or PG* env vars) to be set.
        driver: String(process.env.CONFIG_STORE_DRIVER || 'sqlite').trim().toLowerCase(),
        sqlitePath: process.env.SQLITE_DB_PATH || '/app/data/app/ratings.sqlite',
        postgres: {
            connectionString: process.env.CONFIG_DATABASE_URL || process.env.DATABASE_URL || '',
            poolMax: parsePositiveInt(process.env.CONFIG_DATABASE_POOL_MAX, 10),
            idleTimeoutMs: parsePositiveInt(process.env.CONFIG_DATABASE_IDLE_TIMEOUT_MS, 30000),
            connectionTimeoutMs: parsePositiveInt(process.env.CONFIG_DATABASE_CONNECTION_TIMEOUT_MS, 5000),
            ssl: ['require', 'true', '1', 'yes', 'on'].includes(
                String(process.env.CONFIG_DATABASE_SSL ?? '').trim().toLowerCase()
            )
                ? { rejectUnauthorized: false }
                : false,
        },
        lmdbPath: process.env.LMDB_DATA_DIR || '/app/data/lmdb',
        configEncryptionEnabled: Boolean(process.env.CONFIG_ENCRYPTION_SECRET),
    },
    cache: {
        ttlSeconds: parsePositiveInt(process.env.CACHE_TTL_SECONDS, 259200),
        negativeTtlSeconds: parsePositiveInt(process.env.NEGATIVE_CACHE_TTL_SECONDS, 21600),
        // Long-lived backup of successful results, used as fallback when
        // upstream is rate-limited and the fresh cache has expired.
        staleFallbackTtlSeconds: parsePositiveInt(process.env.STALE_FALLBACK_TTL_SECONDS, 14 * 86400),
    },
    ratings: userConfig.ratings,
    sources: {
        imdbBaseUrl: process.env.IMDB_BASE_URL || 'https://www.imdb.com',
        commonSenseBaseUrl: process.env.COMMONSENSE_BASE_URL || 'https://www.commonsensemedia.org',
        cringeMdbBaseUrl: process.env.CRINGEMDB_BASE_URL || 'https://cringemdb.com',
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

console.info('BYOB mode enabled. Stream routes require a saved UUID config.');

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

if (hasFatalError) {
    console.error('Critical configuration missing. Please check environment variables. Exiting.');
    process.exit(1);
} else if (hasWarning) {
    console.warn('One or more configuration warnings detected. Service might not function fully.');
}

module.exports = config;
