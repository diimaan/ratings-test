const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const skipReason = TEST_REDIS_URL
    ? null
    : 'TEST_REDIS_URL not set; skipping Redis-backed richness tests.';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.REDIS_URL = TEST_REDIS_URL || 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-redis-richness';
process.env.IMDB_DATASET_MODE = 'disabled';

const redisClient = require('../src/cache/redisClient');

async function ensureReady() {
    if (!redisClient.isReady()) {
        await redisClient.connect();
    }
    for (let i = 0; i < 50 && !redisClient.isReady(); i += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!redisClient.isReady()) throw new Error('Redis did not become ready');
}

const opts = skipReason ? { skip: skipReason } : {};

test('cache write stores richness alongside ratings; reads filter the meta field', opts, async (t) => {
    await ensureReady();
    const key = `ratings:test:richness:${Date.now()}`;
    t.after(async () => { redisClient.getClient()?.del(key); await redisClient.disconnect(); });

    const ratings = [
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'TMDb (Movie)', value: '82/100' },
    ];
    await redisClient.setRatingsHash(key, ratings, 60, { richness: 5 });

    const out = await redisClient.getRatingsHash(key);
    // No __richness__ leaks back as a rating
    assert.deepEqual(
        out.map(r => r.source).sort(),
        ['IMDb (Movie)', 'TMDb (Movie)'],
    );

    const richness = await redisClient.getRatingsHashRichness(key);
    assert.equal(richness, 5);
});

test('overwriting cache with new ratings DELs old fields (no stale sources stick around)', opts, async (t) => {
    await ensureReady();
    const key = `ratings:test:rewrite:${Date.now()}`;
    t.after(async () => { redisClient.getClient()?.del(key); await redisClient.disconnect(); });

    await redisClient.setRatingsHash(key, [
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'Letterboxd', value: '4.0/5' },
    ], 60, { richness: 2 });

    // Rewrite with a different shape — Letterboxd should disappear.
    await redisClient.setRatingsHash(key, [
        { source: 'IMDb (Movie)', value: '8.8/10' },
        { source: 'Metacritic', value: '73/100' },
    ], 60, { richness: 2 });

    const out = await redisClient.getRatingsHash(key);
    const sources = out.map(r => r.source).sort();
    assert.deepEqual(sources, ['IMDb (Movie)', 'Metacritic']);
    assert.equal(out.find(r => r.source === 'IMDb (Movie)').value, '8.8/10');
});
