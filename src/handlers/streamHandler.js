const ratingService = require('../services/ratingService');
const logger = require('../utils/logger');
const config = require('../config');
const {
    getCompactLabel,
    getFullLabel,
} = require('../utils/emojiMapper');

const DIVIDER = '───────────────';

const TOP_PRIORITY_SOURCES = new Set([
    'Common Sense',
    'Not Safe',
    'Sexual Violence',
    'Sex & Nudity',
]);

function isRogerEbertStars(value) {
    const text = String(value || '').trim();
    return /^[⭐✨]+$/.test(text) && text.includes('⭐');
}

function stripScale(value, source = '') {
    const text = String(value || '').trim();

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

function getCompactMainRatings(ratings, limit) {
    return ratings
        .filter(r => isRenderableRating(r) && !TOP_PRIORITY_SOURCES.has(r.source))
        .slice(0, limit);
}

function getSpecialRatings(ratings) {
    const parental = ratings.find(
        r => r && r.source === 'Common Sense' && isRenderableRating(r)
    );

    const notSafe = ratings.find(
        r => r && r.source === 'Not Safe' && isRenderableRating(r)
    );

    const sexualWarning = ratings.find(
        r =>
            r &&
            (r.source === 'Sexual Violence' || r.source === 'Sex & Nudity') &&
            isRenderableRating(r)
    );

    return { parental, notSafe, sexualWarning };
}

function buildTopLines(ratings) {
    const lines = [];
    const { parental, notSafe, sexualWarning } = getSpecialRatings(ratings);

    if (parental) {
        lines.push(`👪 ${stripScale(parental.value, parental.source)}`);
    }

    if (notSafe) {
        lines.push(stripScale(notSafe.value, notSafe.source));
    }

    if (sexualWarning) {
        lines.push(stripScale(sexualWarning.value, sexualWarning.source));
    }

    return lines;
}

function wrapWithDivider(content) {
    if (!content || !content.trim()) return '';
    return `${DIVIDER}\n${content}\n${DIVIDER}`;
}

function formatCompactRatings(ratings) {
    if (!Array.isArray(ratings) || ratings.length === 0) return '';

    const limit = config.ratings.compactLimit || 4;
    const mainRatings = getCompactMainRatings(ratings, limit);
    const lines = buildTopLines(ratings);

    const ratingsLine = mainRatings
        .map(r => `${getCompactLabel(r.source)} ${stripScale(r.value, r.source)}`)
        .join(' | ');

    if (ratingsLine) {
        lines.push(ratingsLine);
    }

    return wrapWithDivider(lines.join('\n'));
}

function formatFullRatings(ratings) {
    if (!Array.isArray(ratings) || ratings.length === 0) return '';

    const lines = buildTopLines(ratings);

    for (const r of ratings) {
        if (!isRenderableRating(r)) continue;
        if (TOP_PRIORITY_SOURCES.has(r.source)) continue;

        lines.push(`${getFullLabel(r.source)} - ${stripScale(r.value, r.source)}`);
    }

    return wrapWithDivider(lines.join('\n'));
}

function formatRatingsCard(ratings) {
    const mode = (config.ratings.displayMode || 'full').toLowerCase();

    if (mode === 'compact') {
        return formatCompactRatings(ratings);
    }

    return formatFullRatings(ratings);
}

async function streamHandler({ type, id }) {
    logger.info(`Received stream request for: type=${type}, id=${id}`);

    if (!id?.startsWith('tt')) {
        logger.warn(`Invalid IMDb-style id received: ${id}`);
        return { streams: [] };
    }

    const ratings = await ratingService.getRatings(type, id);

    if (!Array.isArray(ratings) || ratings.length === 0) {
        logger.info(`No ratings resolved for ${id}`);
        return { streams: [] };
    }

    const description = formatRatingsCard(ratings);

    logger.info(`Resolved ratings payload for ${id}: ${JSON.stringify(ratings)}`);
    logger.info(`Resolved description for ${id}: ${JSON.stringify(description)}`);

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