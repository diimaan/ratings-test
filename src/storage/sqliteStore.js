const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');
const {
    decryptUserConfigSecrets,
    encryptUserConfigSecrets,
} = require('../utils/configSecrets');

let db;

function ensureDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getDb() {
    if (db) return db;

    ensureDirectory(config.storage.sqlitePath);
    db = new Database(config.storage.sqlitePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_configs (
            id TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            config_json TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            password_hash TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TRIGGER IF NOT EXISTS user_configs_updated_at
        AFTER UPDATE ON user_configs
        FOR EACH ROW
        BEGIN
            UPDATE user_configs
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = OLD.id;
        END;
    `);

    const columns = db.pragma('table_info(user_configs)').map(column => column.name);
    if (!columns.includes('password_hash')) {
        db.exec('ALTER TABLE user_configs ADD COLUMN password_hash TEXT;');
    }

    logger.info(`[SQLite] Config store ready at ${config.storage.sqlitePath}`);
    return db;
}

function getUserConfig(id) {
    const row = getDb()
        .prepare('SELECT config_json FROM user_configs WHERE id = ?')
        .get(id);

    if (!row) return null;
    return decryptUserConfigSecrets(JSON.parse(row.config_json));
}

function getUserConfigRecord(id) {
    const row = getDb()
        .prepare('SELECT config_json, password_hash FROM user_configs WHERE id = ?')
        .get(id);

    if (!row) return null;

    return {
        config: decryptUserConfigSecrets(JSON.parse(row.config_json)),
        passwordHash: row.password_hash,
    };
}

function saveUserConfig(userConfig, passwordHash = null) {
    const storedConfig = encryptUserConfigSecrets(userConfig);

    getDb()
        .prepare(`
            INSERT INTO user_configs (id, version, config_json, cache_key, password_hash)
            VALUES (@id, @version, @configJson, @cacheKey, @passwordHash)
            ON CONFLICT(id) DO UPDATE SET
                version = excluded.version,
                config_json = excluded.config_json,
                cache_key = excluded.cache_key,
                password_hash = COALESCE(excluded.password_hash, user_configs.password_hash)
        `)
        .run({
            id: userConfig.id,
            version: userConfig.version,
            configJson: JSON.stringify(storedConfig),
            cacheKey: userConfig.cacheKey,
            passwordHash,
        });

    return userConfig;
}

function deleteUserConfig(id) {
    return getDb()
        .prepare('DELETE FROM user_configs WHERE id = ?')
        .run(id)
        .changes > 0;
}

function setUserConfigPasswordHash(id, passwordHash) {
    return getDb()
        .prepare('UPDATE user_configs SET password_hash = ? WHERE id = ?')
        .run(passwordHash, id)
        .changes > 0;
}

function close() {
    if (!db) return;
    db.close();
    db = null;
}

module.exports = {
    getUserConfig,
    getUserConfigRecord,
    saveUserConfig,
    deleteUserConfig,
    setUserConfigPasswordHash,
    close,
};
