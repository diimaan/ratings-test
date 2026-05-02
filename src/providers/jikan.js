const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const PROVIDER_NAME = 'Jikan';

// Require a very confident match for title-based lookup.
// This effectively means exact title match, optionally strengthened by year/anime signals.
const MIN_MATCH_SCORE = 95;

function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function extractYear(streamInfo) {
    if (streamInfo?.year) {
        const y = Number(streamInfo.year);
        if (Number.isFinite(y) && y > 1900) return y;
    }

    if (streamInfo?.date) {
        const y = new Date(streamInfo.date).getFullYear();
        if (Number.isFinite(y) && y > 1900) return y;
    }

    return null;
}

function scoreToValue(score) {
    const num = Number(score);
    if (!Number.isFinite(num) || num <= 0) return null;
    return `${num.toFixed(1)}/10`;
}

function looksLikeAnimeCandidate(item) {
    if (!item || typeof item !== 'object') return false;

    const demographics = Array.isArray(item.demographics)
        ? item.demographics.map(d => String(d?.name || '').toLowerCase())
        : [];

    // Strongest anime-only signal on MAL.
    if (demographics.length > 0) return true;

    const source = String(item.source || '').toLowerCase();
    if (source && source !== 'unknown') return true;

    const type = String(item.type || '').toLowerCase();
    if (['ova', 'ona', 'special', 'music'].includes(type)) return true;

    return false;
}

function scoreCandidate(item, streamInfo) {
    let score = 0;

    const wantedTitle = normalizeTitle(streamInfo?.name || '');
    const wantedYear = extractYear(streamInfo);

    const candidateTitles = [
        item?.title,
        item?.title_english,
        item?.title_japanese,
        ...(Array.isArray(item?.title_synonyms) ? item.title_synonyms : []),
        ...(Array.isArray(item?.titles)
            ? item.titles.map(t => t?.title).filter(Boolean)
            : []),
    ].filter(Boolean);

    const normalizedCandidates = candidateTitles.map(normalizeTitle);

    if (wantedTitle && normalizedCandidates.includes(wantedTitle)) {
        score += 100;
    } else if (wantedTitle) {
        const hasSubstantialPartial = normalizedCandidates.some(t => {
            if (!t || !wantedTitle) return false;

            const shorter = Math.min(t.length, wantedTitle.length);
            const longer = Math.max(t.length, wantedTitle.length);

            return (t.includes(wantedTitle) || wantedTitle.includes(t))
                && shorter / longer > 0.7;
        });

        if (hasSubstantialPartial) {
            score += 50;
        }
    }

    const itemYear = Number(item?.year) || Number(item?.aired?.prop?.from?.year) || null;
    if (wantedYear && itemYear) {
        if (wantedYear === itemYear) score += 30;
        else if (Math.abs(wantedYear - itemYear) === 1) score += 10;
    }

    if (looksLikeAnimeCandidate(item)) score += 15;

    score += Math.min(Number(item?.members) || 0, 5000000) / 500000;
    score += Math.min(Number(item?.scored_by) || 0, 3000000) / 300000;

    return score;
}

async function getByMalId(malId, userConfig = config.userConfig) {
    const apiUrl = userConfig?.providers?.jikan?.apiUrl || config.jikan.apiUrl;
    const id = Number(malId);
    if (!Number.isFinite(id) || id <= 0) return null;

    try {
        const res = await axios.get(`${apiUrl}/anime/${id}`, {
            timeout: config.http.requestTimeoutMs || 12000,
            headers: { 'User-Agent': config.userAgent },
            validateStatus: status => status >= 200 && status < 500,
        });

        if (res.status !== 200 || !res.data?.data) return null;

        const item = res.data.data;
        const value = scoreToValue(item.score);
        if (!value) return null;

        return {
            source: 'MyAnimeList',
            value,
        };
    } catch (err) {
        logger.warn(`[${PROVIDER_NAME}] MAL ID lookup failed: ${err.message}`);
        return null;
    }
}

async function searchByTitle(streamInfo, type, userConfig = config.userConfig) {
    const apiUrl = userConfig?.providers?.jikan?.apiUrl || config.jikan.apiUrl;
    const title = String(streamInfo?.name || '').trim();
    if (!title) return null;

    // Do not title-search movies. Too many false positives.
    if (type === 'movie') {
        logger.debug(`[${PROVIDER_NAME}] Skipping title search for movie type`);
        return null;
    }

    try {
        const res = await axios.get(`${apiUrl}/anime`, {
            timeout: config.http.requestTimeoutMs || 12000,
            headers: { 'User-Agent': config.userAgent },
            params: { q: title, limit: 5 },
            validateStatus: status => status >= 200 && status < 500,
        });

        if (res.status !== 200 || !Array.isArray(res.data?.data) || res.data.data.length === 0) {
            return null;
        }

        const sorted = [...res.data.data]
            .map(item => ({ item, score: scoreCandidate(item, streamInfo) }))
            .sort((a, b) => b.score - a.score);

        const best = sorted[0];

        if (!best || best.score < MIN_MATCH_SCORE) {
            logger.debug(
                `[${PROVIDER_NAME}] No confident match for "${title}" (best: ${best?.score ?? 0})`
            );
            return null;
        }

        if (!looksLikeAnimeCandidate(best.item)) {
            logger.debug(
                `[${PROVIDER_NAME}] Best match for "${title}" does not look like anime, rejecting`
            );
            return null;
        }

        const value = scoreToValue(best.item.score);
        if (!value) return null;

        logger.debug(
            `[${PROVIDER_NAME}] Matched "${title}" to MAL ID ${best.item.mal_id} (score: ${best.score})`
        );

        return {
            source: 'MyAnimeList',
            value,
        };
    } catch (err) {
        logger.warn(`[${PROVIDER_NAME}] Title search failed: ${err.message}`);
        return null;
    }
}

async function getRating(type, _imdbId, streamInfo, _tmdbId, userConfig = config.userConfig) {
    const malId = streamInfo?.malId || streamInfo?.mal_id || null;

    if (malId) {
        const byId = await getByMalId(malId, userConfig);
        if (byId) return byId;
    }

    return searchByTitle(streamInfo, type, userConfig);
}

module.exports = {
    name: PROVIDER_NAME,
    getRating,
    getByMalId,
};
