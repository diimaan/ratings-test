const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-imdb-lmdb-'));
const imdbDir = path.join(rootDir, 'imdb');
const lmdbDir = path.join(rootDir, 'lmdb');

fs.mkdirSync(imdbDir, { recursive: true });

process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-imdb-lmdb';
process.env.LOG_LEVEL = 'error';
process.env.IMDB_DATASET_MODE = 'required';
process.env.IMDB_DATA_DIR = imdbDir;
process.env.LMDB_DATA_DIR = lmdbDir;
process.env.IMDB_DATASET_BATCH_SIZE = '2';

const imdbLmdbDataset = require('../src/utils/imdbLmdbDataset');
const lmdbStore = require('../src/storage/lmdbStore');

function writeGzip(filePath, content) {
    fs.writeFileSync(filePath, zlib.gzipSync(content));
}

test('loads IMDb ratings and episode mappings into LMDB for episode lookup', async (t) => {
    t.after(() => {
        lmdbStore.close();
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    writeGzip(
        path.join(imdbDir, 'title.ratings.tsv.gz'),
        [
            'tconst\taverageRating\tnumVotes',
            'ttshow0001\t8.0\t1000',
            'ttepisode01\t9.3\t250',
            'ttepisode02\t7.4\t150',
            'ttbad00001\t\\N\t10',
            '',
        ].join('\n')
    );

    writeGzip(
        path.join(imdbDir, 'title.episode.tsv.gz'),
        [
            'tconst\tparentTconst\tseasonNumber\tepisodeNumber',
            'ttepisode01\tttshow0001\t1\t1',
            'ttepisode02\tttshow0001\t1\t2',
            'ttspecial1\tttshow0001\t\\N\t1',
            '',
        ].join('\n')
    );

    assert.equal(await imdbLmdbDataset.init(), true);

    const firstEpisode = await imdbLmdbDataset.getEpisodeRating('ttshow0001', '1', '1');
    assert.deepEqual(firstEpisode, {
        source: 'IMDb Episode',
        value: '9.3/10',
    });

    const secondEpisode = await imdbLmdbDataset.getEpisodeRating('ttshow0001', 1, 2);
    assert.deepEqual(secondEpisode, {
        source: 'IMDb Episode',
        value: '7.4/10',
    });

    const missingEpisode = await imdbLmdbDataset.getEpisodeRating('ttshow0001', 9, 9);
    assert.equal(missingEpisode, null);

    assert.equal(await imdbLmdbDataset.init(), true);
});
