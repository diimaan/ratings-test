const MEDIA_SUFFIXES = {
  movie: '(Movie)',
  series: '(Show)',
};

function normalizePmdbSource(code, type) {
  const upper = String(code || '').trim().toUpperCase();
  const scopeSuffix = MEDIA_SUFFIXES[type] || '';

  const map = {
    IM: scopeSuffix ? `IMDb ${scopeSuffix}` : 'IMDb',
    TM: scopeSuffix ? `TMDb ${scopeSuffix}` : 'TMDb',
    MC: 'Metacritic',
    RT: 'Rotten Tomatoes',
    PC: 'Popcornmeter',
    TR: 'Trakt',
    LB: 'Letterboxd',
    MA: 'MyAnimeList',
    RE: 'Roger Ebert',
  };

  return map[upper] || null;
}

function normalizePmdbValue(code, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }

  const num = Number(rawValue);
  if (!Number.isFinite(num)) {
    return null;
  }

  const upper = String(code || '').trim().toUpperCase();

  // PMDB values are generally score-like and should display without /10 or /100 suffixes,
  // matching your current simplified UI direction.
  // IMDb and TMDb from PMDB are normalized as integer-style scores if they come through PMDB,
  // but native/local providers should remain the source of truth where available.
  switch (upper) {
    case 'IM':
    case 'MA':
    case 'LB':
    case 'RE':
      return num % 1 === 0 ? `${num.toFixed(0)}` : `${num.toFixed(1).replace(/\.0$/, '')}`;

    case 'TM':
    case 'MC':
    case 'RT':
    case 'PC':
    case 'TR':
      return `${Math.round(num)}`;

    default:
      return num % 1 === 0 ? `${num.toFixed(0)}` : `${num.toFixed(1).replace(/\.0$/, '')}`;
  }
}

function extractPmdbRatings(payload, type) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const out = [];
  const seen = new Set();

  // Accept a few likely shapes to keep this provider resilient.
  const candidates = [];

  if (Array.isArray(payload.ratings)) {
    candidates.push(...payload.ratings);
  }

  if (Array.isArray(payload.data?.ratings)) {
    candidates.push(...payload.data.ratings);
  }

  if (Array.isArray(payload.data)) {
    candidates.push(...payload.data);
  }

  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;

    const code =
      item.code ||
      item.source ||
      item.name ||
      item.provider ||
      item.key;

    const source = normalizePmdbSource(code, type);
    if (!source) continue;

    const value = normalizePmdbValue(
      code,
      item.value ?? item.rating ?? item.score ?? item.percent
    );

    if (!value) continue;
    if (seen.has(source)) continue;

    seen.add(source);
    out.push({ source, value });
  }

  return out;
}

module.exports = {
  normalizePmdbSource,
  normalizePmdbValue,
  extractPmdbRatings,
};
