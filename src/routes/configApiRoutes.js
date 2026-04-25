const express = require('express');
const userConfigService = require('../services/userConfigService');

const router = express.Router();
const rateLimitBuckets = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function absoluteUrl(req, path) {
    return `${req.protocol}://${req.get('host')}${path}`;
}

function clientKey(req) {
    return req.ip || req.get('x-forwarded-for') || req.socket?.remoteAddress || 'unknown';
}

function configRateLimit(req, res, next) {
    const now = Date.now();

    for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
        if (now > bucket.resetAt) {
            rateLimitBuckets.delete(bucketKey);
        }
    }

    const key = clientKey(req);
    const bucket = rateLimitBuckets.get(key) || {
        count: 0,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
    };

    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }

    bucket.count++;
    rateLimitBuckets.set(key, bucket);

    if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
        res.status(429).json({
            error: 'Too many config requests. Please try again shortly.',
        });
        return;
    }

    next();
}

router.use('/api/config', configRateLimit);

router.get('/api/config/defaults', asyncRoute(async (_req, res) => {
    const userConfig = await userConfigService.getDefaultUserConfig();
    res.json(userConfigService.publicConfigView(userConfig));
}));

router.post('/api/config', asyncRoute(async (req, res) => {
    if (!req.body?.providers?.tmdb?.apiKey) {
        res.status(400).json({
            error: 'TMDb API key is required for user configuration.',
        });
        return;
    }

    if (!req.body?.password) {
        res.status(400).json({
            error: 'Config password is required.',
        });
        return;
    }

    const userConfig = await userConfigService.createUserConfig(req.body || {});
    const manifestPath = `/stremio/${encodeURIComponent(userConfig.id)}/manifest.json`;

    res.status(201).json({
        config: userConfigService.publicConfigView(userConfig),
        manifestPath,
        manifestUrl: absoluteUrl(req, manifestPath),
    });
}));

router.post('/api/config/:configId/retrieve', asyncRoute(async (req, res) => {
    const userConfig = await userConfigService.getUserConfigForPassword(
        req.params.configId,
        req.body?.password
    );
    const manifestPath = `/stremio/${encodeURIComponent(userConfig.id)}/manifest.json`;

    res.json({
        config: userConfigService.privateConfigView(userConfig),
        manifestPath,
        manifestUrl: absoluteUrl(req, manifestPath),
    });
}));

router.put('/api/config/:configId', asyncRoute(async (req, res) => {
    if (!req.body?.providers?.tmdb?.apiKey) {
        res.status(400).json({
            error: 'TMDb API key is required for user configuration.',
        });
        return;
    }

    const userConfig = await userConfigService.updateUserConfig(
        req.params.configId,
        req.body || {}
    );
    const manifestPath = `/stremio/${encodeURIComponent(userConfig.id)}/manifest.json`;

    res.json({
        config: userConfigService.publicConfigView(userConfig),
        manifestPath,
        manifestUrl: absoluteUrl(req, manifestPath),
    });
}));

router.delete('/api/config/:configId', asyncRoute(async (req, res) => {
    await userConfigService.deleteUserConfig(
        req.params.configId,
        req.body?.password
    );

    res.json({
        deleted: true,
        configId: req.params.configId,
    });
}));

router.put('/api/config/:configId/password', asyncRoute(async (req, res) => {
    await userConfigService.changeUserConfigPassword(
        req.params.configId,
        req.body?.currentPassword,
        req.body?.newPassword
    );

    res.json({
        updated: true,
        configId: req.params.configId,
    });
}));

router.use((err, _req, res, next) => {
    if (!err.statusCode) {
        next(err);
        return;
    }

    res.status(err.statusCode).json({
        error: err.message,
    });
});

module.exports = router;
