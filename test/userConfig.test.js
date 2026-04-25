const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseBoolean,
} = require('../src/config/userConfig');

test('parses boolean env-style values with a safe fallback', () => {
    assert.equal(parseBoolean('true'), true);
    assert.equal(parseBoolean('1'), true);
    assert.equal(parseBoolean('yes'), true);
    assert.equal(parseBoolean('on'), true);

    assert.equal(parseBoolean('false'), false);
    assert.equal(parseBoolean('0'), false);
    assert.equal(parseBoolean('no'), false);
    assert.equal(parseBoolean('off'), false);

    assert.equal(parseBoolean('', true), true);
    assert.equal(parseBoolean('unexpected', true), true);
    assert.equal(parseBoolean(undefined), false);
});
