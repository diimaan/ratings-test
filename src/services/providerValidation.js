const axios = require('axios');
const config = require('../config');

function createValidationError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

async function validateTmdb(providerConfig) {
    if (!providerConfig?.apiKey) {
        throw createValidationError('TMDb API key is required.');
    }

    const res = await axios.get(`${providerConfig.apiUrl}/configuration`, {
        timeout: config.http.requestTimeoutMs || 12000,
        params: { api_key: providerConfig.apiKey },
        validateStatus: status => status >= 200 && status < 500,
    });

    if (res.status === 401) {
        throw createValidationError('TMDb API key is invalid or unauthorized.');
    }

    if (res.status !== 200) {
        throw createValidationError(`TMDb key validation failed with status ${res.status}.`);
    }
}

async function validateMdblist(providerConfig) {
    if (!providerConfig?.apiKey) return;

    const res = await axios.get(`${providerConfig.apiUrl}/imdb/movie/tt0133093`, {
        timeout: config.http.requestTimeoutMs || 12000,
        params: { apikey: providerConfig.apiKey },
        validateStatus: status => status >= 200 && status < 500,
    });

    if (res.status === 401 || res.status === 403) {
        throw createValidationError('MDBList API key is invalid or unauthorized.');
    }

    if (res.status !== 200 && res.status !== 404) {
        throw createValidationError(`MDBList key validation failed with status ${res.status}.`);
    }
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
