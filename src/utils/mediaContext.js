function parseMediaContext(type, id) {
  if (!id) return null;

  const baseId = id.split(':')[0];

  // 🎯 Detect episode pattern (Stremio format)
  // Example: tt1234567:1:2 → S1E2
  const parts = id.split(':');

  if (parts.length === 3) {
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);

    if (!isNaN(season) && !isNaN(episode)) {
      return {
        imdbId: baseId,
        season,
        episode,
        isEpisode: true,
      };
    }
  }

  // 🎬 Normal movie/series
  return {
    imdbId: baseId,
    season: null,
    episode: null,
    isEpisode: false,
  };
}

module.exports = {
  parseMediaContext,
};
