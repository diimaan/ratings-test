const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-config-encryption';

const {
    decryptUserConfigSecrets,
    encryptUserConfigSecrets,
    isEncryptedValue,
} = require('../src/utils/configSecrets');

test('encrypts and decrypts provider API keys without changing non-secret config', () => {
    const userConfig = {
        id: 'test',
        version: 1,
        providers: {
            tmdb: {
                apiKey: 'tmdb-secret',
                apiUrl: 'https://api.themoviedb.org/3',
            },
            mdblist: {
                apiKey: 'mdblist-secret',
                apiUrl: 'https://api.mdblist.com',
            },
            publicmetadb: {
                apiKey: '',
                apiUrl: 'https://publicmetadb.com',
            },
            jikan: {
                apiUrl: 'https://api.jikan.moe/v4',
            },
        },
        ratings: {
            enabled: ['IMDb (Movie)'],
            order: ['IMDb (Movie)'],
            displayMode: 'compact',
            compactLimit: 1,
        },
    };

    const encrypted = encryptUserConfigSecrets(userConfig);

    assert.equal(isEncryptedValue(encrypted.providers.tmdb.apiKey), true);
    assert.equal(isEncryptedValue(encrypted.providers.mdblist.apiKey), true);
    assert.equal(encrypted.providers.publicmetadb.apiKey, '');
    assert.equal(encrypted.ratings.displayMode, 'compact');

    const decrypted = decryptUserConfigSecrets(encrypted);

    assert.equal(decrypted.providers.tmdb.apiKey, 'tmdb-secret');
    assert.equal(decrypted.providers.mdblist.apiKey, 'mdblist-secret');
    assert.equal(decrypted.providers.tmdb.apiUrl, 'https://api.themoviedb.org/3');
});
