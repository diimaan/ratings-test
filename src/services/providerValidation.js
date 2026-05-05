const axios = require('axios');
const config = require('../config');
const redisClient = require('../cache/redisClient');
const logger = require('../utils/logger');

function createValidationError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

// Cache the result of validating a specific user-supplied API key for a
// short window. Avoids hammering upstream when:
//   - a single user submits the same key multiple times in a row
//     (network retry, slow form, etc.)
//   - many users coincidentally share a common key
// Cache scope is the operator's Redis. The key includes a hash of the
// candidate key so we never log the raw value.
const VALIDATION_CACHE_PREFIX = 'val:';
const VALIDATION_CACHE_TTL_SECONDS = 24 * 60 * 60; // 1 day

async function getCachedValidation(provider, keyHash) {
    if (!redisClient.isReady() || !keyHash) return null;
    try {
        const value = await redisClient.getClient()?.get(`${VALIDATION_CACHE_PREFIX}${provider}:${keyHash}`);
        return value || null;
    } catch (err) {
        logger.debug(`[ProviderValidation] cache read failed for ${provider}: ${err.message}`);
        return null;
    }
}

async function setCachedValidation(provider, keyHash, status) {
    if (!redisClient.isReady() || !keyHash) return;
    try {
        await redisClient.getClient()?.set(
            `${VALIDATION_CACHE_PREFIX}${provider}:${keyHash}`,
            status,
            { EX: VALIDATION_CACHE_TTL_SECONDS },
        );
    } catch (err) {
        logger.debug(`[ProviderValidation] cache write failed for ${provider}: ${err.message}`);
    }
}

function hashKey(value) {
    if (!value) return '';
    return require('crypto').createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function instanceDefaultKey(provider) {
    return config.userConfig?.providers?.[provider]?.apiKey || '';
}

async function validateTmdbKey(apiKey, apiUrl) {
    const res = await axios.get(`${apiUrl}/configuration`, {
        timeout: config.http.requestTimeoutMs || 12000,
        params: { api_key: apiKey },
        validateStatus: status => status >= 200 && status < 500,
    });

    if (res.status === 401) {
        await setCachedValidation('tmdb', hashKey(apiKey), 'invalid');
        throw createValidationError('TMDb API key is invalid or unauthorized.');
    }

    if (res.status !== 200) {
        throw createValidationError(`TMDb key validation failed with status ${res.status}.`);
    }
}

async function validateMdblistKey(apiKey, apiUrl) {
    const res = await axios.get(`${apiUrl}/imdb/movie/tt0133093`, {
        timeout: config.http.requestTimeoutMs || 12000,
        params: { apikey: apiKey },
        validateStatus: status => status >= 200 && status < 500,
    });

    if (res.status === 401 || res.status === 403) {
        await setCachedValidation('mdblist', hashKey(apiKey), 'invalid');
        throw createValidationError('MDBList API key is invalid or unauthorized.');
    }

    if (res.status !== 200 && res.status !== 404) {
        throw createValidationError(`MDBList key validation failed with status ${res.status}.`);
    }
}

async function validateTmdb(providerConfig) {
    const userKey = providerConfig?.apiKey || '';

    if (userKey) {
        const keyHash = hashKey(userKey);
        const cached = await getCachedValidation('tmdb', keyHash);
        if (cached === 'ok') {
            logger.debug('[ProviderValidation] TMDb cache hit; skipping upstream call');
            return;
        }
        if (cached === 'invalid') {
            throw createValidationError('TMDb API key is invalid or unauthorized.');
        }

        await validateTmdbKey(userKey, providerConfig.apiUrl);
        await setCachedValidation('tmdb', keyHash, 'ok');
        return;
    }

    if (instanceDefaultKey('tmdb')) {
        // Falling back to instance default; trust the operator (and avoid
        // hammering our own TMDb account on every signup).
        return;
    }

    throw createValidationError(
        'TMDb API key is required (no instance default is configured on this server).'
    );
}

async function validateMdblist(providerConfig) {
    const userKey = providerConfig?.apiKey || '';

    if (userKey) {
        const keyHash = hashKey(userKey);
        const cached = await getCachedValidation('mdblist', keyHash);
        if (cached === 'ok') {
            logger.debug('[ProviderValidation] MDBList cache hit; skipping upstream call');
            return;
        }
        if (cached === 'invalid') {
            throw createValidationError('MDBList API key is invalid or unauthorized.');
        }

        await validateMdblistKey(userKey, providerConfig.apiUrl);
        await setCachedValidation('mdblist', keyHash, 'ok');
        return;
    }

    // MDBList is optional — no error when neither user nor instance key is set.
}

async function validateUserConfigProviders(userConfig) {
    try {
        await validateTmdb(userConfig.providers.tmdb);
        await validateMdblist(userConfig.providers.mdblist);
    } catch (err) {
        if (err.statusCode) throw err;
        throw createValidationError(`Provider key validation failed: ${err.message}`);
    }
}

module.exports = {
    validateUserConfigProviders,
};
