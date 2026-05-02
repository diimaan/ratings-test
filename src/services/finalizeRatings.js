const config = require('../config');
const logger = require('../utils/logger');
const {
    sourceMatchesEnabled,
    orderIndexForSource,
    looksLikeSafetyBlock,
    processSingleRating,
    flattenResults,
    selectFamilyResult,
} = require('./ratingHelpers');

const RATING_PRIORITY = {
    'Common Sense': ['DIRECT', 'MDBDERIVED'],
    'Parent Safe': ['DIRECT', 'MDBDERIVED'],
    'Not Safe': ['DIRECT', 'MDBDERIVED'],
    'Sexual Violence': ['DIRECT', 'MDBDERIVED'],
    'Sex & Nudity': ['DIRECT', 'MDBDERIVED'],
    IMDb: ['LOCAL', 'PMDB', 'MDBLIST'],
    TMDb: ['LOCAL', 'PMDB', 'MDBLIST'],
    MyAnimeList: ['JIKAN_ID', 'MDBLIST', 'PMDB'],
    Letterboxd: ['MDBLIST', 'PMDB'],
    MDBList: ['MDBLIST'],
    Metacritic: ['PMDB', 'MDBLIST'],
    'Rotten Tomatoes': ['PMDB', 'MDBLIST'],
    Popcornmeter: ['PMDB', 'MDBLIST'],
    Trakt: ['PMDB', 'MDBLIST'],
    'Roger Ebert': ['MDBLIST', 'PMDB'],
};

const SAFETY_FAMILIES = [
    'Common Sense',
    'Parent Safe',
    'Not Safe',
    'Sexual Violence',
    'Sex & Nudity',
];

const SAFETY_VERDICT_FAMILIES = new Set([
    'Parent Safe',
    'Not Safe',
]);

function safetyFamiliesIn(results, type) {
    const families = new Set();

    for (const item of results) {
        const processed = processSingleRating(item, type);
        if (processed?.source) families.add(processed.source);
    }

    return families;
}

function shouldKeepDerivedSafety(item, directFamilies, type) {
    const processed = processSingleRating(item, type);
    if (!processed?.source) return false;

    if (directFamilies.has(processed.source)) return false;

    if (
        SAFETY_VERDICT_FAMILIES.has(processed.source) &&
        [...SAFETY_VERDICT_FAMILIES].some(family => directFamilies.has(family))
    ) {
        return false;
    }

    return true;
}

function finalizeRatings({
    type,
    imdbResults,
    tmdbResults,
    malResults,
    directSafetyResults,
    mdblistDerivedResults,
    metaResults,
    mdblistResults,
    userConfig = config.userConfig,
}) {
    const imdbFlat = flattenResults(imdbResults);
    const tmdbFlat = flattenResults(tmdbResults);
    const malFlat = flattenResults(malResults);
    const directSafetyFlat = flattenResults(directSafetyResults);
    const mdblistDerivedFlat = flattenResults(mdblistDerivedResults);
    const directSafetyFamilies = safetyFamiliesIn(directSafetyFlat, type);
    const fallbackSafetyFlat = mdblistDerivedFlat.filter(item =>
        shouldKeepDerivedSafety(item, directSafetyFamilies, type)
    );
    const metaFlat = flattenResults(metaResults);
    const mdblistFlat = flattenResults(mdblistResults);

    const familyMap = new Map();

    const candidatesByFamily = {
        'Common Sense': {
            DIRECT: directSafetyFlat,
            MDBDERIVED: fallbackSafetyFlat,
        },
        'Parent Safe': {
            DIRECT: directSafetyFlat,
            MDBDERIVED: fallbackSafetyFlat,
        },
        'Not Safe': {
            DIRECT: directSafetyFlat,
            MDBDERIVED: fallbackSafetyFlat,
        },
        'Sexual Violence': {
            DIRECT: directSafetyFlat,
            MDBDERIVED: fallbackSafetyFlat,
        },
        'Sex & Nudity': {
            DIRECT: directSafetyFlat,
            MDBDERIVED: fallbackSafetyFlat,
        },
        IMDb: {
            LOCAL: imdbFlat,
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        TMDb: {
            LOCAL: tmdbFlat,
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        Metacritic: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        'Rotten Tomatoes': {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        Popcornmeter: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        Trakt: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        MyAnimeList: {
            JIKAN_ID: malFlat,
            MDBLIST: mdblistFlat,
            PMDB: metaFlat,
        },
        Letterboxd: {
            MDBLIST: mdblistFlat,
            PMDB: metaFlat,
        },
        'Roger Ebert': type === 'movie'
            ? {
                MDBLIST: mdblistFlat,
                PMDB: metaFlat,
            }
            : null,
        MDBList: {
            MDBLIST: mdblistFlat,
        },
    };

    for (const [family, order] of Object.entries(RATING_PRIORITY)) {
        const sources = candidatesByFamily[family];
        if (!sources) continue;

        let candidateArrays = order.map(step => sources[step]).filter(Boolean);

        if (
            SAFETY_FAMILIES.includes(family)
        ) {
            candidateArrays = candidateArrays.map(arr =>
                Array.isArray(arr)
                    ? arr.filter(item => {
                        const processed = processSingleRating(item, type);
                        return processed?.source === family;
                    })
                    : arr
            );
        }

        const picked = selectFamilyResult(family, candidateArrays, type);

        if (picked && !familyMap.has(family)) {
            familyMap.set(family, picked);
        }
    }

    logger.debug(`[Ratings] familyMap before enabled filter: ${JSON.stringify(Array.from(familyMap.values()))}`);
    const ratingsConfig = userConfig?.ratings || config.ratings;

    logger.debug(`[Ratings] enabled config: ${JSON.stringify(ratingsConfig.enabled)}`);

    const filtered = Array.from(familyMap.values()).filter(item =>
        sourceMatchesEnabled(item.source, ratingsConfig.enabled)
    );

    logger.debug(`[Ratings] after enabled filter: ${JSON.stringify(filtered)}`);

    filtered.sort((a, b) => {
        const aIndex = orderIndexForSource(a.source, ratingsConfig.order);
        const bIndex = orderIndexForSource(b.source, ratingsConfig.order);

        if (aIndex !== bIndex) return aIndex - bIndex;

        const aWarnings = looksLikeSafetyBlock(a.value);
        const bWarnings = looksLikeSafetyBlock(b.value);
        if (aWarnings !== bWarnings) return aWarnings ? 1 : -1;

        return a.source.localeCompare(b.source);
    });

    return filtered;
}

module.exports = {
    finalizeRatings,
};
