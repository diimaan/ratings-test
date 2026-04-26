const test = require('node:test');
const assert = require('node:assert/strict');

const {
    orderIndexForSource,
    sourceMatchesEnabled,
} = require('../src/services/ratingHelpers');

test('treats Parent Safe as enabled by existing safety-related configs', () => {
    assert.equal(sourceMatchesEnabled('Parent Safe', ['Common Sense']), true);
    assert.equal(sourceMatchesEnabled('Parent Safe', ['Not Safe']), true);
    assert.equal(sourceMatchesEnabled('Parent Safe', ['IMDb (Movie)']), false);
});

test('orders Parent Safe beside existing safety-related config entries', () => {
    assert.equal(orderIndexForSource('Parent Safe', ['Common Sense', 'IMDb']), 0);
    assert.equal(orderIndexForSource('Parent Safe', ['Not Safe', 'IMDb']), 0);
});
