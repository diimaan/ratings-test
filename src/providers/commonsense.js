const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../utils/logger');
const { getPage } = require('../utils/httpClient');
const { formatTitleForUrlSlug } = require('../utils/urlFormatter');
const { getWarningLabel } = require('../utils/emojiMapper');

const PROVIDER_NAME = 'Common Sense';
const WARNINGS_SOURCE = 'Common Sense Warnings';
const BASE_URL = config.sources.commonSenseBaseUrl;

function getCommonSenseUrl(title, type) {
    if (!title || !BASE_URL) return null;

    const slug = formatTitleForUrlSlug(title);
    const path = type === 'series' ? 'tv-reviews' : 'movie-reviews';

    return slug ? `${BASE_URL}/${path}/${slug}` : null;
}

function cleanText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractAgeFromHeading($) {
    const heading = cleanText(
        $('h2.heading-4')
            .filter((_, el) => /why age/i.test($(el).text()))
            .first()
            .text()
    );

    const match = heading.match(/why age\s*([0-9]{1,2}\+?)/i);
    if (!match) return null;

    return match[1].endsWith('+') ? match[1] : `${match[1]}+`;
}

function extractAgeFromRatingSpan($) {
    const candidates = $('span.rating__age')
        .map((_, el) => cleanText($(el).text()))
        .get()
        .filter(Boolean);

    for (const text of candidates) {
        const normalized = text.replace(/^age\s*/i, '').trim();
        const match = normalized.match(/^([0-9]{1,2})\+?$/);
        if (match) {
            return `${match[1]}+`;
        }
    }

    return null;
}

function scrapeAgeRating($, url) {
    const age = extractAgeFromHeading($) || extractAgeFromRatingSpan($);
    if (!age) return null;

    return {
        source: PROVIDER_NAME,
        value: age,
        url,
    };
}

function mapLabelToCategory(label) {
    const text = cleanText(label).toLowerCase();

    if (!text) return null;

    if (
        text.includes('sexual violence') ||
        text.includes('sexual assault')
    ) {
        return 'Sexual Violence';
    }

    if (
        text.includes('sex') ||
        text.includes('nudity')
    ) {
        return 'Sex & Nudity';
    }

    return null;
}

function collectWarningCategories($) {
    const categories = new Set();

    // 1. Known labels
    $('.rating__label').each((_, el) => {
        const label = cleanText($(el).text());
        const mapped = mapLabelToCategory(label);

        logger.debug(`[CSM] Label found: "${label}" → "${mapped}"`);

        if (mapped) categories.add(mapped);
    });

    // 2. Heading fallback
    $('h2, h3, h4').each((_, el) => {
        const text = cleanText($(el).text());
        const mapped = mapLabelToCategory(text);

        if (mapped) {
            logger.debug(`[CSM] Heading match: "${text}" → "${mapped}"`);
            categories.add(mapped);
        }
    });

    // 3. Body fallback
    if (categories.size === 0) {
        const bodyText = cleanText($('body').text()).toLowerCase();

        logger.debug(`[CSM] No categories found via DOM, using body fallback`);

        const possible = [
            'sex',
            'nudity',
        ];

        for (const word of possible) {
            if (bodyText.includes(word)) {
                const mapped = mapLabelToCategory(word);

                logger.debug(`[CSM] Body match: "${word}" → "${mapped}"`);

                if (mapped) categories.add(mapped);
            }
        }
    }

    logger.debug(`[CSM] Final collected categories: ${JSON.stringify([...categories])}`);

    return Array.from(categories);
}

function scrapeWarnings($, url) {
    const categories = collectWarningCategories($);

    logger.debug(`[CSM] Categories before emoji mapping: ${JSON.stringify(categories)}`);

    if (!categories.length) return null;

    const lines = categories
        .map(category => {
            const label = getWarningLabel(category);

            logger.debug(`[CSM] Emoji mapping: "${category}" → "${label}"`);

            return label;
        })
        .filter(Boolean);

    logger.debug(`[CSM] Final warning lines: ${JSON.stringify(lines)}`);

    if (!lines.length) return null;

    return {
        source: WARNINGS_SOURCE,
        value: lines.join('\n'),
        url,
    };
}

function scrapePage(html, url) {
    const $ = cheerio.load(html);

    return {
        ageRating: scrapeAgeRating($, url),
        warnings: scrapeWarnings($, url),
    };
}

async function getPageData(type, streamInfo) {
    if (!streamInfo?.name || !BASE_URL) return null;

    const url = getCommonSenseUrl(streamInfo.name, type);
    if (!url) return null;

    logger.debug(`[${PROVIDER_NAME}] Fetching ${url}`);
    const res = await getPage(url, PROVIDER_NAME);

    if (!res || res.status !== 200) return null;

    return scrapePage(res.data, url);
}

async function getRating(type, _imdbId, streamInfo) {
    if (!streamInfo?.name || !BASE_URL) return null;

    const pageData = await getPageData(type, streamInfo);
    return pageData?.ageRating || null;
}

async function getWarnings(type, _imdbId, streamInfo) {
    if (!streamInfo?.name || !BASE_URL) return null;

    const pageData = await getPageData(type, streamInfo);
    return pageData?.warnings || null;
}

async function getBoth(type, _imdbId, streamInfo) {
    if (!streamInfo?.name || !BASE_URL) return null;

    const pageData = await getPageData(type, streamInfo);
    if (!pageData) return null;

    return {
        ageRating: pageData.ageRating || null,
        warnings: pageData.warnings || null,
    };
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
    getWarnings,
    getBoth,
};
