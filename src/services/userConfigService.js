const crypto = require('crypto');
const config = require('../config');
const userConfigStore = require('../storage/userConfigStore');
const {
    buildUserConfigFromInput,
    buildCacheFingerprint,
} = require('../config/userConfig');
const {
    validateUserConfigProviders,
} = require('./providerValidation');

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_KEY_LENGTH = 64;

async function getDefaultUserConfig() {
    return config.userConfig;
}

function applyServerSafetySource(userConfig) {
    if (!userConfig) return userConfig;

    const normalized = {
        ...userConfig,
        ratings: {
            ...userConfig.ratings,
            safetySource: config.userConfig.ratings.safetySource,
        },
    };

    normalized.cacheKey = buildCacheFingerprint(normalized);
    return normalized;
}

// Fill blank user-supplied provider keys with the operator-provided
// instance defaults from env (TMDB_API_KEY etc.). Used for streaming-time
// userConfig only — never for views that round-trip back to the user, so
// the operator's keys never leak into responses.
function applyInstanceDefaultProviderKeys(userConfig) {
    if (!userConfig) return userConfig;

    const defaults = config.userConfig.providers;
    const resolved = {
        ...userConfig,
        providers: {
            ...userConfig.providers,
            tmdb: {
                ...userConfig.providers.tmdb,
                apiKey: userConfig.providers.tmdb.apiKey || defaults.tmdb.apiKey || '',
            },
            mdblist: {
                ...userConfig.providers.mdblist,
                apiKey: userConfig.providers.mdblist.apiKey || defaults.mdblist.apiKey || '',
            },
            publicmetadb: {
                ...userConfig.providers.publicmetadb,
                apiKey: userConfig.providers.publicmetadb.apiKey || defaults.publicmetadb.apiKey || '',
            },
        },
    };

    // Recompute fingerprint so cache scope tracks the EFFECTIVE key.
    // Two empty-key users sharing the same instance default share cache;
    // rotating the instance key invalidates their caches naturally.
    resolved.cacheKey = buildCacheFingerprint(resolved);
    return resolved;
}

function instanceDefaultProvidersAvailable() {
    const defaults = config.userConfig.providers;
    return {
        tmdb: Boolean(defaults.tmdb?.apiKey),
        mdblist: Boolean(defaults.mdblist?.apiKey),
        publicmetadb: Boolean(defaults.publicmetadb?.apiKey),
    };
}

async function getUserConfigById(configId) {
    if (!configId || configId === 'default') {
        return getDefaultUserConfig();
    }

    const stored = await userConfigStore.getUserConfig(configId);
    // Streaming path: resolve instance defaults so the rating service sees
    // a complete config.
    return applyInstanceDefaultProviderKeys(applyServerSafetySource(stored));
}

function publicConfigView(userConfig) {
    const publicRatings = { ...userConfig.ratings };
    delete publicRatings.safetySource;

    return {
        id: userConfig.id,
        version: userConfig.version,
        providers: {
            tmdb: {
                apiUrl: userConfig.providers.tmdb.apiUrl,
                configured: Boolean(userConfig.providers.tmdb.apiKey),
            },
            mdblist: {
                apiUrl: userConfig.providers.mdblist.apiUrl,
                configured: Boolean(userConfig.providers.mdblist.apiKey),
            },
            publicmetadb: {
                apiUrl: userConfig.providers.publicmetadb.apiUrl,
                configured: Boolean(userConfig.providers.publicmetadb.apiKey),
            },
            jikan: {
                apiUrl: userConfig.providers.jikan.apiUrl,
            },
        },
        ratings: publicRatings,
    };
}

function privateConfigView(userConfig) {
    return {
        ...publicConfigView(userConfig),
        providers: {
            tmdb: {
                ...publicConfigView(userConfig).providers.tmdb,
                apiKey: userConfig.providers.tmdb.apiKey || '',
            },
            mdblist: {
                ...publicConfigView(userConfig).providers.mdblist,
                apiKey: userConfig.providers.mdblist.apiKey || '',
            },
            publicmetadb: {
                ...publicConfigView(userConfig).providers.publicmetadb,
                apiKey: userConfig.providers.publicmetadb.apiKey || '',
            },
            jikan: publicConfigView(userConfig).providers.jikan,
        },
    };
}

function scryptAsync(password, salt, keyLength) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, keyLength, (err, derived) => {
            if (err) reject(err);
            else resolve(derived);
        });
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('base64url');
    const derived = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH);
    return `${PASSWORD_HASH_PREFIX}:${salt}:${derived.toString('base64url')}`;
}

async function verifyPassword(password, passwordHash) {
    if (!password || !passwordHash) return false;

    const [prefix, salt, storedHash] = String(passwordHash).split(':');
    if (prefix !== PASSWORD_HASH_PREFIX || !salt || !storedHash) return false;

    const candidate = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH);
    const stored = Buffer.from(storedHash, 'base64url');

    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
}

function assertValidPassword(password) {
    if (!password || String(password).length < 8) {
        const err = new Error('Config password must be at least 8 characters.');
        err.statusCode = 400;
        throw err;
    }
}

async function createUserConfig(input = {}) {
    assertValidPassword(input.password);

    const id = crypto.randomUUID();
    const userConfig = applyServerSafetySource(buildUserConfigFromInput({
        ...input,
        id,
    }, config.userConfig));

    // Validation handles instance-default fallback internally; we always
    // persist the user's actual input so the operator's keys never end up
    // in the user's encrypted blob.
    await validateUserConfigProviders(userConfig);
    const passwordHash = await hashPassword(input.password);
    await userConfigStore.saveUserConfig(userConfig, passwordHash);
    return userConfig;
}

async function getUserConfigForPassword(configId, password) {
    const record = await userConfigStore.getUserConfigRecord(configId);
    if (!record || !(await verifyPassword(password, record.passwordHash))) {
        const err = new Error('Invalid config UUID or password.');
        err.statusCode = 401;
        throw err;
    }

    return applyServerSafetySource(record.config);
}

async function updateUserConfig(configId, input = {}) {
    const existing = await getUserConfigForPassword(configId, input.password);
    const userConfig = applyServerSafetySource(buildUserConfigFromInput({
        ...input,
        id: existing.id,
    }, config.userConfig));

    await validateUserConfigProviders(userConfig);
    await userConfigStore.saveUserConfig(userConfig);
    return userConfig;
}

async function deleteUserConfig(configId, password) {
    await getUserConfigForPassword(configId, password);
    return userConfigStore.deleteUserConfig(configId);
}

async function changeUserConfigPassword(configId, currentPassword, newPassword) {
    await getUserConfigForPassword(configId, currentPassword);
    assertValidPassword(newPassword);
    const passwordHash = await hashPassword(newPassword);
    return userConfigStore.setUserConfigPasswordHash(configId, passwordHash);
}

module.exports = {
    getDefaultUserConfig,
    getUserConfigById,
    getUserConfigForPassword,
    createUserConfig,
    updateUserConfig,
    deleteUserConfig,
    changeUserConfigPassword,
    publicConfigView,
    privateConfigView,
    instanceDefaultProvidersAvailable,
    applyInstanceDefaultProviderKeys,
};
