const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const {
    buildUserConfigFromInput,
    buildCacheFingerprint,
} = require('../src/config/userConfig');

const baseConfig = {
    providers: {
        tmdb: { apiKey: '', apiUrl: 'https://api.themoviedb.org/3' },
        mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
        publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
        jikan: { apiUrl: 'https://api.jikan.moe/v4' },
    },
    ratings: {
        enabled: ['IMDb (Movie)', 'TMDb (Movie)'],
        order: ['IMDb (Movie)', 'TMDb (Movie)'],
        displayMode: 'auto',
        compactLimit: 4,
        safetySource: 'hybrid',
    },
};

function inputFor(overrides = {}) {
    return {
        id: 'test-id',
        providers: {
            tmdb: { apiKey: 'key-1', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: 'mdb-1', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
        },
        ratings: {
            enabled: ['IMDb (Movie)'],
            order: ['IMDb (Movie)'],
            displayMode: 'compact',
            compactLimit: 4,
            safetySource: 'hybrid',
            ...overrides,
        },
    };
}

test('cache fingerprint is stable across render-only preference changes', () => {
    const a = buildUserConfigFromInput(inputFor({ displayMode: 'compact' }), baseConfig);
    const b = buildUserConfigFromInput(inputFor({ displayMode: 'full' }), baseConfig);
    const c = buildUserConfigFromInput(inputFor({ compactLimit: 8 }), baseConfig);
    const d = buildUserConfigFromInput(inputFor({ enabled: ['TMDb (Movie)', 'IMDb (Movie)'] }), baseConfig);
    const e = buildUserConfigFromInput(inputFor({ order: ['TMDb (Movie)', 'IMDb (Movie)'] }), baseConfig);

    assert.equal(a.cacheKey, b.cacheKey);
    assert.equal(a.cacheKey, c.cacheKey);
    assert.equal(a.cacheKey, d.cacheKey);
    assert.equal(a.cacheKey, e.cacheKey);
});

test('cache fingerprint is STABLE across provider key changes (shared cache)', () => {
    // Upstream data is title-keyed, not user-keyed: any API key at the
    // same tier returns identical values. Cache scope is therefore shared
    // across users on the same apiUrls. Tier downgrades are prevented at
    // write time via the richness gate (see ratingService).
    const original = buildUserConfigFromInput(inputFor(), baseConfig);
    const rotated = buildUserConfigFromInput({
        ...inputFor(),
        providers: {
            tmdb: { apiKey: 'key-2', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: 'mdb-1', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
        },
    }, baseConfig);

    assert.equal(original.cacheKey, rotated.cacheKey);
});

test('cache fingerprint changes when an apiUrl changes (different upstream)', () => {
    const original = buildUserConfigFromInput(inputFor(), baseConfig);
    const rerouted = buildUserConfigFromInput({
        ...inputFor(),
        providers: {
            tmdb: { apiKey: '', apiUrl: 'https://my-tmdb-proxy.example' },
            mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
        },
    }, baseConfig);

    assert.notEqual(original.cacheKey, rerouted.cacheKey);
});

test('cache fingerprint changes when safetySource changes', () => {
    const hybrid = buildCacheFingerprint({
        version: 1,
        providers: baseConfig.providers,
        ratings: { ...baseConfig.ratings, safetySource: 'hybrid' },
    });
    const direct = buildCacheFingerprint({
        version: 1,
        providers: baseConfig.providers,
        ratings: { ...baseConfig.ratings, safetySource: 'direct' },
    });

    assert.notEqual(hybrid, direct);
});
