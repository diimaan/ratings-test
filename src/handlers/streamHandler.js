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
        const match = candidates.find(
            rating => !pickedSources.has(rating.source) && group.includes(rating.source)
        );

        if (match) {
            selected.push(match);
            pickedSources.add(match.source);
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

    const sexualWarnings = ratings.filter(
        r =>
            r &&
            (r.source === 'Sexual Violence' || r.source === 'Sex & Nudity') &&
            isRenderableRating(r)
    );

    return { parental, notSafe, sexualWarnings };
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
    const { notSafe, sexualWarnings } = getSpecialRatings(ratings);

    if (notSafe) {
        lines.push(stripScale(notSafe.value, notSafe.source));
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

function formatRatingsCard(ratings, type, userConfig = config.userConfig) {
    const ratingsConfig = userConfig?.ratings || config.ratings;
    const mode = (ratingsConfig.displayMode || 'full').toLowerCase();

    if (mode === 'compact') {
        return formatCompactRatings(ratings, type, userConfig);
    }

    return formatFullRatings(ratings);
}

async function streamHandler({ type, id, userConfig }) {
    const activeUserConfig = userConfig || config.userConfig;

    logger.info(`Received stream request for: type=${type}, id=${id}`);

    if (!id?.startsWith('tt')) {
        logger.warn(`Invalid IMDb-style id received: ${id}`);
        return { streams: [] };
    }

    const ratings = await ratingService.getRatings(type, id, { userConfig: activeUserConfig });

    if (!Array.isArray(ratings) || ratings.length === 0) {
        logger.info(`No ratings resolved for ${id}`);
        return { streams: [] };
    }

    const description = formatRatingsCard(ratings, type, activeUserConfig);

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
