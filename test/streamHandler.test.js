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
    classifyUserAgent,
    uaHash,
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
        { source: 'Metacritic', value: '73/100' },
        { source: 'IMDb (Movie)', value: '8.7/10' },
        { source: 'TMDb (Movie)', value: '82/100' },
        { source: 'Rotten Tomatoes', value: '88/100' },
    ];

    try {
        const payload = await streamHandler({
            type: 'movie',
            id: 'tt0133093',
            userConfig: userConfig('compact', 2),
        });

        assert.equal(payload.streams.length, 1);
        assert.match(payload.streams[0].description, /🎬 IMDb 8.7 \| 🎬 TMDb 82/);
        assert.doesNotMatch(payload.streams[0].description, /Metacritic/);
        assert.doesNotMatch(payload.streams[0].description, /Rotten Tomatoes/);
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

test('full output adds not parent safe verdict when sexual warning has no explicit safety verdict', async () => {
    const originalGetRatings = ratingService.getRatings;
    ratingService.getRatings = async () => [
        { source: 'Common Sense', value: '15+' },
        { source: 'IMDb (Movie)', value: '7.1/10' },
        { source: 'Sex & Nudity', value: '🫣 Sex & Nudity' },
    ];

    try {
        const payload = await streamHandler({
            type: 'movie',
            id: 'tt0133093',
            userConfig: userConfig('full', 4),
        });

        const description = payload.streams[0].description;
        assert.match(description, /👪 15\+/);
        assert.match(description, /⚠️ Not Parent Safe\n🫣 Sex & Nudity/);
    } finally {
        ratingService.getRatings = originalGetRatings;
    }
});

test('compact output adds not parent safe verdict when sexual warning has no explicit safety verdict', async () => {
    const originalGetRatings = ratingService.getRatings;
    ratingService.getRatings = async () => [
        { source: 'Common Sense', value: '15+' },
        { source: 'IMDb (Movie)', value: '7.1/10' },
        { source: 'Sex & Nudity', value: '🫣 Sex & Nudity' },
    ];

    try {
        const payload = await streamHandler({
            type: 'movie',
            id: 'tt0133093',
            userConfig: userConfig('compact', 4),
        });

        const description = payload.streams[0].description;
        assert.match(description, /👪 15\+/);
        assert.match(description, /⚠️ Not Parent Safe\n🫣 Sex & Nudity/);
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
    const tvUserAgents = [
        'Mozilla/5.0 (Linux; Android TV 12; Chromecast) Stremio/1.6.12',
        'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0)',
        'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36',
        'Mozilla/5.0 (Linux; Android 11; AFTMM) AppleWebKit/537.36',
        'Mozilla/5.0 (AppleTV; CPU OS 17_0 like Mac OS X)',
        'Roku/DVP-12.5',
        'Mozilla/5.0 (PlayStation 5 3.20) AppleWebKit/605.1.15',
        'Mozilla/5.0 (Xbox; Xbox Series X) AppleWebKit/537.36',
        'Mozilla/5.0 (Linux; U; VIDAA TV) AppleWebKit/537.36',
        'Mozilla/5.0 (BRAVIA 4K VH2) AppleWebKit/537.36',
    ];

    for (const userAgent of tvUserAgents) {
        assert.equal(resolveDisplayMode(userConfig('auto'), {
            'user-agent': userAgent,
        }), 'compact');
    }
});

test('display mode auto uses full output for desktop user agents', () => {
    assert.equal(resolveDisplayMode(userConfig('auto'), {
        'user-agent': 'StremioShell/4.4.0 (Macintosh; Intel Mac OS X 10_15_7)',
    }), 'full');
});

test('display mode auto uses full output for mobile and browser user agents', () => {
    const userAgents = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/123.0 Mobile Safari/537.36',
        'Stremio/1.6.13 (Android 14; Pixel 8 Pro)',
        'Stremio/1.6.13 (iPhone; iOS 17.0)',
        'Mozilla/5.0 AppleWebKit/537.36 Chrome/123.0 Safari/537.36',
    ];

    for (const userAgent of userAgents) {
        assert.equal(resolveDisplayMode(userConfig('auto'), {
            'user-agent': userAgent,
        }), 'full');
    }
});

test('display mode auto falls back to compact when user agent is missing', () => {
    assert.equal(resolveDisplayMode(userConfig('auto'), {}), 'compact');
});

test('display mode auto falls back to compact for unknown user agents', () => {
    assert.equal(resolveDisplayMode(userConfig('auto'), {
        'user-agent': 'CustomAddonClient/1.0',
    }), 'compact');
});

test('classifies user agent family and signals without logging raw user agent strings', () => {
    assert.equal(userAgentFamily('Mozilla/5.0 (Linux; Android TV) Stremio/1.6.12'), 'tv');
    assert.equal(userAgentFamily('StremioShell/4.4.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'desktop');
    assert.equal(userAgentFamily('Stremio/5.0.0 (desktop; Linux x86_64)'), 'desktop');
    assert.equal(userAgentFamily('Stremio/1.6.13 (Android 14; Pixel 8 Pro)'), 'mobile');
    assert.equal(userAgentFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/125.0'), 'web');
    assert.equal(userAgentFamily('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'mobile');
    assert.equal(userAgentFamily('Mozilla/5.0 AppleWebKit/537.36 Chrome/123.0 Safari/537.36'), 'web');
    assert.equal(userAgentFamily('CustomAddonClient/1.0'), 'unknown');
    assert.equal(userAgentFamily(''), 'missing');

    assert.deepEqual(classifyUserAgent('Mozilla/5.0 (Linux; Android TV) Stremio/1.6.12'), {
        family: 'tv',
        signals: ['android-tv'],
    });
});

test('hashes user agents for optional diagnostics without exposing raw values', () => {
    const first = uaHash('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const second = uaHash('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');

    assert.equal(first, second);
    assert.equal(first.length, 12);
    assert.notEqual(first, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
});
