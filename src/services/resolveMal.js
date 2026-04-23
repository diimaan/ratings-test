const logger = require('../utils/logger');
const providers = require('../providers');
const {
    isLikelyAnimeFromMdblistRaw,
} = require('./deriveSafety');
const {
    isDisplayableRatingValue,
    pickFirstValidFromArray,
    findMdblistRawPayload,
    flattenResults,
} = require('./ratingHelpers');

async function resolveMalRatings(type, rawId, ctx, streamInfo, tmdbId, mdblistResults, metaResults) {
    const lookupRawId = ctx.isEpisode ? ctx.imdbId : rawId;
    const lookupStreamInfo = ctx.isEpisode
        ? { ...streamInfo, isEpisode: false, season: null, episode: null }
        : streamInfo;

    const mdblistFlat = flattenResults(mdblistResults);
    const metaFlat = flattenResults(metaResults);

    const mdblistFamily = pickFirstValidFromArray(mdblistFlat, 'MAL', type);
    const mdblistRaw = findMdblistRawPayload(mdblistFlat);

    const looksAnime = isLikelyAnimeFromMdblistRaw(mdblistRaw);

    if (!looksAnime && mdblistRaw) {
        logger.info('Skipping MAL resolution for non-anime title');
        return [];
    }

    const malId = mdblistRaw?.ids?.mal;

    if (malId && providers.jikanProvider?.getByMalId) {
        try {
            const jikan = await providers.jikanProvider.getByMalId(malId);
            if (jikan && isDisplayableRatingValue('MAL', jikan.value)) {
                logger.info('MAL rating found via Jikan MAL ID');
                return [{
                    source: 'MAL',
                    value: jikan.value,
                }];
            }
        } catch (err) {
            logger.warn(`Jikan MAL ID lookup failed: ${err.message}`);
        }
    }

    if (mdblistFamily) {
        logger.info('MAL rating found via MDBList');
        return [mdblistFamily];
    }

    const pmdbFamily = pickFirstValidFromArray(metaFlat, 'MAL', type);
    if (pmdbFamily) {
        logger.info('MAL rating found via PMDB');
        return [pmdbFamily];
    }

    try {
        const jikanFallback = await providers.jikanProvider?.getRating(
            type,
            lookupRawId,
            lookupStreamInfo,
            tmdbId
        );

        if (jikanFallback && isDisplayableRatingValue('MAL', jikanFallback.value)) {
            logger.info('MAL rating found via Jikan search fallback');
            return [{
                source: 'MAL',
                value: jikanFallback.value,
            }];
        }
    } catch (err) {
        logger.warn(`Jikan fallback search failed: ${err.message}`);
    }

    logger.info('MAL rating not found');
    return [];
}

module.exports = {
    resolveMalRatings,
};
