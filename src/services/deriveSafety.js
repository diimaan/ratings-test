const logger = require('../utils/logger');
const {
    findMdblistMetadata,
    flattenResults,
} = require('./ratingHelpers');
const {
    evaluateSafetyKeywords,
} = require('./safetyPolicy');

function isLikelyAnimeFromMdblistMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return false;

    if (metadata.flags?.hasMalId || metadata.ids?.mal) return true;
    if (metadata.flags?.isJapaneseLanguage || metadata.language === 'ja') return true;
    if (metadata.flags?.hasAnimeGenre) return true;

    if (Array.isArray(metadata.genres)) {
        return metadata.genres.some(genre => /anime/i.test(String(genre || '')));
    }

    return false;
}

function normalizeSafetyCertification(value) {
    if (value === true) return 'safe';
    if (value === false) return 'unsafe';

    const text = String(value ?? '')
        .trim()
        .toLowerCase();

    if (!text) return null;

    if (
        /\bnot[-\s]?parent[-\s]?safe\b/.test(text) ||
        /\bunsafe\b/.test(text) ||
        /\bnot safe\b/.test(text)
    ) {
        return 'unsafe';
    }

    if (
        /\bparent[-\s]?safe\b/.test(text) ||
        /\bsafe\b/.test(text) ||
        /\bcertified\b/.test(text)
    ) {
        return 'safe';
    }

    return null;
}

function deriveMdblistSafetyResults(mdblistResults, options = {}) {
    const useKeywordWarnings = options.useKeywordWarnings !== false;
    const type = options.type || 'movie';
    const isEpisode = options.isEpisode === true;
    const mdblistFlat = flattenResults(mdblistResults);
    const metadata = findMdblistMetadata(mdblistFlat);

    if (!metadata) {
        logger.info('[MDBSafety] No MDBList metadata available for safety derivation');
        return [];
    }

    const results = [];

    const commonSense = Number(
        metadata?.age?.commonSense ??
        metadata?.age?.ageRating
    );
    const parentalNudity = Number(
        metadata?.age?.parentalNudity
    );
    const safetyCertification = normalizeSafetyCertification(
        metadata?.safety?.parentSafe ??
        metadata?.safety?.certification ??
        metadata?.safety?.rating
    );
    const keywords = Array.isArray(metadata?.keywords) ? metadata.keywords : [];
    const isAnime = options.isAnime ?? isLikelyAnimeFromMdblistMetadata(metadata);

    if (Number.isFinite(commonSense) && commonSense > 0) {
        results.push({
            source: 'Common Sense',
            value: `${commonSense}+`,
        });
    }

    const keywordSafety = evaluateSafetyKeywords({
        keywords,
        parentalNudity,
        useKeywordWarnings,
        type,
        isEpisode,
        isAnime,
    });
    const hasSexualViolence = keywordSafety.hasSexualViolence;
    const hasSexAndNudity = keywordSafety.hasSexAndNudity || hasSexualViolence;

    if (safetyCertification === 'safe' && !hasSexualViolence && !hasSexAndNudity) {
        results.push({
            source: 'Parent Safe',
            value: '✅ Parent Safe',
        });
    }

    if (safetyCertification === 'unsafe' || hasSexualViolence || hasSexAndNudity) {
        results.push({
            source: 'Not Safe',
            value: '⚠️ Not Parent Safe',
        });
    }

    if (hasSexualViolence) {
        results.push({
            source: 'Sexual Violence',
            value: '💔 Sexual Violence',
        });
    } else if (hasSexAndNudity) {
        results.push({
            source: 'Sex & Nudity',
            value: '🫣 Sex & Nudity',
        });
    }

    logger.info(
        `[MDBSafety] Derived ${results.length} safety result(s) ` +
        `(commonSense=${Number.isFinite(commonSense) && commonSense > 0 ? commonSense : 'none'}, ` +
        `csmAvailable=${metadata?.flags?.hasCommonSenseData === true ? 'true' : 'false'}, ` +
        `certification=${safetyCertification || 'none'}, ` +
        `keywordWarnings=${useKeywordWarnings ? 'on' : 'off'}, ` +
        `keywordScore=${keywordSafety.sexNudityScore}/${keywordSafety.threshold}, ` +
        `sexualViolenceScore=${keywordSafety.sexualViolenceScore}, ` +
        `anime=${isAnime ? 'true' : 'false'}, ` +
        `episode=${isEpisode ? 'true' : 'false'}, ` +
        `keywords=${keywords.length})`
    );
    logger.debug(`[MDBSafety] Derived safety results: ${JSON.stringify(results)}`);

    return results;
}

module.exports = {
    deriveMdblistSafetyResults,
    isLikelyAnimeFromMdblistMetadata,
    normalizeSafetyCertification,
};
