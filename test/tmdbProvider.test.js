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
    normalizeSeasonEpisodes,
    buildEpisodeRatingResult,
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

test('normalizes TMDb season episode ratings with vote counts for cache storage', () => {
    assert.deepEqual(normalizeSeasonEpisodes({
        episodes: [
            { episode_number: 1, vote_average: 7.9, vote_count: 80 },
            { episode_number: 2, vote_average: 8, vote_count: 114 },
            { episode_number: 3, vote_average: 0, vote_count: 25 },
            { episode_number: 4, vote_average: 7.2, vote_count: 0 },
        ],
    }), {
        1: { voteAverage: 7.9, voteCount: 80 },
        2: { voteAverage: 8, voteCount: 114 },
    });
});

test('builds TMDb episode result from cached season rating data', () => {
    assert.deepEqual(buildEpisodeRatingResult(76479, 3, 2, {
        voteAverage: 8,
        voteCount: 114,
    }), {
        source: 'TMDb Episode',
        value: '80/100',
        count: 114,
        url: 'https://www.themoviedb.org/tv/76479/season/3/episode/2',
    });

    assert.equal(buildEpisodeRatingResult(76479, 3, 2, {
        voteAverage: 8,
        voteCount: 0,
    }), null);
});
