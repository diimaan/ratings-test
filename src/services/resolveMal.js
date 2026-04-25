const logger = require('../utils/logger');
const providers = require('../providers');
const {
    isLikelyAnimeFromMdblistMetadata,
} = require('./deriveSafety');
const {
    isDisplayableRatingValue,
    pickFirstValidFromArray,
    findMdblistMetadata,
    flattenResults,
} = require('./ratingHelpers');

async function resolveMalRatings(
    type,
    rawId,
    ctx,
    streamInfo,
    tmdbId,
    mdblistResults,
    metaResults,
    userConfig
) {
    const lookupRawId = ctx.isEpisode ? ctx.imdbId : rawId;
    const lookupStreamInfo = ctx.isEpisode
        ? { ...streamInfo, isEpisode: false, season: null, episode: null }
        : streamInfo;

    const mdblistFlat = flattenResults(mdblistResults);
    const metaFlat = flattenResults(metaResults);

    const mdblistFamily = pickFirstValidFromArray(mdblistFlat, 'MAL', type);
    const mdblistMetadata = findMdblistMetadata(mdblistFlat);

    const looksAnime = isLikelyAnimeFromMdblistMetadata(mdblistMetadata);
    const malId = mdblistMetadata?.ids?.mal;
    const hasAnimeSignal = Boolean(looksAnime || malId || mdblistFamily);

    if (!looksAnime && mdblistMetadata) {
        logger.info('Skipping MAL resolution for non-anime title');
        return [];
    }

    if (malId && providers.jikanProvider?.getByMalId) {
        try {
            const jikan = await providers.jikanProvider.getByMalId(malId, userConfig);
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

    if (!hasAnimeSignal) {
        logger.info('Skipping Jikan search fallback without a strong anime signal');
        return [];
    }

    try {
        const jikanFallback = await providers.jikanProvider?.getRating(
            type,
            lookupRawId,
            lookupStreamInfo,
            tmdbId,
            userConfig
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
