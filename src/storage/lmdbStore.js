const fs = require('fs');
const { open } = require('lmdb');
const config = require('../config');
const logger = require('../utils/logger');

let rootDb;

function getRootDb() {
    if (rootDb) return rootDb;

    fs.mkdirSync(config.storage.lmdbPath, { recursive: true });
    rootDb = open({
        path: config.storage.lmdbPath,
        compression: true,
    });

    logger.info(`[LMDB] Store ready at ${config.storage.lmdbPath}`);
    return rootDb;
}

function getNamedDb(name) {
    return getRootDb().openDB(name, {
        keyEncoding: 'ordered-binary',
        encoding: 'json',
    });
}

function health() {
    try {
        getRootDb();
        return {
            ok: true,
            path: config.storage.lmdbPath,
        };
    } catch (err) {
        return {
            ok: false,
            path: config.storage.lmdbPath,
            error: err.message,
        };
    }
}

function close() {
    if (!rootDb) return;
    rootDb.close();
    rootDb = null;
}

module.exports = {
    getNamedDb,
    health,
    close,
};
