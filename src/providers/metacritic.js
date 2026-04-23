const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../utils/logger');
const { getPage } = require('../utils/httpClient');
const { formatTitleForUrlSlug } = require('../utils/urlFormatter');

const PROVIDER_NAME = 'Metacritic';
const BASE_URL = config.sources.metacriticBaseUrl;

function getMetacriticUrl(title, type) {
    if (!title || !BASE_URL) return null;
    const mediaType = type === 'series' ? 'tv' : 'movie';
    const slug = formatTitleForUrlSlug(title);
    return slug ? `${BASE_URL}/${mediaType}/${slug}` : null;
}

function scrapeMetacriticPage(html, url) {
    const $ = cheerio.load(html);

    const criticScore = $('[data-testid="critic-score-info"] .c-siteReviewScore span')
        .first()
        .text()
        .trim();

    if (/^\d+$/.test(criticScore)) {
        const score = parseInt(criticScore, 10);

        if (score >= 0 && score <= 100) {
            return {
                source: 'MC',
                value: `${score}/100`,
                url,
            };
        }
    }

    return null;
}

async function getRating(type, imdbId, streamInfo) {
    if (!streamInfo?.name) {
        logger.warn(`[${PROVIDER_NAME}] Skipping ${imdbId}: No title.`);
        return null;
    }

    const url = getMetacriticUrl(streamInfo.name, type);
    if (!url) return null;

    logger.debug(`[${PROVIDER_NAME}] Fetching ${url}`);

    const res = await getPage(url, PROVIDER_NAME);
    if (!res || res.status !== 200) return null;

    return scrapeMetacriticPage(res.data, url);
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
};
