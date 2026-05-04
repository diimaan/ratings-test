const config = require('../config');
const logger = require('../utils/logger');

// Lazy-loaded so that drivers we don't use don't pull in their deps.
const driverFactories = {
    sqlite: () => require('./drivers/sqliteUserConfigDriver'),
    postgres: () => require('./drivers/postgresUserConfigDriver'),
};

let activeDriver = null;

function resolveDriverName() {
    return String(config.storage.driver || 'sqlite').trim().toLowerCase();
}

function getDriver() {
    if (activeDriver) return activeDriver;

    const name = resolveDriverName();
    const factory = driverFactories[name];

    if (!factory) {
        const supported = Object.keys(driverFactories).join(', ');
        throw new Error(
            `Unsupported user-config store driver "${name}". Supported drivers: ${supported}.`
        );
    }

    activeDriver = factory();
    logger.info(`[UserConfigStore] Using ${name} driver`);
    return activeDriver;
}

async function init() {
    const driver = getDriver();
    if (typeof driver.init === 'function') {
        await driver.init();
    }
}

async function getUserConfig(id) {
    return getDriver().getUserConfig(id);
}

async function getUserConfigRecord(id) {
    return getDriver().getUserConfigRecord(id);
}

async function saveUserConfig(userConfig, passwordHash = null) {
    return getDriver().saveUserConfig(userConfig, passwordHash);
}

async function deleteUserConfig(id) {
    return getDriver().deleteUserConfig(id);
}

async function setUserConfigPasswordHash(id, passwordHash) {
    return getDriver().setUserConfigPasswordHash(id, passwordHash);
}

async function health() {
    return getDriver().health();
}

async function close() {
    if (!activeDriver) return;
    if (typeof activeDriver.close === 'function') {
        await activeDriver.close();
    }
    activeDriver = null;
}

function _resetForTests() {
    activeDriver = null;
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
    _resetForTests,
};
