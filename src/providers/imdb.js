const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../utils/logger');
const { getPage } = require('../utils/httpClient');

const PROVIDER_NAME = 'IMDb';
const BASE_URL = config.sources.imdbBaseUrl;

function extractRatingFromHtml(html, url, imdbId) {
    const $ = cheerio.load(html);

    const ratingText = $('div[data-testid="hero-rating-bar__aggregate-rating__score"] > span')
        .first()
        .text()
        .trim();

    if (!ratingText) {
        logger.debug(`[${PROVIDER_NAME}] Rating not found for ${imdbId} at ${url}`);
        return null;
    }

    const rating = parseFloat(ratingText);
    if (isNaN(rating) || rating < 0 || rating > 10) {
        logger.debug(`[${PROVIDER_NAME}] Invalid rating "${ratingText}" for ${imdbId} at ${url}`);
        return null;
    }

    return {
        source: PROVIDER_NAME,
        value: `${rating.toFixed(1)}/10`,
        url,
    };
}

async function getRating(_type, imdbId) {
    const baseId = imdbId?.split(':')[0];

    if (!baseId || !/^tt\d+$/.test(baseId)) {
        logger.warn(`[${PROVIDER_NAME}] Invalid IMDb ID: ${imdbId}`);
        return null;
    }

    if (!BASE_URL) {
        logger.warn(`[${PROVIDER_NAME}] Skipping ${baseId}: Base URL not configured`);
        return null;
    }

    const url = `${BASE_URL}/title/${baseId}/`;
    logger.debug(`[${PROVIDER_NAME}] Fetching from ${url}`);

    const res = await getPage(url, PROVIDER_NAME, {
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    // httpClient already handles non-200 logging
    if (!res || res.status !== 200) return null;

    return extractRatingFromHtml(res.data, url, baseId);
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
};
