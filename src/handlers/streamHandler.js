const ratingService = require('../services/ratingService');
const logger = require('../utils/logger');
const config = require('../config');
const crypto = require('crypto');
const {
    getCompactLabel,
    getFullLabel,
} = require('../utils/emojiMapper');

const DIVIDER = '───────────────';

const TOP_PRIORITY_SOURCES = new Set([
    'Common Sense',
    'Parent Safe',
    'Not Safe',
    'Sexual Violence',
    'Sex & Nudity',
]);

const TV_USER_AGENT_PATTERNS = [
    ['android-tv', /android tv/i],
    ['google-tv', /googletv|google tv/i],
    ['fire-tv', /aft[a-z0-9]*|fire tv/i],
    ['chromecast', /crkey|chromecast/i],
    ['smart-tv', /smart-tv|smarttv|hbbtv|nettv|internet\.tv/i],
    ['tizen', /tizen/i],
    ['webos', /webos|web0s/i],
    ['netcast', /netcast/i],
    ['vidaa', /vidaa/i],
    ['viera', /viera/i],
    ['bravia', /bravia|sony.*tv/i],
    ['apple-tv', /appletv|apple tv/i],
    ['roku', /roku/i],
    ['xbox', /xbox/i],
    ['playstation', /playstation|ps4|ps5/i],
    ['nintendo', /nintendo switch/i],
];

const MOBILE_USER_AGENT_PATTERNS = [
    ['stremio-ios', /stremio.*(iphone|ipad|ios)/i],
    ['stremio-android', /stremio.*android(?! tv)/i],
    ['iphone', /iphone/i],
    ['ipad', /ipad/i],
    ['android-mobile', /android(?! tv).*mobile/i],
    ['android', /android(?! tv)/i],
];

const DESKTOP_USER_AGENT_PATTERNS = [
    ['stremio-desktop', /stremio(shell)?\/[\d.]+.*(desktop|macintosh|mac os x|windows|linux)/i],
    ['macos', /macintosh|mac os x/i],
    ['windows', /windows nt/i],
    ['linux-desktop', /x11|linux x86_64|linux aarch64/i],
];

