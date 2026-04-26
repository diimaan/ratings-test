const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-derive-safety';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    deriveMdblistSafetyResults,
    normalizeSafetyCertification,
} = require('../src/services/deriveSafety');

test('derives Parent Safe only from explicit safety certification', () => {
    const derived = deriveMdblistSafetyResults([{
        _mdblist: {
            age: {
                commonSense: 13,
            },
            safety: {
                certification: 'Certified Parent Safe',
            },
            keywords: [],
        },
    }]);

    assert.deepEqual(derived, [
        { source: 'Common Sense', value: '13+' },
        { source: 'Parent Safe', value: '✅ Parent Safe' },
    ]);
});

test('does not infer Parent Safe from absent MDBList warnings', () => {
    const derived = deriveMdblistSafetyResults([{
        _mdblist: {
            age: {
                commonSense: 13,
            },
            keywords: [],
        },
    }]);

    assert.deepEqual(derived, [
        { source: 'Common Sense', value: '13+' },
    ]);
});

test('normalizes explicit unsafe safety certification', () => {
    assert.equal(normalizeSafetyCertification('Not Parent Safe'), 'unsafe');
    assert.equal(normalizeSafetyCertification('Certified Parent Safe'), 'safe');
    assert.equal(normalizeSafetyCertification(''), null);
});

test('derives sex and nudity warning from MDBList exact sex keyword', () => {
    const derived = deriveMdblistSafetyResults([{
        _mdblist: {
            age: {
                commonSense: 13,
                parentalNudity: 2,
            },
            keywords: ['period-drama', 'sex', 'railroad-worker'],
        },
    }]);

    assert.deepEqual(derived, [
        { source: 'Common Sense', value: '13+' },
        { source: 'Not Safe', value: '⚠️ Not Parent Safe' },
        { source: 'Sex & Nudity', value: '🫣 Sex & Nudity' },
    ]);
});

test('can suppress MDBList keyword-derived warnings for episode safety', () => {
    const derived = deriveMdblistSafetyResults([{
        _mdblist: {
            age: {
                commonSense: 17,
                parentalNudity: 2,
            },
            keywords: ['female-nudity', 'nudity'],
        },
    }], {
        useKeywordWarnings: false,
    });

    assert.deepEqual(derived, [
        { source: 'Common Sense', value: '17+' },
    ]);
});
