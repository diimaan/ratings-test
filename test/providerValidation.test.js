const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-provider-validation';
process.env.IMDB_DATASET_MODE = 'disabled';

const config = require('../src/config');
const providerValidation = require('../src/services/providerValidation');

function rawConfig(overrides = {}) {
    return {
        providers: {
            tmdb: { apiKey: '', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
            jikan: { apiUrl: 'https://api.jikan.moe/v4' },
            ...overrides.providers,
        },
    };
}

test('validation fails when neither user TMDb key nor instance default is set', async () => {
    const originalTmdbKey = config.userConfig.providers.tmdb.apiKey;
    config.userConfig.providers.tmdb.apiKey = '';

    try {
        await assert.rejects(
            () => providerValidation.validateUserConfigProviders(rawConfig()),
            (err) => {
                assert.equal(err.statusCode, 400);
                assert.match(err.message, /TMDb API key is required/);
                assert.match(err.message, /no instance default/);
                return true;
            }
        );
    } finally {
        config.userConfig.providers.tmdb.apiKey = originalTmdbKey;
    }
});

test('validation skips upstream call when user TMDb key is empty AND instance default exists', async () => {
    const originalTmdbKey = config.userConfig.providers.tmdb.apiKey;
    config.userConfig.providers.tmdb.apiKey = 'instance-default-key';

    try {
        // Should not throw — instance default is trusted; we don't hammer
        // upstream APIs to re-validate the operator's keys on every signup.
        await providerValidation.validateUserConfigProviders(rawConfig());
    } finally {
        config.userConfig.providers.tmdb.apiKey = originalTmdbKey;
    }
});

test('validation passes when MDBList key is missing and no instance default (MDBList is optional)', async () => {
    const originalMdblist = config.userConfig.providers.mdblist.apiKey;
    const originalTmdb = config.userConfig.providers.tmdb.apiKey;
    config.userConfig.providers.mdblist.apiKey = '';
    config.userConfig.providers.tmdb.apiKey = 'instance-default-tmdb';

    try {
        await providerValidation.validateUserConfigProviders(rawConfig());
    } finally {
        config.userConfig.providers.mdblist.apiKey = originalMdblist;
        config.userConfig.providers.tmdb.apiKey = originalTmdb;
    }
});
