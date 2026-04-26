const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = 'test-tmdb-key';
process.env.MDBLIST_API_KEY = 'test-mdblist-key';
process.env.PUBLICMETADB_API_KEY = 'test-publicmetadb-key';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-finalize-ratings';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    finalizeRatings,
} = require('../src/services/finalizeRatings');

function userConfig({ enabled, order }) {
    return {
        ratings: {
            enabled,
            order,
            displayMode: 'full',
            compactLimit: 4,
        },
    };
}

test('prioritizes local IMDb and native TMDb over aggregate fallback results', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [{ source: 'IMDb (Movie)', value: '8.7/10' }],
        tmdbResults: [{ source: 'TMDb (Movie)', value: '82/100' }],
        malResults: [],
        directSafetyResults: [],
        mdblistDerivedResults: [],
        metaResults: [
            { source: 'IMDb', value: '7.1/10' },
            { source: 'TMDb', value: '70/100' },
        ],
        mdblistResults: [
            { source: 'IMDb', value: '6.9/10' },
            { source: 'TMDb', value: '68/100' },
            { source: 'MC', value: '73/100' },
        ],
        userConfig: userConfig({
            enabled: ['IMDb (Movie)', 'TMDb (Movie)', 'MC'],
            order: ['IMDb (Movie)', 'TMDb (Movie)', 'MC'],
        }),
    });

    assert.deepEqual(ratings.map(item => item.source), ['IMDb (Movie)', 'TMDb (Movie)', 'MC']);
    assert.equal(ratings[0].value, '8.7/10');
    assert.equal(ratings[1].value, '82/100');
    assert.equal(ratings[2].value, '73/100');
});

test('uses aggregate IMDb fallback when local IMDb result is missing', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [],
        tmdbResults: [],
        malResults: [],
        directSafetyResults: [],
        mdblistDerivedResults: [],
        metaResults: [
            { source: 'IMDb', value: '7.1/10' },
        ],
        mdblistResults: [
            { source: 'IMDb', value: '6.9/10' },
        ],
        userConfig: userConfig({
            enabled: ['IMDb (Movie)'],
            order: ['IMDb (Movie)'],
        }),
    });

    assert.deepEqual(ratings, [
        { source: 'IMDb (Movie)', value: '7.1/10' },
    ]);
});

test('uses MDBList IMDb fallback when local and PublicMetaDB results are missing', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [],
        tmdbResults: [],
        malResults: [],
        directSafetyResults: [],
        mdblistDerivedResults: [],
        metaResults: [],
        mdblistResults: [
            { source: 'IMDb', value: '6.9/10' },
        ],
        userConfig: userConfig({
            enabled: ['IMDb (Movie)'],
            order: ['IMDb (Movie)'],
        }),
    });

    assert.deepEqual(ratings, [
        { source: 'IMDb (Movie)', value: '6.9/10' },
    ]);
});

test('honors custom rating order after provider family selection', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [{ source: 'IMDb (Movie)', value: '8.7/10' }],
        tmdbResults: [{ source: 'TMDb (Movie)', value: '82/100' }],
        malResults: [],
        directSafetyResults: [],
        mdblistDerivedResults: [{ source: 'Common Sense', value: '16+' }],
        metaResults: [],
        mdblistResults: [{ source: 'MC', value: '73/100' }],
        userConfig: userConfig({
            enabled: ['Common Sense', 'MC', 'TMDb (Movie)', 'IMDb (Movie)'],
            order: ['Common Sense', 'MC', 'TMDb (Movie)', 'IMDb (Movie)'],
        }),
    });

    assert.deepEqual(
        ratings.map(item => item.source),
        ['Common Sense', 'MC', 'TMDb (Movie)', 'IMDb (Movie)']
    );
});

test('prioritizes direct safety results over MDBList-derived safety results', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [],
        tmdbResults: [],
        malResults: [],
        directSafetyResults: [
            { source: 'Common Sense', value: '13+' },
            { source: 'Parent Safe', value: '✅ Certified Parent Safe' },
        ],
        mdblistDerivedResults: [
            { source: 'Common Sense', value: '17+' },
            { source: 'Not Safe', value: '⚠️ Not Safe' },
        ],
        metaResults: [],
        mdblistResults: [],
        userConfig: userConfig({
            enabled: ['Common Sense', 'Parent Safe', 'Not Safe'],
            order: ['Common Sense', 'Parent Safe', 'Not Safe'],
        }),
    });

    assert.deepEqual(ratings, [
        { source: 'Common Sense', value: '13+' },
        { source: 'Parent Safe', value: '✅ Certified Parent Safe' },
    ]);
});

test('keeps MDBList-derived warnings when direct safety only returns an age rating', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [],
        tmdbResults: [],
        malResults: [],
        directSafetyResults: [
            { source: 'Common Sense', value: '13+' },
        ],
        mdblistDerivedResults: [
            { source: 'Common Sense', value: '17+' },
            { source: 'Not Safe', value: '⚠️ Not Safe' },
            { source: 'Sex & Nudity', value: '🫣 Sex & Nudity' },
        ],
        metaResults: [],
        mdblistResults: [],
        userConfig: userConfig({
            enabled: ['Common Sense', 'Not Safe', 'Sex & Nudity'],
            order: ['Common Sense', 'Not Safe', 'Sex & Nudity'],
        }),
    });

    assert.deepEqual(ratings, [
        { source: 'Common Sense', value: '13+' },
        { source: 'Not Safe', value: '⚠️ Not Safe' },
        { source: 'Sex & Nudity', value: '🫣 Sex & Nudity' },
    ]);
});
