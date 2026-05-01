const test = require('node:test');
const assert = require('node:assert/strict');

const {
    orderIndexForSource,
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
