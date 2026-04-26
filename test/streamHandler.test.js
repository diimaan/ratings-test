const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-stream-handler';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const ratingService = require('../src/services/ratingService');
const streamHandler = require('../src/handlers/streamHandler');
const {
    resolveDisplayMode,
    userAgentFamily,
} = streamHandler;

function userConfig(displayMode = 'compact', limit = 4) {
    return {
        ratings: {
            displayMode,
            compactLimit: limit,
            enabled: [],
            order: [],
        },
    };
}

test('compact movie output prioritizes native IMDb and TMDb before fallback ratings', async () => {
    const originalGetRatings = ratingService.getRatings;
    ratingService.getRatings = async () => [
        { source: 'MC', value: '73/100' },
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'TMDb (Movie)', value: '82/100' },
        { source: 'RT', value: '88/100' },
    ];

    try {
        const payload = await streamHandler({
            type: 'movie',
            id: 'tt0133093',
            userConfig: userConfig('compact', 2),
        });

        assert.equal(payload.streams.length, 1);
        assert.match(payload.streams[0].description, /🎬 IMDb 8.7 \| 🎬 TMDb 82/);
        assert.doesNotMatch(payload.streams[0].description, /MC/);
        assert.doesNotMatch(payload.streams[0].description, /RT/);
    } finally {
        ratingService.getRatings = originalGetRatings;
    }
});

test('compact series output prefers episode ratings over show ratings when both exist', async () => {
    const originalGetRatings = ratingService.getRatings;
    ratingService.getRatings = async () => [
        { source: 'Common Sense', value: '16+' },
        { source: 'IMDb (Show)', value: '8.1/10' },
        { source: 'IMDb (Episode)', value: '9.2/10' },
        { source: 'TMDb (Show)', value: '80/100' },
        { source: 'TMDb (Episode)', value: '91/100' },
        { source: 'Not Safe', value: '⚠️ Violence' },
    ];

    try {
        const payload = await streamHandler({
            type: 'series',
            id: 'tt0944947:1:9',
            userConfig: userConfig('compact', 4),
        });

        assert.equal(payload.streams.length, 1);

        const description = payload.streams[0].description;
        assert.match(description, /👪 16\+/);
        assert.match(description, /📺 IMDb Ep 9.2 \| 📺 TMDb Ep 91/);
        assert.doesNotMatch(description, /IMDb 8.1/);
        assert.doesNotMatch(description, /TMDb 80/);
        assert.match(description, /⚠️ Violence/);
    } finally {
        ratingService.getRatings = originalGetRatings;
    }
});

test('full output places positive parent safety verdict after main ratings', async () => {
    const originalGetRatings = ratingService.getRatings;
    ratingService.getRatings = async () => [
        { source: 'Common Sense', value: '13+' },
        { source: 'Parent Safe', value: '✅ Parent Safe' },
        { source: 'IMDb (Movie)', value: '7.4/10' },
        { source: 'TMDb (Movie)', value: '71/100' },
    ];

    try {
        const payload = await streamHandler({
            type: 'movie',
            id: 'tt0133093',
            userConfig: userConfig('full', 4),
        });

        const description = payload.streams[0].description;
        assert.match(description, /👪 13\+\n🎬 IMDb \(Movie\) - 7.4\n🎬 TMDb \(Movie\) - 71\n✅ Parent Safe/);
    } finally {
        ratingService.getRatings = originalGetRatings;
    }
});

test('display mode full and compact settings override user agent detection', () => {
    const tvHeaders = {
        'user-agent': 'Mozilla/5.0 (Linux; Android TV) Stremio/1.6.12',
    };
    const desktopHeaders = {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/123',
    };

    assert.equal(resolveDisplayMode(userConfig('full'), tvHeaders), 'full');
    assert.equal(resolveDisplayMode(userConfig('compact'), desktopHeaders), 'compact');
});

test('display mode auto uses TV-like user agents for compact output', () => {
    assert.equal(resolveDisplayMode(userConfig('auto'), {
        'user-agent': 'Mozilla/5.0 (Linux; Android TV 12; Chromecast) Stremio/1.6.12',
    }), 'compact');

    assert.equal(resolveDisplayMode(userConfig('auto'), {
        'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0)',
    }), 'compact');
});

test('display mode auto uses full output for desktop user agents', () => {
    assert.equal(resolveDisplayMode(userConfig('auto'), {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/123',
    }), 'full');
});

test('display mode auto falls back to compact when user agent is missing', () => {
    assert.equal(resolveDisplayMode(userConfig('auto'), {}), 'compact');
});

test('classifies user agent family without logging raw user agent strings', () => {
    assert.equal(userAgentFamily('Mozilla/5.0 (Linux; Android TV) Stremio/1.6.12'), 'tv');
    assert.equal(userAgentFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'non-tv');
    assert.equal(userAgentFamily(''), 'missing');
});
