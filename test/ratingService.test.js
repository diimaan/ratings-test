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
    getInFlightRequestCount,
    runWithInFlight,
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

test('deduplicates concurrent in-flight requests by cache key', async () => {
    let calls = 0;
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });

    const factory = async () => {
        calls += 1;
        await gate;
        return [{ source: 'IMDb (Movie)', value: '8.0/10' }];
    };

    const first = runWithInFlight('ratings:test:same', 'same', factory);
    const second = runWithInFlight('ratings:test:same', 'same', factory);

    assert.equal(calls, 1);
    assert.equal(getInFlightRequestCount(), 1);

    release();

    assert.deepEqual(await first, [{ source: 'IMDb (Movie)', value: '8.0/10' }]);
    assert.deepEqual(await second, [{ source: 'IMDb (Movie)', value: '8.0/10' }]);
    assert.equal(getInFlightRequestCount(), 0);
});

test('keeps different in-flight cache keys isolated', async () => {
    let calls = 0;

    const one = runWithInFlight('ratings:test:one', 'one', async () => {
        calls += 1;
        return 'one';
    });

    const two = runWithInFlight('ratings:test:two', 'two', async () => {
        calls += 1;
        return 'two';
    });

    assert.equal(await one, 'one');
    assert.equal(await two, 'two');
    assert.equal(calls, 2);
    assert.equal(getInFlightRequestCount(), 0);
});
