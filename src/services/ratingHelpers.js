function imdbLabel(type, isEpisode) {
    if (isEpisode) return 'IMDb (Episode)';
    return type === 'series' ? 'IMDb (Show)' : 'IMDb (Movie)';
}

function tmdbLabel(type, isEpisode) {
    if (isEpisode) return 'TMDb (Episode)';
    return type === 'series' ? 'TMDb (Show)' : 'TMDb (Movie)';
}

function normalizeOtherSourceLabel(source, type) {
    const s = String(source || '').trim();

    if (s === 'IMDb') return imdbLabel(type, false);
    if (s === 'IMDb Episode') return imdbLabel(type, true);

    if (s === 'TMDb') return tmdbLabel(type, false);
    if (s === 'TMDb Episode') return tmdbLabel(type, true);

    return s;
}

function sourceFamily(label) {
    if (!label) return null;
    if (label === 'Common Sense') return 'Common Sense';
    if (label === 'Not Safe') return 'Not Safe';
    if (label === 'Sexual Violence') return 'Sexual Violence';
    if (label === 'Sex & Nudity') return 'Sex & Nudity';
    if (label.startsWith('IMDb (')) return 'IMDb';
    if (label.startsWith('TMDb (')) return 'TMDb';
    if (label === 'MC') return 'MC';
    if (label === 'RT') return 'RT';
    if (label === 'PC') return 'PC';
    if (label === 'MDBList') return 'MDBList';
    if (label === 'Trakt') return 'Trakt';
    if (label === 'MAL') return 'MAL';
    if (label === 'Letterboxd') return 'Letterboxd';
    if (label === 'Roger Ebert') return 'Roger Ebert';
    return label;
}

function numericPrefix(value) {
    const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
}

function isRogerEbertStars(value) {
    const text = String(value || '').trim();
    return /^[⭐✨]+$/.test(text) && text.includes('⭐');
}

function looksLikeSafetyBlock(value) {
    const text = String(value || '').trim();
    if (!text) return false;

    return /⚠️|🫣|💔/.test(text);
}

function isDisplayableRatingValue(source, value) {
    if (value === null || value === undefined) return false;

    const text = String(value).trim();
    if (!text) return false;

    if (
        source === 'Common Sense' ||
        source === 'Not Safe' ||
        source === 'Sexual Violence' ||
        source === 'Sex & Nudity'
    ) {
        return true;
    }

    if (source === 'Roger Ebert' && isRogerEbertStars(text)) {
        return true;
    }

    const num = numericPrefix(text);
    if (!Number.isFinite(num)) return false;

    return num > 0;
}

function processSingleRating(rating, type) {
    if (!rating || rating._raw) return null;
    if (!rating.source || rating.value === undefined || rating.value === null) return null;

    const source = normalizeOtherSourceLabel(rating.source, type);
    const value = String(rating.value).trim();

    if (!isDisplayableRatingValue(source, value)) {
        return null;
    }

    return { source, value };
}

function sourceMatchesEnabled(source, enabledList) {
    if (!enabledList?.length) return true;
    if (enabledList.includes(source)) return true;

    const aliases = {
        'IMDb': ['IMDb (Movie)', 'IMDb (Show)', 'IMDb (Episode)'],
        'IMDb Episode': ['IMDb (Episode)'],
        'TMDb': ['TMDb (Movie)', 'TMDb (Show)', 'TMDb (Episode)'],
        'TMDb Episode': ['TMDb (Episode)'],
    };

    for (const [alias, expanded] of Object.entries(aliases)) {
        if (enabledList.includes(alias) && expanded.includes(source)) {
            return true;
        }
    }

    return false;
}

function orderIndexForSource(source, orderList) {
    if (!orderList?.length) return Number.MAX_SAFE_INTEGER;

    const aliases = {
        'IMDb': ['IMDb (Movie)', 'IMDb (Show)', 'IMDb (Episode)'],
        'IMDb Episode': ['IMDb (Episode)'],
        'TMDb': ['TMDb (Movie)', 'TMDb (Show)', 'TMDb (Episode)'],
        'TMDb Episode': ['TMDb (Episode)'],
    };

    let best = Number.MAX_SAFE_INTEGER;

    orderList.forEach((entry, index) => {
        if (entry === source) {
            best = Math.min(best, index);
        }

        const expanded = aliases[entry];
        if (expanded && expanded.includes(source)) {
            best = Math.min(best, index);
        }
    });

    return best;
}

function pickFirstValidFromArray(items, family, type) {
    if (!Array.isArray(items)) return null;

    for (const item of items) {
        const processed = processSingleRating(item, type);
        if (!processed) continue;
        if (sourceFamily(processed.source) !== family) continue;
        return processed;
    }

    return null;
}

function findMdblistRawPayload(mdblistResults) {
    if (!Array.isArray(mdblistResults)) return null;
    const rawEntry = mdblistResults.find(item => item && item._raw && typeof item._raw === 'object');
    return rawEntry?._raw || null;
}

function flattenResults(results) {
    return results
        .filter(Boolean)
        .flatMap(r => (Array.isArray(r) ? r : [r]));
}

function selectFamilyResult(family, candidates, type) {
    for (const candidate of candidates) {
        const picked = pickFirstValidFromArray(candidate, family, type);
        if (picked) return picked;
    }
    return null;
}

module.exports = {
    imdbLabel,
    tmdbLabel,
    sourceFamily,
    looksLikeSafetyBlock,
    isDisplayableRatingValue,
    processSingleRating,
    sourceMatchesEnabled,
    orderIndexForSource,
    pickFirstValidFromArray,
    findMdblistRawPayload,
    flattenResults,
    selectFamilyResult,
};
