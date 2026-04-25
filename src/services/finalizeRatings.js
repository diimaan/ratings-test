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
    'Common Sense': ['MDBDERIVED'],
    'Not Safe': ['MDBDERIVED'],
    'Sexual Violence': ['MDBDERIVED'],
    'Sex & Nudity': ['MDBDERIVED'],
    IMDb: ['NATIVE', 'PMDB', 'MDBLIST'],
    TMDb: ['NATIVE', 'PMDB', 'MDBLIST'],
    MAL: ['JIKAN_ID', 'MDBLIST', 'PMDB'],
    Letterboxd: ['MDBLIST', 'PMDB'],
    MDBList: ['MDBLIST'],
    MC: ['PMDB', 'MDBLIST'],
    RT: ['PMDB', 'MDBLIST'],
    PC: ['PMDB', 'MDBLIST'],
    Trakt: ['PMDB', 'MDBLIST'],
    'Roger Ebert': ['MDBLIST', 'PMDB'],
};

function finalizeRatings({
    type,
    imdbResults,
    tmdbResults,
    malResults,
    mdblistDerivedResults,
    metaResults,
    mdblistResults,
    userConfig = config.userConfig,
}) {
    const imdbFlat = flattenResults(imdbResults);
    const tmdbFlat = flattenResults(tmdbResults);
    const malFlat = flattenResults(malResults);
    const mdblistDerivedFlat = flattenResults(mdblistDerivedResults);
    const metaFlat = flattenResults(metaResults);
    const mdblistFlat = flattenResults(mdblistResults);

    const familyMap = new Map();

    const candidatesByFamily = {
        'Common Sense': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        'Not Safe': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        'Sexual Violence': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        'Sex & Nudity': {
            MDBDERIVED: mdblistDerivedFlat,
        },
        IMDb: {
            NATIVE: imdbFlat,
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        TMDb: {
            NATIVE: tmdbFlat,
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        MC: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        RT: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        PC: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        Trakt: {
            PMDB: metaFlat,
            MDBLIST: mdblistFlat,
        },
        MAL: {
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
            family === 'Common Sense' ||
            family === 'Not Safe' ||
            family === 'Sexual Violence' ||
            family === 'Sex & Nudity'
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
