const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-publicmetadb';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    buildRatingsUrl,
} = require('../src/providers/publicmetadb');

test('builds Public MetaDB ratings URL from host root', () => {
    assert.equal(
        buildRatingsUrl('https://publicmetadb.com'),
        'https://publicmetadb.com/api/external/ratings'
    );
});

test('builds Public MetaDB ratings URL from legacy /api base without duplicating path', () => {
    assert.equal(
        buildRatingsUrl('https://publicmetadb.com/api'),
        'https://publicmetadb.com/api/external/ratings'
    );
});
