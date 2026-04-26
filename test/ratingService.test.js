const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-rating-service';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    hasTransientProviderIssue,
} = require('../src/services/ratingService');

test('detects transient provider markers in nested aggregate results', () => {
    assert.equal(hasTransientProviderIssue([
        [
            { source: 'IMDb', value: '8.0/10' },
            {
                _providerStatus: {
                    provider: 'MDBList',
                    transient: true,
                    error: 'timeout of 12000ms exceeded',
                },
            },
        ],
    ]), true);
});

test('ignores normal null and displayable aggregate results for transient detection', () => {
    assert.equal(hasTransientProviderIssue([
        null,
        [
            { source: 'IMDb', value: '8.0/10' },
            { source: 'TMDb', value: '80/100' },
        ],
    ]), false);
});
