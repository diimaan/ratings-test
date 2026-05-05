const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-instance-defaults';
process.env.TMDB_API_KEY = 'instance-default-tmdb';
process.env.MDBLIST_API_KEY = 'instance-default-mdblist';
process.env.IMDB_DATASET_MODE = 'disabled';

const userConfigService = require('../src/services/userConfigService');

function rawUserConfig(overrides = {}) {
    return {
        id: 'fixture-id',
        version: 1,
        cacheKey: 'placeholder',
        providers: {
            tmdb: { apiKey: '', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
            jikan: { apiUrl: 'https://api.jikan.moe/v4' },
            ...overrides.providers,
        },
        ratings: {
            enabled: ['IMDb (Movie)'],
            order: ['IMDb (Movie)'],
            displayMode: 'auto',
            compactLimit: 4,
            safetySource: 'hybrid',
            ...overrides.ratings,
        },
    };
}

test('applyInstanceDefaultProviderKeys fills empty user keys with operator env keys', () => {
    const resolved = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig());
    assert.equal(resolved.providers.tmdb.apiKey, 'instance-default-tmdb');
    assert.equal(resolved.providers.mdblist.apiKey, 'instance-default-mdblist');
    assert.equal(resolved.providers.publicmetadb.apiKey, '');
});

test('applyInstanceDefaultProviderKeys preserves user-supplied keys (no overwrite)', () => {
    const resolved = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig({
        providers: {
            tmdb: { apiKey: 'user-tmdb-key', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
            jikan: { apiUrl: 'https://api.jikan.moe/v4' },
        },
    }));
    assert.equal(resolved.providers.tmdb.apiKey, 'user-tmdb-key');
    assert.equal(resolved.providers.mdblist.apiKey, 'instance-default-mdblist');
});

test('cache fingerprint after resolution is identical for two empty-key users', () => {
    const a = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig({ providers: { tmdb: { apiKey: '', apiUrl: 'https://api.themoviedb.org/3' } } }));
    const b = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig({ providers: { tmdb: { apiKey: '', apiUrl: 'https://api.themoviedb.org/3' } } }));
    assert.equal(a.cacheKey, b.cacheKey);
});

test('cache fingerprint matches across users with own keys vs instance defaults (shared cache)', () => {
    const empty = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig());
    const own = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig({
        providers: {
            tmdb: { apiKey: 'separate-user-key', apiUrl: 'https://api.themoviedb.org/3' },
            mdblist: { apiKey: '', apiUrl: 'https://api.mdblist.com' },
            publicmetadb: { apiKey: '', apiUrl: 'https://publicmetadb.com' },
            jikan: { apiUrl: 'https://api.jikan.moe/v4' },
        },
    }));
    // Same apiUrls + same safetySource => same shared scope. Tier
    // differences are handled by richness-gated writes (see ratingService).
    assert.equal(empty.cacheKey, own.cacheKey);
});

test('instanceDefaultProvidersAvailable reports which env keys are populated', () => {
    const flags = userConfigService.instanceDefaultProvidersAvailable();
    assert.equal(flags.tmdb, true);
    assert.equal(flags.mdblist, true);
    assert.equal(flags.publicmetadb, false);
});

test('publicConfigView never exposes resolved instance default keys', () => {
    const resolved = userConfigService.applyInstanceDefaultProviderKeys(rawUserConfig());
    // `publicConfigView` exposes only `configured` flags, never the apiKey itself.
    const view = userConfigService.publicConfigView(resolved);
    assert.equal(view.providers.tmdb.apiKey, undefined);
    assert.equal(view.providers.mdblist.apiKey, undefined);
});
