const logger = require('../utils/logger');
const { findMdblistRawPayload, flattenResults } = require('./ratingHelpers');

function isLikelyAnimeFromMdblistRaw(mdblistRaw) {
    if (!mdblistRaw || typeof mdblistRaw !== 'object') return false;

    if (mdblistRaw?.ids?.mal) return true;

    const language = String(mdblistRaw.language || '').toLowerCase();
    if (language === 'ja') return true;

    if (Array.isArray(mdblistRaw.genres)) {
        const hasAnimeGenre = mdblistRaw.genres.some(g =>
            /anime/i.test(String(g?.title || ''))
        );
        if (hasAnimeGenre) return true;
    }

    return false;
}

function normalizeKeywordName(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function getMdblistKeywordNames(mdblistRaw) {
    if (!Array.isArray(mdblistRaw?.keywords)) return [];

    return [...new Set(
        mdblistRaw.keywords
            .map(item => normalizeKeywordName(item?.name))
            .filter(Boolean)
    )];
}

function deriveMdblistSafetyResults(mdblistResults) {
    const mdblistFlat = flattenResults(mdblistResults);
    const mdblistRaw = findMdblistRawPayload(mdblistFlat);

    if (!mdblistRaw || typeof mdblistRaw !== 'object') {
        return [];
    }

    const results = [];

    const commonSense = Number(mdblistRaw?.commonsense_media?.common_sense ?? mdblistRaw?.age_rating);
    const parentalNudity = Number(mdblistRaw?.commonsense_media?.parental_nudity);
    const keywords = getMdblistKeywordNames(mdblistRaw);

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

    const hasSexualViolence = keywords.some(keyword =>
        sexualViolencePatterns.some(pattern => pattern.test(keyword))
    );

    const hasSexAndNudityKeyword = keywords.some(keyword =>
        sexNudityPatterns.some(pattern => pattern.test(keyword))
    );

    const hasSexAndNudity = (
        (Number.isFinite(parentalNudity) && parentalNudity >= 4) ||
        hasSexAndNudityKeyword ||
        hasSexualViolence
    );

    if (hasSexualViolence || hasSexAndNudity) {
        results.push({
            source: 'Not Safe',
            value: '⚠️ Not Safe',
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

    logger.debug(`[MDBSafety] Derived safety results: ${JSON.stringify(results)}`);

    return results;
}

module.exports = {
    deriveMdblistSafetyResults,
    isLikelyAnimeFromMdblistRaw,
};
