const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-safety-policy';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    evaluateSafetyKeywords,
    mediaLevelThreshold,
    normalizeKeyword,
} = require('../src/services/safetyPolicy');

test('normalizes keyword separators for safety scoring', () => {
    assert.equal(normalizeKeyword('Sex Scene'), 'sex-scene');
    assert.equal(normalizeKeyword('sexual_assault'), 'sexual-assault');
});

test('uses higher warning thresholds for shows, episodes, and anime', () => {
    assert.equal(mediaLevelThreshold({ type: 'movie' }), 60);
    assert.equal(mediaLevelThreshold({ type: 'series' }), 80);
    assert.equal(mediaLevelThreshold({ type: 'series', isEpisode: true }), 120);
    assert.equal(mediaLevelThreshold({ type: 'series', isEpisode: true, isAnime: true }), 150);
});

test('scores broad adult keywords below visible warning threshold', () => {
    const result = evaluateSafetyKeywords({
        keywords: ['sex', 'nudity'],
        type: 'movie',
    });

    assert.equal(result.sexNudityScore, 25);
    assert.equal(result.hasSexAndNudity, false);
});

test('scores explicit sexual content above movie threshold', () => {
    const result = evaluateSafetyKeywords({
        keywords: ['intercourse', 'nudity'],
        type: 'movie',
    });

    assert.equal(result.sexNudityScore, 70);
    assert.equal(result.hasSexAndNudity, true);
});

test('requires stronger keyword evidence for anime episodes', () => {
    const result = evaluateSafetyKeywords({
        keywords: ['intercourse', 'nudity'],
        type: 'series',
        isEpisode: true,
        isAnime: true,
    });

    assert.equal(result.sexNudityScore, 70);
    assert.equal(result.threshold, 150);
    assert.equal(result.hasSexAndNudity, false);
});

test('treats severe sexual violence evidence as visible warning', () => {
    const result = evaluateSafetyKeywords({
        keywords: ['sexual-violence'],
        type: 'series',
        isEpisode: true,
        isAnime: true,
    });

    assert.equal(result.sexualViolenceScore, 120);
    assert.equal(result.hasSexualViolence, true);
});
