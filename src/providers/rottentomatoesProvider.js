const cheerio = require('cheerio');
const config = require('../config');
const logger = require('../utils/logger');
const { getPage } = require('../utils/httpClient');

const PROVIDER_NAME = 'Rotten Tomatoes';
const BASE_URL = config.sources.rottentomatoesBaseUrl;

function formatSlug(title) {
    return title?.toLowerCase()
        .replace(/[:_]/g, ' ')
        .replace(/['’]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || '';
}

function buildCandidateUrls(title, type, year) {
    const path = type === 'series' ? 'tv' : 'm';
    const slug = formatSlug(title);

    const urls = [];

    if (year) {
        urls.push(`${BASE_URL}/${path}/${slug}_${year}`);
    }

    urls.push(`${BASE_URL}/${path}/${slug}`);

    if (year) {
        urls.push(`${BASE_URL}/${path}/${slug}_${year}_2`);
    }

    return urls;
}

function parseJsonLd($) {
    let criticRating = null;

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).html());

            if (json.aggregateRating?.ratingValue !== undefined && json.aggregateRating?.ratingValue !== null) {
                const val = parseInt(String(json.aggregateRating.ratingValue).replace('%', ''), 10);
                if (!isNaN(val)) {
                    criticRating = {
                        source: 'Rotten Tomatoes',
                        value: `${val}/100`,
                    };
                }
            }
        } catch {
            // ignore bad json
        }
    });

    return criticRating;
}

function scrapeDom($) {
    const critic = $('rt-text[slot="criticsScore"]').first().text().trim();

    if (/^\d+$/.test(critic)) {
        return {
            source: 'Rotten Tomatoes',
            value: `${critic}/100`,
        };
    }

    return null;
}

function scrape(html, url) {
    try {
        const $ = cheerio.load(html);

        const fromJsonLd = parseJsonLd($);
        if (fromJsonLd) return { ...fromJsonLd, url };

        const fromDom = scrapeDom($);
        if (fromDom) return { ...fromDom, url };

        return null;
    } catch (err) {
        logger.error(`[${PROVIDER_NAME}] Scrape error for ${url}: ${err.message}`);
        return null;
    }
}

async function tryFetch(url) {
    logger.debug(`[${PROVIDER_NAME}] Trying URL: ${url}`);

    const res = await getPage(url, PROVIDER_NAME, {
        headers: {
            Referer: BASE_URL,
            Accept: 'text/html,application/xhtml+xml',
        },
    });

    if (res?.status === 200) return scrape(res.data, url);
    return null;
}

async function getRating(type, imdbId, streamInfo) {
    if (!streamInfo?.name || !BASE_URL) return null;

    const year = streamInfo.year || (streamInfo.date?.split('-')[0] || '');
    const urls = buildCandidateUrls(streamInfo.name, type, year);

    for (const url of urls) {
        const result = await tryFetch(url);
        if (result) return result;
    }

    logger.debug(`[${PROVIDER_NAME}] No valid RT rating found for ${imdbId}`);
    return null;
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
};
