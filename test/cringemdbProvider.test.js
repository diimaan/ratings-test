const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-cringemdb-provider';
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.LOG_LEVEL = 'error';

const {
    _test: {
        extractCertification,
        buildWarningOutput,
    },
} = require('../src/providers/cringemdb');

test('extracts Certified Parent-Safe even when the first badge is MPAA rating', () => {
    const $ = cheerio.load(`
        <main>
            <span class="badge">PG</span>
            <h1>Arco (2025)</h1>
            <p>Certified Parent-Safe</p>
            <ul>
                <li class="list-group-item">Sex Scene NO</li>
                <li class="list-group-item">Nudity NO</li>
            </ul>
        </main>
    `);

    assert.equal(extractCertification($), 'safe');
});

test('keeps safe certification badge without turning NO flags into warnings', () => {
    const result = buildWarningOutput(
        'safe',
        ['Sex & Nudity', 'Sexual Violence'],
        'https://cringemdb.com/movie/arco-2025'
    );

    assert.deepEqual(result, {
        source: 'CringeMDB',
        value: '✅ Certified Parent Safe',
        url: 'https://cringemdb.com/movie/arco-2025',
    });
});

test('keeps explicit unsafe certification with warning categories', () => {
    const result = buildWarningOutput(
        'unsafe',
        ['Sex & Nudity'],
        'https://cringemdb.com/movie/example-2025'
    );

    assert.deepEqual(result, {
        source: 'CringeMDB',
        value: '⚠️ Not Parent Safe\n🫣 Sex & Nudity',
        url: 'https://cringemdb.com/movie/example-2025',
    });
});

test('ignores CringeMDB flags when no explicit certification is available', () => {
    assert.equal(
        buildWarningOutput(
            null,
            ['Sex & Nudity'],
            'https://cringemdb.com/movie/example-2025'
        ),
        null
    );
});
