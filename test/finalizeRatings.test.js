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

test('prioritizes native IMDb and TMDb over aggregate fallback results', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [{ source: 'IMDb (Movie)', value: '8.7/10' }],
        tmdbResults: [{ source: 'TMDb (Movie)', value: '82/100' }],
        malResults: [],
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

test('honors custom rating order after provider family selection', () => {
    const ratings = finalizeRatings({
        type: 'movie',
        imdbResults: [{ source: 'IMDb (Movie)', value: '8.7/10' }],
        tmdbResults: [{ source: 'TMDb (Movie)', value: '82/100' }],
        malResults: [],
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
