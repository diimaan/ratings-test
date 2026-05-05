const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-shared-cache-richness';
process.env.IMDB_DATASET_MODE = 'disabled';

const ratingService = require('../src/services/ratingService');
const {
    finalizeRatings,
    applyUserDisplayPreferences,
} = require('../src/services/finalizeRatings');

test('richnessScore counts rating sources and weights safety signals', () => {
    assert.equal(ratingService.richnessScore([]), 0);
    assert.equal(ratingService.richnessScore(null), 0);
    assert.equal(ratingService.richnessScore([
        { source: 'IMDb (Movie)', value: '8.7/10' },
    ]), 1);
    assert.equal(ratingService.richnessScore([
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'TMDb (Movie)', value: '82/100' },
        { source: 'Metacritic', value: '73/100' },
    ]), 3);
});

test('richnessScore weights safety signals more heavily than plain ratings', () => {
    const plain = ratingService.richnessScore([
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'TMDb (Movie)', value: '82/100' },
    ]);
    const withSafety = ratingService.richnessScore([
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'TMDb (Movie)', value: '82/100' },
        { source: 'Common Sense', value: '13+' },
        { source: 'Sex & Nudity', value: '🫣 Sex & Nudity' },
    ]);
    // 2 plain ratings = 2 points; same + 2 safety = 2 + (2*2) = 6 points
    assert.equal(plain, 2);
    assert.equal(withSafety, 6);
    assert.ok(withSafety > plain);
});

test('finalizeRatings now returns ALL family-mapped ratings, sorted canonically by source', () => {
    const userConfig = {
        ratings: {
            enabled: ['IMDb (Movie)'], // user only wants IMDb
            order: ['IMDb (Movie)'],
            displayMode: 'full',
            compactLimit: 4,
        },
    };

    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [{ source: 'IMDb (Movie)', value: '8.7/10' }],
        tmdbResults: [{ source: 'TMDb (Movie)', value: '82/100' }],
        malResults: [],
        directSafetyResults: [],
        mdblistDerivedResults: [],
        metaResults: [],
        mdblistResults: [{ source: 'Metacritic', value: '73/100' }],
        userConfig,
    });

    // The user's `enabled` list is NOT applied here; finalizeRatings now
    // emits the full set so the same cached payload can serve users with
    // different display preferences.
    const sources = ratings.map(item => item.source);
    assert.ok(sources.includes('IMDb (Movie)'));
    assert.ok(sources.includes('TMDb (Movie)'));
    assert.ok(sources.includes('Metacritic'));

    // Per-user filtering happens here.
    const filtered = applyUserDisplayPreferences(ratings, userConfig);
    assert.deepEqual(filtered.map(item => item.source), ['IMDb (Movie)']);
});

test('applyUserDisplayPreferences honors per-user enabled and order independently', () => {
    const allFamilies = [
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'Metacritic', value: '73/100' },
        { source: 'TMDb (Movie)', value: '82/100' },
    ];

    const userA = applyUserDisplayPreferences(allFamilies, {
        ratings: {
            enabled: ['IMDb (Movie)', 'TMDb (Movie)'],
            order: ['TMDb (Movie)', 'IMDb (Movie)'],
            displayMode: 'full',
            compactLimit: 4,
        },
    });

    const userB = applyUserDisplayPreferences(allFamilies, {
        ratings: {
            enabled: ['Metacritic', 'IMDb (Movie)'],
            order: ['Metacritic', 'IMDb (Movie)'],
            displayMode: 'full',
            compactLimit: 4,
        },
    });

    assert.deepEqual(userA.map(item => item.source), ['TMDb (Movie)', 'IMDb (Movie)']);
    assert.deepEqual(userB.map(item => item.source), ['Metacritic', 'IMDb (Movie)']);
});
