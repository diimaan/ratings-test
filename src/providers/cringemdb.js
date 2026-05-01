const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../utils/logger');
const { getPage } = require('../utils/httpClient');
const { formatTitleForUrlSlug } = require('../utils/urlFormatter');
const { getWarningLabel } = require('../utils/emojiMapper');

const PROVIDER_NAME = 'CringeMDB';
const BASE_URL = config.sources.cringeMdbBaseUrl;

function getCringeUrl(title, year) {
    if (!title || !BASE_URL) return null;

    const slug = formatTitleForUrlSlug(title);
    if (!slug) return null;

    return year
        ? `${BASE_URL}/movie/${slug}-${year}`
        : `${BASE_URL}/movie/${slug}`;
}

function cleanText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeFlag(text) {
    const raw = cleanText(text).toLowerCase();

    if (!raw) return null;

    if (raw.includes('sexual violence')) {
        return 'Sexual Violence';
    }

    if (raw.includes('sex') || raw.includes('nudity')) {
        return 'Sex & Nudity';
    }

    if (raw.includes('violence')) {
        return 'Violence & Scariness';
    }

    if (raw.includes('swearing') || raw.includes('language')) {
        return 'Language';
    }

    if (
        raw.includes('drug') ||
        raw.includes('alcohol') ||
        raw.includes('smoking')
    ) {
        return 'Drugs Usage';
    }

    return null;
}

function explicitVerdictText($) {
    return [
        ...$('.badge, h1, h2, h3, h4, p, span, div')
            .map((_, el) => cleanText($(el).text()))
            .get(),
        cleanText($('body').text()),
    ].filter(Boolean);
}

function extractCertification($) {
    const candidates = explicitVerdictText($);

    for (const text of candidates) {
        if (/not\s+parent[-\s]?safe/i.test(text)) {
            logger.debug(`[${PROVIDER_NAME}] Certification: Not Parent Safe`);
            return 'unsafe';
        }
    }

    for (const text of candidates) {
        if (/certified\s+parent[-\s]?safe|parent[-\s]?safe/i.test(text)) {
            logger.debug(`[${PROVIDER_NAME}] Certification: Certified Parent Safe`);
            return 'safe';
        }
    }

    return null;
}

function extractFlags($) {
    const categories = new Set();

    $('.list-group-item').each((_, el) => {
        const text = cleanText($(el).text());
        const normalized = normalizeFlag(text);

        if (normalized) {
            categories.add(normalized);
            logger.debug(`[${PROVIDER_NAME}] Flagged: ${normalized}`);
        }
    });

    return Array.from(categories);
}

function buildWarningOutput(certification, flags, url) {
    const lines = [];

    if (certification === 'safe') {
        lines.push('✅ Certified Parent Safe');
    } else if (certification === 'unsafe') {
        lines.push('⚠️ Not Parent Safe');

        if (flags && flags.length) {
            for (const category of flags) {
                lines.push(getWarningLabel(category));
            }
        }
    }

    if (!lines.length) return null;

    return {
        source: PROVIDER_NAME,
        value: lines.join('\n'),
        url,
    };
}

async function getRating(type, _imdbId, streamInfo) {
    // Strictly movie-only
    if (type !== 'movie') {
        logger.debug(`[${PROVIDER_NAME}] Skipping non-movie request`);
        return null;
    }

    if (!streamInfo?.name || !BASE_URL) return null;

    const url = getCringeUrl(streamInfo.name, streamInfo.year);
    if (!url) return null;

    logger.debug(`[${PROVIDER_NAME}] Fetching ${url}`);
    const res = await getPage(url, PROVIDER_NAME);

    if (!res || res.status !== 200) return null;

    const $ = cheerio.load(res.data);

    const certification = extractCertification($);
    const flags = extractFlags($);

    return buildWarningOutput(certification, flags, url);
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
    _test: {
        extractCertification,
        buildWarningOutput,
    },
};
