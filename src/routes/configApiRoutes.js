const express = require('express');
const userConfigService = require('../services/userConfigService');
const redisClient = require('../cache/redisClient');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiter: per-IP fixed window. Redis is the source of truth so the
// limiter coordinates across multiple replicas. An in-memory fallback
// kicks in only if Redis is briefly unavailable; that fallback bounds
// memory via lazy sweeping, but does not coordinate across replicas.
const RATE_LIMIT_KEY_PREFIX = 'rl:config:';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// Hard cap on the in-memory fallback bucket count to keep a hot replica
// from accumulating unbounded entries during a Redis outage.
const RATE_LIMIT_FALLBACK_MAX_BUCKETS = 50000;

const rateLimitBuckets = new Map();
let lastSweepAt = 0;

function sweepExpiredBuckets(now) {
    if (now - lastSweepAt < RATE_LIMIT_SWEEP_INTERVAL_MS) return;
    lastSweepAt = now;

    for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
        if (now > bucket.resetAt) {
            rateLimitBuckets.delete(bucketKey);
        }
    }

    // Last-resort hard cap. If we still have too many entries after the
    // sweep (Redis down for a long time, traffic spike), evict the oldest
    // by insertion order until we're under the cap. Map iteration order
    // is insertion order in JavaScript.
    while (rateLimitBuckets.size > RATE_LIMIT_FALLBACK_MAX_BUCKETS) {
        const oldestKey = rateLimitBuckets.keys().next().value;
        if (oldestKey === undefined) break;
        rateLimitBuckets.delete(oldestKey);
    }
}

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function absoluteUrl(req, path) {
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${req.protocol}://${host}${path}`;
}

function clientKey(req) {
    // req.ip already honours `app.set('trust proxy', true)` and parses
    // X-Forwarded-For; fall back only to the raw socket address.
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rejectOverLimit(res, retryAfterMs) {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
        error: 'Too many config requests. Please try again shortly.',
    });
}

function inMemoryFallbackHit(now, key) {
    sweepExpiredBuckets(now);

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
    return { count: bucket.count, resetMs: bucket.resetAt - now };
}

async function configRateLimit(req, res, next) {
    const now = Date.now();
    const key = clientKey(req);

    let result = null;

    if (redisClient.isReady()) {
        result = await redisClient.incrementFixedWindow(
            `${RATE_LIMIT_KEY_PREFIX}${key}`,
            RATE_LIMIT_WINDOW_MS
        );
    }

    if (!result) {
        // Redis unavailable or returned an error. Fall back to per-replica
        // in-memory bucketing so we still rate-limit something. This does
        // not coordinate across replicas during the outage.
        if (redisClient.isReady()) {
            logger.warn('[RateLimit] Redis returned no result; using in-memory fallback for this hit.');
        }
        result = inMemoryFallbackHit(now, key);
    }

    if (result.count > RATE_LIMIT_MAX_REQUESTS) {
        rejectOverLimit(res, result.resetMs);
        return;
    }

    next();
}

// All mutating /api/config endpoints must NEVER be edge-cached.
function noStoreCacheControl(_req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
}

router.use('/api/config', configRateLimit);

const config = require('../config');

router.get('/api/config/defaults', asyncRoute(async (_req, res) => {
    const ttl = config.cache.edgeDefaultsMaxAgeSeconds;
    res.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
    const userConfig = await userConfigService.getDefaultUserConfig();
    res.json({
        ...userConfigService.publicConfigView(userConfig),
        instanceDefaults: userConfigService.instanceDefaultProvidersAvailable(),
    });
}));

// Lock down all mutating routes against any edge / proxy cache.
router.post('/api/config', noStoreCacheControl);
router.post('/api/config/:configId/retrieve', noStoreCacheControl);
router.put('/api/config/:configId', noStoreCacheControl);
router.put('/api/config/:configId/password', noStoreCacheControl);
router.delete('/api/config/:configId', noStoreCacheControl);

router.post('/api/config', asyncRoute(async (req, res) => {
    if (!req.body?.password) {
        res.status(400).json({
            error: 'Config password is required.',
        });
        return;
    }

    // TMDb key requirement is now enforced by provider validation, which
    // accepts a user-supplied key OR an instance default if one is set in
    // the operator env.
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
