const logger = require('../utils/logger');
const {
    findMdblistMetadata,
    flattenResults,
} = require('./ratingHelpers');

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

    if (Number.isFinite(commonSense) && commonSense > 0) {
        results.push({
            source: 'Common Sense',
            value: `${commonSense}+`,
        });
    }

    const sexualViolencePatterns = [
        /\brape\b/i,
        /\bsexual-assault\b/i,
        /\bsexual-violence\b/i,
        /\battempted-rape\b/i,
        /\bgang-rape\b/i,
        /\bprison-rape\b/i,
        /\bdate-rape\b/i,
        /\brape-scene\b/i,
        /\brape-victim\b/i,
        /\bfemale-rape-victim\b/i,
        /\bmale-rape\b/i,
        /\bmale-rape-victim\b/i,
        /\bmale-on-female-rape\b/i,
        /\bfemale-on-male-rape\b/i,
        /\bbrutal-rape\b/i,
        /\banal-rape\b/i,
        /\bsimulated-rape\b/i,
        /\bsimulated-anal-rape\b/i,
        /\bgay-rape\b/i,
        /\binterracial-rape\b/i,
        /\bconsensual-sex-turns-to-rape\b/i,
        /\bsexual assault\b/i,
        /\bsexual violence\b/i,
    ];

    const sexNudityPatterns = [
        /\bsex\b/i,
        /\bsex-scene\b/i,
        /\bsex-scenes\b/i,
        /\bgraphic-sex-scene\b/i,
        /\bnudity\b/i,
        /\bfull-frontal-nudity\b/i,
        /\bfemale-frontal-nudity\b/i,
        /\bfemale-full-frontal-nudity\b/i,
        /\bfemale-nudity\b/i,
        /\bfemale-rear-nudity\b/i,
        /\bfemale-topless-nudity\b/i,
        /\bmale-frontal-nudity\b/i,
        /\bmale-full-frontal-nudity\b/i,
        /\bmale-nudity\b/i,
        /\bmale-rear-nudity\b/i,
        /\bpublic-nudity\b/i,
        /\boutdoor-nudity\b/i,
        /\bgraphic-nudity\b/i,
        /\bbrief-male-frontal-nudity\b/i,
        /\bbrief-male-full-frontal-nudity\b/i,
        /\blesbian-sex-scene\b/i,
    ];

    const hasSexualViolence = useKeywordWarnings && keywords.some(keyword =>
        sexualViolencePatterns.some(pattern => pattern.test(keyword))
    );

    const hasSexAndNudityKeyword = useKeywordWarnings && keywords.some(keyword =>
        sexNudityPatterns.some(pattern => pattern.test(keyword))
    );

    const hasSexAndNudity = (
        (Number.isFinite(parentalNudity) && parentalNudity >= 4) ||
        hasSexAndNudityKeyword ||
        hasSexualViolence
    );

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
