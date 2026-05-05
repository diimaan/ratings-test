const axios = require('axios');
const config = require('../config');

function createValidationError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
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
        throw createValidationError('MDBList API key is invalid or unauthorized.');
    }

    if (res.status !== 200 && res.status !== 404) {
        throw createValidationError(`MDBList key validation failed with status ${res.status}.`);
    }
}

async function validateTmdb(providerConfig) {
    const userKey = providerConfig?.apiKey || '';

    if (userKey) {
        // User supplied a key — verify it works.
        await validateTmdbKey(userKey, providerConfig.apiUrl);
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
        await validateMdblistKey(userKey, providerConfig.apiUrl);
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