const WEB_USER_AGENT_PATTERNS = [
    ['chrome', /chrome|chromium|crios/i],
    ['safari', /safari/i],
    ['firefox', /firefox|fxios/i],
    ['edge', /edg\//i],
];

function isRogerEbertStars(value) {
    const text = String(value || '').trim();
    return /^[⭐✨]+$/.test(text) && text.includes('⭐');
}

function stripScale(value, source = '') {
    const text = String(value || '').trim();

    if (source === 'Not Safe' && /not safe|not parent safe/i.test(text)) {
        return '⚠️ Not Parent Safe';
    }

    if (source === 'Roger Ebert' && isRogerEbertStars(text)) {
        return text;
    }

    return text
        .replace(/\/10$/i, '')
        .replace(/\/5$/i, '')
        .replace(/\/100$/i, '')
        .replace(/\.0$/i, '')
        .trim();
}

function isRenderableRating(rating) {
    if (!rating || !rating.source || rating.value === undefined || rating.value === null) {
        return false;
    }

    const text = String(rating.value).trim();
    if (!text) return false;

    if (TOP_PRIORITY_SOURCES.has(rating.source)) {
        return true;
    }

    if (rating.source === 'Roger Ebert' && isRogerEbertStars(text)) {
        return true;
    }

    const match = text.match(/^(-?\d+(?:\.\d+)?)/);
    if (!match) return false;

    const num = Number(match[1]);
    return Number.isFinite(num) && num > 0;
}

function getCompactPriorityGroups(type) {
    if (type === 'movie') {
        return [
            ['IMDb (Movie)'],
            ['TMDb (Movie)'],
        ];
    }

    return [
        ['IMDb (Episode)', 'IMDb (Show)'],
        ['TMDb (Episode)', 'TMDb (Show)'],
    ];
}

function getCompactMainRatings(ratings, type, limit) {
    const candidates = ratings
        .filter(r => isRenderableRating(r) && !TOP_PRIORITY_SOURCES.has(r.source));

    const priorityGroups = getCompactPriorityGroups(type);
    const pickedSources = new Set();
    const selected = [];

    for (const group of priorityGroups) {
        const match = group
            .map(source => candidates.find(
                rating => !pickedSources.has(rating.source) && rating.source === source
            ))
            .find(Boolean);

        if (match) {
            selected.push(match);
            group.forEach(source => pickedSources.add(source));
        }

        if (selected.length >= limit) {
            return selected.slice(0, limit);
        }
    }

    for (const rating of candidates) {
        if (selected.length >= limit) {
            break;
        }

        if (pickedSources.has(rating.source)) {
            continue;
        }

        selected.push(rating);
        pickedSources.add(rating.source);
    }

    return selected.slice(0, limit);
}

function getSpecialRatings(ratings) {
    const parental = ratings.find(
        r => r && r.source === 'Common Sense' && isRenderableRating(r)
    );

    const notSafe = ratings.find(
        r => r && r.source === 'Not Safe' && isRenderableRating(r)
    );

    const parentSafe = ratings.find(
        r => r && r.source === 'Parent Safe' && isRenderableRating(r)
    );

    const sexualWarnings = ratings.filter(
        r =>
            r &&
            (r.source === 'Sexual Violence' || r.source === 'Sex & Nudity') &&
            isRenderableRating(r)
    );

    return { parental, parentSafe, notSafe, sexualWarnings };
}

function buildAgeLines(ratings) {
    const lines = [];
    const { parental } = getSpecialRatings(ratings);

    if (parental) {
        lines.push(`👪 ${stripScale(parental.value, parental.source)}`);
    }

    return lines;
}

function buildWarningLines(ratings) {
    const lines = [];
    const { parentSafe, notSafe, sexualWarnings } = getSpecialRatings(ratings);

    if (notSafe) {
        lines.push(stripScale(notSafe.value, notSafe.source));
    } else if (parentSafe) {
        lines.push(stripScale(parentSafe.value, parentSafe.source));
    } else if (sexualWarnings.length > 0) {
        lines.push('⚠️ Not Parent Safe');
    }

    for (const warning of sexualWarnings) {
        const line = stripScale(warning.value, warning.source);
        if (line && !lines.includes(line)) {
            lines.push(line);
        }
    }

    return lines;
}

function wrapWithDivider(content) {
    if (!content || !content.trim()) return '';
    return `${DIVIDER}\n${content}\n${DIVIDER}`;
}

function formatCompactRatings(ratings, type, userConfig = config.userConfig) {
    if (!Array.isArray(ratings) || ratings.length === 0) return '';

    const ratingsConfig = userConfig?.ratings || config.ratings;
    const limit = ratingsConfig.compactLimit || 4;
    const mainRatings = getCompactMainRatings(ratings, type, limit);
    const lines = buildAgeLines(ratings);

    const ratingsLine = mainRatings
        .map(r => `${getCompactLabel(r.source)} ${stripScale(r.value, r.source)}`)
        .join(' | ');

    if (ratingsLine) {
        lines.push(ratingsLine);
    }

    lines.push(...buildWarningLines(ratings));

    return wrapWithDivider(lines.join('\n'));
}

function formatFullRatings(ratings) {
    if (!Array.isArray(ratings) || ratings.length === 0) return '';

    const lines = buildAgeLines(ratings);

    for (const r of ratings) {
        if (!isRenderableRating(r)) continue;
        if (TOP_PRIORITY_SOURCES.has(r.source)) continue;

        lines.push(`${getFullLabel(r.source)} - ${stripScale(r.value, r.source)}`);
    }

    lines.push(...buildWarningLines(ratings));

    return wrapWithDivider(lines.join('\n'));
}

function isTvLikeUserAgent(userAgent) {
    return classifyUserAgent(userAgent).family === 'tv';
}

function matchingSignals(patterns, text) {
    return patterns
        .filter(([, pattern]) => pattern.test(text))
        .map(([signal]) => signal);
}

function classifyUserAgent(userAgent) {
    const text = String(userAgent || '').trim();
    if (!text) {
        return { family: 'missing', signals: [] };
    }

    const tvSignals = matchingSignals(TV_USER_AGENT_PATTERNS, text);
    if (tvSignals.length) {
        return { family: 'tv', signals: tvSignals };
    }

    const mobileSignals = matchingSignals(MOBILE_USER_AGENT_PATTERNS, text);
    if (mobileSignals.length) {
        return { family: 'mobile', signals: mobileSignals };
    }

    const webSignals = matchingSignals(WEB_USER_AGENT_PATTERNS, text);
    if (webSignals.length) {
        return { family: 'web', signals: webSignals };
    }

    const desktopSignals = matchingSignals(DESKTOP_USER_AGENT_PATTERNS, text);
    if (desktopSignals.length) {
        return { family: 'desktop', signals: desktopSignals };
    }

    return { family: 'unknown', signals: [] };
}

function userAgentFamily(userAgent) {
    return classifyUserAgent(userAgent).family;
}

function uaHash(userAgent) {
    const text = String(userAgent || '').trim();
    if (!text) return null;

    return crypto
        .createHash('sha256')
        .update(text)
        .digest('hex')
        .slice(0, 12);
}

function userAgentDiagnostics(userAgent) {
    const mode = String(process.env.UA_DIAGNOSTICS || 'off').trim().toLowerCase();
    if (mode === 'off' || !mode) return '';

    const text = String(userAgent || '').trim();
    if (!text) return '';

    if (mode === 'raw') {
        return `, uaRaw=${JSON.stringify(text)}`;
    }

    if (mode === 'hash') {
        return `, uaHash=${uaHash(text)}`;
    }

    return '';
}

function resolveDisplayMode(userConfig = config.userConfig, requestHeaders = {}) {
    const ratingsConfig = userConfig?.ratings || config.ratings;
    const configuredMode = (ratingsConfig.displayMode || 'auto').toLowerCase();

    if (configuredMode === 'compact' || configuredMode === 'full') {
        return configuredMode;
    }

    const userAgent = requestHeaders['user-agent'] || requestHeaders['User-Agent'];
    const ua = classifyUserAgent(userAgent);

    if (ua.family === 'tv' || ua.family === 'unknown' || ua.family === 'missing') {
        return 'compact';
    }

    return 'full';
}

function formatRatingsCard(ratings, type, userConfig = config.userConfig, requestHeaders = {}) {
    const mode = resolveDisplayMode(userConfig, requestHeaders);

    if (mode === 'compact') {
        return formatCompactRatings(ratings, type, userConfig);
    }

    return formatFullRatings(ratings);
}

function buildRateLimitedStream(id) {
    const description = [
        DIVIDER,
        '⚠️ Ratings temporarily unavailable',
        '',
        'This addon instance is rate-limited on shared API keys.',
        'Add your own keys at /configure to keep ratings working',
        'without sharing the instance quota.',
        DIVIDER,
    ].join('\n');

    return {
        name: '⚠️ Ratings rate-limited',
        description,
        externalUrl: `${config.sources.imdbBaseUrl}/title/${id.split(':')[0]}/`,
        behaviorHints: {
            notWebReady: true,
        },
    };
}

async function streamHandler({ type, id, userConfig, requestHeaders = {} }) {
    const activeUserConfig = userConfig || config.userConfig;

    logger.info(`Received stream request for: type=${type}, id=${id}`);

    if (!id?.startsWith('tt')) {
        logger.warn(`Invalid IMDb-style id received: ${id}`);
        return { streams: [] };
    }

    const result = await ratingService.getRatings(type, id, { userConfig: activeUserConfig });

    if (result && typeof result === 'object' && !Array.isArray(result) && result.rateLimited) {
        logger.warn(`Rate-limited and no stale fallback for ${id}; surfacing user-facing error stream`);
        return {
            streams: [buildRateLimitedStream(id)],
        };
    }

    const ratings = Array.isArray(result) ? result : null;

    if (!Array.isArray(ratings) || ratings.length === 0) {
        logger.info(`No ratings resolved for ${id}`);
        return { streams: [] };
    }

    const displayMode = resolveDisplayMode(activeUserConfig, requestHeaders);
    const configuredDisplayMode = activeUserConfig?.ratings?.displayMode || 'auto';
    const requestUserAgent = requestHeaders['user-agent'] || requestHeaders['User-Agent'];
    const ua = classifyUserAgent(requestUserAgent);
    const uaSignals = ua.signals.length ? ua.signals.join(',') : 'none';

    logger.info(
        `Resolved display mode ${displayMode} for ${id} ` +
        `(configured=${configuredDisplayMode}, uaFamily=${ua.family}, uaSignals=${uaSignals}` +
        `${userAgentDiagnostics(requestUserAgent)})`
    );

    const description = formatRatingsCard(ratings, type, activeUserConfig, requestHeaders);

    logger.debug(`Resolved ratings payload for ${id}: ${JSON.stringify(ratings)}`);
    logger.debug(`Resolved description for ${id}: ${JSON.stringify(description)}`);

    if (!description || !description.trim()) {
        logger.warn(`Description came out empty for ${id}`);
        return { streams: [] };
    }

    const stream = {
        name: '🎯 Ratings Aggregator',
        description,
        externalUrl: `${config.sources.imdbBaseUrl}/title/${id.split(':')[0]}/`,
        behaviorHints: {
            notWebReady: true,
        },
    };

    logger.info(`Returning 1 rating stream for ${id}`);
    logger.debug(`Final stream object for ${id}: ${JSON.stringify(stream)}`);

    return {
        streams: [stream],
    };
}

module.exports = streamHandler;
module.exports.resolveDisplayMode = resolveDisplayMode;
module.exports.isTvLikeUserAgent = isTvLikeUserAgent;
module.exports.userAgentFamily = userAgentFamily;
module.exports.classifyUserAgent = classifyUserAgent;
module.exports.uaHash = uaHash;
