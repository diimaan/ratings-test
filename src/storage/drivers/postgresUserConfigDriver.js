const { Pool } = require('pg');
const config = require('../../config');
const logger = require('../../utils/logger');
const {
    decryptUserConfigSecrets,
    encryptUserConfigSecrets,
} = require('../../utils/configSecrets');

let pool;

function getPool() {
    if (pool) return pool;

    const pgConfig = config.storage.postgres;
    if (!pgConfig.connectionString) {
        throw new Error(
            'CONFIG_STORE_DRIVER=postgres requires CONFIG_DATABASE_URL or PG* connection settings.'
        );
    }

    pool = new Pool({
        connectionString: pgConfig.connectionString,
        max: pgConfig.poolMax,
        idleTimeoutMillis: pgConfig.idleTimeoutMs,
        connectionTimeoutMillis: pgConfig.connectionTimeoutMs,
        ssl: pgConfig.ssl,
    });

    pool.on('error', (err) => {
        logger.error(`[Postgres] Idle client error: ${err.message}`);
    });

    return pool;
}

const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS user_configs (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION user_configs_set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS user_configs_updated_at ON user_configs;
    CREATE TRIGGER user_configs_updated_at
        BEFORE UPDATE ON user_configs
        FOR EACH ROW
        EXECUTE FUNCTION user_configs_set_updated_at();
`;

async function init() {
    const client = await getPool().connect();
    try {
        await client.query(SCHEMA_SQL);
        logger.info('[Postgres] Config store schema ready.');
    } finally {
        client.release();
    }
}

async function getUserConfig(id) {
    const { rows } = await getPool().query(
        'SELECT config_json FROM user_configs WHERE id = $1',
        [id]
    );

    if (!rows.length) return null;
    return decryptUserConfigSecrets(JSON.parse(rows[0].config_json));
}

async function getUserConfigRecord(id) {
    const { rows } = await getPool().query(
        'SELECT config_json, password_hash FROM user_configs WHERE id = $1',
        [id]
    );

    if (!rows.length) return null;

    return {
        config: decryptUserConfigSecrets(JSON.parse(rows[0].config_json)),
        passwordHash: rows[0].password_hash,
    };
}

async function saveUserConfig(userConfig, passwordHash = null) {
    const storedConfig = encryptUserConfigSecrets(userConfig);

    await getPool().query(
        `
        INSERT INTO user_configs (id, version, config_json, cache_key, password_hash)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
            version = EXCLUDED.version,
            config_json = EXCLUDED.config_json,
            cache_key = EXCLUDED.cache_key,
            password_hash = COALESCE(EXCLUDED.password_hash, user_configs.password_hash)
        `,
        [
            userConfig.id,
            userConfig.version,
            JSON.stringify(storedConfig),
            userConfig.cacheKey,
            passwordHash,
        ]
    );

    return userConfig;
}

async function deleteUserConfig(id) {
    const { rowCount } = await getPool().query(
        'DELETE FROM user_configs WHERE id = $1',
        [id]
    );
    return rowCount > 0;
}

async function setUserConfigPasswordHash(id, passwordHash) {
    const { rowCount } = await getPool().query(
        'UPDATE user_configs SET password_hash = $2 WHERE id = $1',
        [id, passwordHash]
    );
    return rowCount > 0;
}

async function health() {
    try {
        await getPool().query('SELECT 1');
        return {
            ok: true,
            driver: 'postgres',
        };
    } catch (err) {
        return {
            ok: false,
            driver: 'postgres',
            error: err.message,
        };
    }
}

async function close() {
    if (!pool) return;
    await pool.end();
    pool = null;
}

module.exports = {
    init,
    getUserConfig,
    getUserConfigRecord,
    saveUserConfig,
    deleteUserConfig,
    setUserConfigPasswordHash,
    health,
    close,
};
