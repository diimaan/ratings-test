const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-mdblist-provider';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    extractStructuredMetadata,
} = require('../src/providers/mdblist');

test('extracts Common Sense age from alternate MDBList safety field shapes', () => {
    const metadata = extractStructuredMetadata({
        ids: {
            imdb: 'tt1234567',
            tmdb: 123,
        },
        commonsense: true,
        common_sense_media: {
            rating: '16+',
            sex_nudity: 4,
            certification: 'Certified Parent Safe',
        },
        keywords: [
            { name: 'nudity' },
        ],
    });

    assert.equal(metadata._mdblist.age.commonSense, 16);
    assert.equal(metadata._mdblist.age.parentalNudity, 4);
    assert.equal(metadata._mdblist.safety.certification, 'Certified Parent Safe');
    assert.equal(metadata._mdblist.flags.hasCommonSenseData, true);
    assert.deepEqual(metadata._mdblist.keywords, ['nudity']);
});
