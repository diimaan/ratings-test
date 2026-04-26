const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CONFIG_ENCRYPTION_SECRET = 'test-secret-for-config-routes';
process.env.SQLITE_DB_PATH = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-config-routes-')),
    'ratings.sqlite'
);
process.env.IMDB_DATASET_MODE = 'disabled';
process.env.TMDB_API_KEY = '';
process.env.MDBLIST_API_KEY = '';
process.env.PUBLICMETADB_API_KEY = '';

const providerValidation = require('../src/services/providerValidation');

providerValidation.validateUserConfigProviders = async () => {};

const configApiRoutes = require('../src/routes/configApiRoutes');
const stremioConfigRoutes = require('../src/routes/stremioConfigRoutes');
const jsonErrorHandler = require('../src/middleware/jsonErrorHandler');
const sqliteStore = require('../src/storage/sqliteStore');

function createTestApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json({ limit: '64kb' }));
    app.use(configApiRoutes);
    app.use(stremioConfigRoutes);
    app.use(jsonErrorHandler);
    return app;
}

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', (err) => {
            if (err) {
                reject(err);
                return;
            }

            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Test HTTP server did not bind to a TCP port.'));
                return;
            }

            const { port } = address;
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${port}`,
            });
        });

        server.on('error', reject);
    });
}

async function closeServer(server) {
    await new Promise((resolve, reject) => {
        server.close(err => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function requestJson(baseUrl, pathName, options = {}) {
    const response = await fetch(`${baseUrl}${pathName}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': 'ratings.example.test',
            ...(options.headers || {}),
        },
    });

    const body = await response.json();
    return { response, body };
}

test('config routes create, retrieve, update, reject wrong password, and delete UUID configs', async (t) => {
    const { server, baseUrl } = await listen(createTestApp());

    t.after(async () => {
        await closeServer(server);
        sqliteStore.close();
    });

    const createPayload = {
        password: 'correct-horse',
        providers: {
            tmdb: {
                apiKey: 'tmdb-user-key',
                apiUrl: 'https://api.themoviedb.org/3',
            },
            mdblist: {
                apiKey: 'mdblist-user-key',
                apiUrl: 'https://api.mdblist.com',
            },
            publicmetadb: {
                apiKey: '',
                apiUrl: 'https://publicmetadb.com',
            },
        },
        ratings: {
            enabled: ['IMDb (Movie)', 'TMDb (Movie)'],
            order: ['TMDb (Movie)', 'IMDb (Movie)'],
            displayMode: 'compact',
            compactLimit: 2,
            safetySource: 'hybrid',
        },
    };

    const created = await requestJson(baseUrl, '/api/config', {
        method: 'POST',
        body: JSON.stringify(createPayload),
    });

    assert.equal(created.response.status, 201);
    assert.match(created.body.config.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.body.config.providers.tmdb.configured, true);
    assert.equal(created.body.config.providers.tmdb.apiKey, undefined);
    assert.equal(created.body.manifestPath, `/stremio/${created.body.config.id}/manifest.json`);
    assert.equal(
        created.body.manifestUrl,
        `https://ratings.example.test/stremio/${created.body.config.id}/manifest.json`
    );

    const configId = created.body.config.id;

    const rejected = await requestJson(baseUrl, `/api/config/${configId}/retrieve`, {
        method: 'POST',
        body: JSON.stringify({ password: 'wrong-password' }),
    });

    assert.equal(rejected.response.status, 401);
    assert.equal(rejected.body.error, 'Invalid config UUID or password.');

    const retrieved = await requestJson(baseUrl, `/api/config/${configId}/retrieve`, {
        method: 'POST',
        body: JSON.stringify({ password: 'correct-horse' }),
    });

    assert.equal(retrieved.response.status, 200);
    assert.equal(retrieved.body.config.providers.tmdb.apiKey, 'tmdb-user-key');
    assert.equal(retrieved.body.config.providers.mdblist.apiKey, 'mdblist-user-key');
    assert.equal(retrieved.body.config.ratings.safetySource, 'hybrid');

    const updated = await requestJson(baseUrl, `/api/config/${configId}`, {
        method: 'PUT',
        body: JSON.stringify({
            ...createPayload,
            providers: {
                ...createPayload.providers,
                tmdb: {
                    ...createPayload.providers.tmdb,
                    apiKey: 'tmdb-updated-key',
                },
            },
            ratings: {
                ...createPayload.ratings,
                displayMode: 'full',
            },
        }),
    });

    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.config.id, configId);
    assert.equal(updated.body.config.ratings.displayMode, 'full');
    assert.equal(updated.body.config.ratings.safetySource, 'hybrid');
    assert.equal(updated.body.config.providers.tmdb.apiKey, undefined);

    const deleted = await requestJson(baseUrl, `/api/config/${configId}`, {
        method: 'DELETE',
        body: JSON.stringify({ password: 'correct-horse' }),
    });

    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);

    const retrievedAfterDelete = await requestJson(baseUrl, `/api/config/${configId}/retrieve`, {
        method: 'POST',
        body: JSON.stringify({ password: 'correct-horse' }),
    });

    assert.equal(retrievedAfterDelete.response.status, 401);
});

test('BYOB addon routes keep base/default streams disabled', async (t) => {
    const { server, baseUrl } = await listen(createTestApp());

    t.after(async () => {
        await closeServer(server);
        sqliteStore.close();
    });

    const manifest = await requestJson(baseUrl, '/manifest.json', {
        method: 'GET',
    });

    assert.equal(manifest.response.status, 200);
    assert.equal(manifest.body.behaviorHints.configurationRequired, true);

    const defaultScopedManifest = await requestJson(baseUrl, '/stremio/default/manifest.json', {
        method: 'GET',
    });

    assert.equal(defaultScopedManifest.response.status, 200);
    assert.equal(defaultScopedManifest.body.behaviorHints.configurationRequired, true);

    const legacyStream = await requestJson(baseUrl, '/stream/movie/tt0133093.json', {
        method: 'GET',
    });

    assert.equal(legacyStream.response.status, 200);
    assert.deepEqual(legacyStream.body, { streams: [] });

    const defaultScopedStream = await requestJson(baseUrl, '/stremio/default/stream/movie/tt0133093.json', {
        method: 'GET',
    });

    assert.equal(defaultScopedStream.response.status, 200);
    assert.deepEqual(defaultScopedStream.body, { streams: [] });
});
