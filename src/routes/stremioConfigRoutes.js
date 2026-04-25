const express = require('express');
const config = require('../config');
const streamHandler = require('../handlers/streamHandler');
const userConfigService = require('../services/userConfigService');
const logger = require('../utils/logger');

const router = express.Router();

function sendAddonJson(res, payload, status = 200) {
    res
        .status(status)
        .json(payload);
}

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

async function resolveUserConfig(req, res) {
    const userConfig = await userConfigService.getUserConfigById(req.params.configId);

    if (!userConfig) {
        sendAddonJson(res, {
            error: 'Unknown addon configuration',
            configId: req.params.configId,
        }, 404);
        return null;
    }

    return userConfig;
}

function setAddonCors(_req, res, next) {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
    });
    next();
}

router.use(setAddonCors);

router.options('/manifest.json', (_req, res) => {
    sendAddonJson(res, {});
});

router.options('/stream/:type/:id.json', (_req, res) => {
    sendAddonJson(res, {});
});

router.options('/stremio/:configId', (_req, res) => {
    sendAddonJson(res, {});
});

router.options('/stremio/:configId/manifest.json', (_req, res) => {
    sendAddonJson(res, {});
});

router.options('/stremio/:configId/stream/:type/:id.json', (_req, res) => {
    sendAddonJson(res, {});
});

function buildManifest(userConfig, options = {}) {
    const configurationRequired = options.configurationRequired ?? userConfig.id === 'default';

    return {
        ...config.addon,
        behaviorHints: {
            ...config.addon.behaviorHints,
            configurable: true,
            configurationRequired,
        },
    id: userConfig.id === 'default'
            ? config.addon.id
            : `${config.addon.id}.${userConfig.id}`,
    };
}

router.get('/stremio/:configId/manifest.json', asyncRoute(async (req, res) => {
    const userConfig = await resolveUserConfig(req, res);
    if (!userConfig) return;

    logger.info(`Serving config-scoped manifest for config=${userConfig.id}`);
    sendAddonJson(res, buildManifest(userConfig));
}));

router.get('/stremio/:configId/stream/:type/:id.json', asyncRoute(async (req, res) => {
    const userConfig = await resolveUserConfig(req, res);
    if (!userConfig) return;

    if (userConfig.id === 'default') {
        logger.info('Default config stream requested in BYOB mode');
        sendAddonJson(res, { streams: [] });
        return;
    }

    const payload = await streamHandler({
        type: req.params.type,
        id: req.params.id,
        userConfig,
    });

    sendAddonJson(res, payload);
}));

router.get('/stremio/:configId', (req, res) => {
    res.redirect(302, `/stremio/${encodeURIComponent(req.params.configId)}/manifest.json`);
});

router.get('/stremio/:configId/configure', (req, res) => {
    res.redirect(302, `/configure?uuid=${encodeURIComponent(req.params.configId)}`);
});

router.get('/manifest.json', asyncRoute(async (_req, res) => {
    const userConfig = await userConfigService.getDefaultUserConfig();
    sendAddonJson(res, buildManifest(userConfig, { configurationRequired: true }));
}));

router.get('/stream/:type/:id.json', (_req, res) => {
    logger.info('Legacy default stream requested in BYOB mode');
    sendAddonJson(res, { streams: [] });
});

module.exports = router;
