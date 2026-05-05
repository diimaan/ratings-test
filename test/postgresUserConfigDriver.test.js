const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_PG_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_PG_URL
    ? null
    : 'TEST_DATABASE_URL not set; skipping Postgres driver integration tests.';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-postgres-driver';
process.env.CONFIG_STORE_DRIVER = 'postgres';
process.env.CONFIG_DATABASE_URL = TEST_PG_URL || 'postgres://placeholder';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.SQLITE_DB_PATH = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-postgres-driver-')),
    'unused.sqlite'
);

const userConfigStore = require('../src/storage/userConfigStore');

function buildSampleConfig(id) {
    return {
        id,
        version: 1,
        cacheKey: 'cache-key-1',
        providers: {
            tmdb: { apiKey: 'tmdb-key', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: 'mdb-key', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
            jikan: { apiUrl: 'https://api.jikan.moe/v4' },
        },
        ratings: {
            enabled: ['IMDb (Movie)'],
            order: ['IMDb (Movie)'],
            displayMode: 'auto',
            compactLimit: 4,
            safetySource: 'hybrid',
        },
    };
}

test('postgres driver round-trips configs and records', skipReason ? { skip: skipReason } : {}, async (t) => {
    await userConfigStore.init();

    t.after(async () => {
        await userConfigStore.close();
        userConfigStore._resetForTests();
    });

    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sample = buildSampleConfig(id);

    await userConfigStore.saveUserConfig(sample, 'scrypt:salt:hash');

    const fetched = await userConfigStore.getUserConfig(id);
    assert.equal(fetched.id, id);
    assert.equal(fetched.providers.tmdb.apiKey, 'tmdb-key');

    const record = await userConfigStore.getUserConfigRecord(id);
    assert.equal(record.passwordHash, 'scrypt:salt:hash');
    assert.equal(record.config.id, id);

    const updated = await userConfigStore.setUserConfigPasswordHash(id, 'scrypt:newsalt:newhash');
    assert.equal(updated, true);

    const refetched = await userConfigStore.getUserConfigRecord(id);
    assert.equal(refetched.passwordHash, 'scrypt:newsalt:newhash');

    const deleted = await userConfigStore.deleteUserConfig(id);
    assert.equal(deleted, true);

    const gone = await userConfigStore.getUserConfig(id);
    assert.equal(gone, null);
});

test('postgres driver health check returns ok when reachable', skipReason ? { skip: skipReason } : {}, async (t) => {
    await userConfigStore.init();
    t.after(async () => {
        await userConfigStore.close();
        userConfigStore._resetForTests();
    });

    const result = await userConfigStore.health();
    assert.equal(result.ok, true);
    assert.equal(result.driver, 'postgres');
});
