const test = require('node:test');
const assert = require('node:assert/strict');

const {
    orderIndexForSource,
    processSingleRating,
    sourceMatchesEnabled,
} = require('../src/services/ratingHelpers');

test('treats Content Safety as the single user-facing safety option', () => {
    assert.equal(sourceMatchesEnabled('Common Sense', ['Content Safety']), true);
    assert.equal(sourceMatchesEnabled('Parent Safe', ['Content Safety']), true);
    assert.equal(sourceMatchesEnabled('Not Safe', ['Content Safety']), true);
    assert.equal(sourceMatchesEnabled('Sexual Violence', ['Content Safety']), true);
    assert.equal(sourceMatchesEnabled('Sex & Nudity', ['Content Safety']), true);
    assert.equal(sourceMatchesEnabled('IMDb (Movie)', ['Content Safety']), false);
});

test('treats Parent Safe as enabled by existing safety-related configs', () => {
    assert.equal(sourceMatchesEnabled('Parent Safe', ['Common Sense']), true);
    assert.equal(sourceMatchesEnabled('Parent Safe', ['Not Safe']), true);
    assert.equal(sourceMatchesEnabled('Parent Safe', ['IMDb (Movie)']), false);
});

test('does not use Content Safety as a sorting control', () => {
    assert.equal(orderIndexForSource('Common Sense', ['Content Safety', 'IMDb']), Number.MAX_SAFE_INTEGER);
    assert.equal(orderIndexForSource('Parent Safe', ['Content Safety', 'IMDb']), Number.MAX_SAFE_INTEGER);
    assert.equal(orderIndexForSource('Sex & Nudity', ['Content Safety', 'IMDb']), Number.MAX_SAFE_INTEGER);
});

test('orders Parent Safe beside existing safety-related config entries', () => {
    assert.equal(orderIndexForSource('Parent Safe', ['Common Sense', 'IMDb']), 0);
    assert.equal(orderIndexForSource('Parent Safe', ['Not Safe', 'IMDb']), 0);
});


test('normalizes legacy short rating labels to public names', () => {
    assert.deepEqual(processSingleRating({ source: 'MC', value: '73/100' }, 'movie'), {
        source: 'Metacritic',
        value: '73/100',
    });
    assert.deepEqual(processSingleRating({ source: 'RT', value: '88/100' }, 'movie'), {
        source: 'Rotten Tomatoes',
        value: '88/100',
    });
    assert.deepEqual(processSingleRating({ source: 'PC', value: '90/100' }, 'movie'), {
        source: 'Popcornmeter',
        value: '90/100',
    });
    assert.deepEqual(processSingleRating({ source: 'MAL', value: '8.1/10' }, 'series'), {
        source: 'MyAnimeList',
        value: '8.1/10',
    });
});

test('keeps old short labels working in saved config filters and order', () => {
    assert.equal(sourceMatchesEnabled('Metacritic', ['MC']), true);
    assert.equal(sourceMatchesEnabled('Rotten Tomatoes', ['RT']), true);
    assert.equal(sourceMatchesEnabled('Popcornmeter', ['PC']), true);
    assert.equal(sourceMatchesEnabled('MyAnimeList', ['MAL']), true);

    assert.equal(orderIndexForSource('Metacritic', ['IMDb', 'MC']), 1);
    assert.equal(orderIndexForSource('Rotten Tomatoes', ['RT', 'IMDb']), 0);
    assert.equal(orderIndexForSource('Popcornmeter', ['IMDb', 'PC']), 1);
    assert.equal(orderIndexForSource('MyAnimeList', ['MAL', 'IMDb']), 0);
});
