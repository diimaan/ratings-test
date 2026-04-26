const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-tmdb-provider';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    buildTmdbFindRating,
} = require('../src/utils/tmdbService');
const {
    ratingFromFindData,
} = require('../src/providers/tmdb');

test('builds TMDb find rating only when vote average and count are usable', () => {
    assert.deepEqual(buildTmdbFindRating({
        vote_average: 7.8,
        vote_count: 42,
    }), {
        voteAverage: 7.8,
        voteCount: 42,
    });

    assert.equal(buildTmdbFindRating({ vote_average: 7.8, vote_count: 0 }), null);
    assert.equal(buildTmdbFindRating({ vote_average: 0, vote_count: 42 }), null);
    assert.equal(buildTmdbFindRating({}), null);
});

test('formats TMDb rating from find payload without another details lookup', () => {
    assert.deepEqual(ratingFromFindData(402, 'movie', {
        voteAverage: 7.8,
        voteCount: 42,
    }), {
        source: 'TMDb',
        value: '78/100',
        count: 42,
        url: 'https://www.themoviedb.org/movie/402',
    });
});
