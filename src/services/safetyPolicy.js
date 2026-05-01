const SEXUAL_VIOLENCE_KEYWORD_WEIGHTS = new Map([
    ['rape', 120],
    ['rape-scene', 120],
    ['rape-victim', 120],
    ['attempted-rape', 120],
    ['gang-rape', 120],
    ['prison-rape', 120],
    ['date-rape', 120],
    ['sexual-assault', 120],
    ['sexual-violence', 120],
    ['forced-sex', 120],
    ['coerced-sex', 120],
    ['brutal-rape', 120],
    ['anal-rape', 120],
    ['simulated-rape', 120],
    ['simulated-anal-rape', 120],
    ['consensual-sex-turns-to-rape', 120],
    ['male-rape', 120],
    ['male-rape-victim', 120],
    ['female-rape-victim', 120],
    ['male-on-female-rape', 120],
    ['female-on-male-rape', 120],
]);

const SEX_NUDITY_KEYWORD_WEIGHTS = new Map([
    ['graphic-sex-scene', 90],
    ['explicit-sex-scene', 90],
    ['unsimulated-sex', 90],
    ['pornographic-content', 90],
    ['sex-scene', 65],
    ['sex-scenes', 65],
    ['intercourse', 55],
    ['sexual-intercourse', 60],
    ['oral-sex', 60],
    ['anal-sex', 65],
    ['masturbation', 50],
    ['sexual-content', 45],
    ['full-frontal-nudity', 45],
    ['female-full-frontal-nudity', 45],
    ['male-full-frontal-nudity', 45],
    ['female-frontal-nudity', 40],
    ['male-frontal-nudity', 40],
    ['graphic-nudity', 60],
    ['nudity', 15],
    ['female-nudity', 15],
    ['male-nudity', 15],
    ['female-topless-nudity', 20],
    ['female-rear-nudity', 10],
    ['male-rear-nudity', 10],
    ['public-nudity', 20],
    ['outdoor-nudity', 15],
    ['brief-male-frontal-nudity', 25],
    ['brief-male-full-frontal-nudity', 25],
    ['sex', 10],
]);

function normalizeKeyword(keyword) {
    return String(keyword || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-');
}

function scoreKeywords(keywords, weightMap) {
    const matched = [];
    let score = 0;

    for (const rawKeyword of keywords) {
        const keyword = normalizeKeyword(rawKeyword);
        const weight = weightMap.get(keyword);

        if (!weight) continue;

        score += weight;
        matched.push({
            keyword,
            weight,
        });
    }

    return { score, matched };
}

function mediaLevelThreshold({ isEpisode = false, isAnime = false, type = 'movie' } = {}) {
    let threshold = 60;

    if (type === 'series') threshold = 80;
    if (isEpisode) threshold = 120;
    if (isAnime) threshold += 30;

    return threshold;
}

function evaluateSafetyKeywords({
    keywords = [],
    parentalNudity,
    useKeywordWarnings = true,
    type = 'movie',
    isEpisode = false,
    isAnime = false,
} = {}) {
    if (!useKeywordWarnings) {
        return {
            hasSexualViolence: false,
            hasSexAndNudity: false,
            sexualViolenceScore: 0,
            sexNudityScore: 0,
            threshold: mediaLevelThreshold({ isEpisode, isAnime, type }),
            sexualViolenceMatches: [],
            sexNudityMatches: [],
        };
    }

    const sexualViolence = scoreKeywords(keywords, SEXUAL_VIOLENCE_KEYWORD_WEIGHTS);
    const sexNudity = scoreKeywords(keywords, SEX_NUDITY_KEYWORD_WEIGHTS);
    const threshold = mediaLevelThreshold({ isEpisode, isAnime, type });
    const parentalNudityScore = Number.isFinite(parentalNudity) && parentalNudity >= 4 ? 80 : 0;
    const sexNudityScore = sexNudity.score + parentalNudityScore;

    return {
        hasSexualViolence: sexualViolence.score >= 100,
        hasSexAndNudity: sexNudityScore >= threshold,
        sexualViolenceScore: sexualViolence.score,
        sexNudityScore,
        threshold,
        sexualViolenceMatches: sexualViolence.matched,
        sexNudityMatches: sexNudity.matched,
    };
}

module.exports = {
    evaluateSafetyKeywords,
    mediaLevelThreshold,
    normalizeKeyword,
};
