function getCompactLabel(source) {
    const map = {
        'IMDb (Movie)': '🎬 IMDb',
        'IMDb (Show)': '📺 IMDb',
        'IMDb (Episode)': '📺 IMDb Ep',
        'TMDb (Movie)': '🎬 TMDb',
        'TMDb (Show)': '📺 TMDb',
        'TMDb (Episode)': '📺 TMDb Ep',
        'MDBList': '🧠 MDB',
        'Metacritic': 'Ⓜ️ Metacritic',
        'MC': 'Ⓜ️ Metacritic',
        'Rotten Tomatoes': '🍅 Rotten Tomatoes',
        'RT': '🍅 Rotten Tomatoes',
        'Popcornmeter': '🍿 Popcornmeter',
        'PC': '🍿 Popcornmeter',
        'Trakt': '🔴 Trakt',
        'MyAnimeList': '🌸 MyAnimeList',
        'MAL': '🌸 MyAnimeList',
        'Letterboxd': '🎥 LB',
        'Roger Ebert': '✍️ Ebert',
        'Common Sense': '👪 CSM',
        'Parent Safe': '✅ Parent Safe',
        'Not Safe': '⚠️ Not Parent Safe',
        'Sexual Violence': '💔 Sexual Violence',
        'Sex & Nudity': '🫣 Sex & Nudity',
    };

    return map[source] || source;
}

function getFullLabel(source) {
    const map = {
        'IMDb (Movie)': '🎬 IMDb (Movie)',
        'IMDb (Show)': '📺 IMDb (Show)',
        'IMDb (Episode)': '📺 IMDb (Episode)',
        'TMDb (Movie)': '🎬 TMDb (Movie)',
        'TMDb (Show)': '📺 TMDb (Show)',
        'TMDb (Episode)': '📺 TMDb (Episode)',
        'MDBList': '🧠 MDBList',
        'Metacritic': 'Ⓜ️ Metacritic',
        'MC': 'Ⓜ️ Metacritic',
        'Rotten Tomatoes': '🍅 Rotten Tomatoes',
        'RT': '🍅 Rotten Tomatoes',
        'Popcornmeter': '🍿 Popcornmeter',
        'PC': '🍿 Popcornmeter',
        'Trakt': '🔴 Trakt',
        'MyAnimeList': '🌸 MyAnimeList',
        'MAL': '🌸 MyAnimeList',
        'Letterboxd': '🎥 Letterboxd',
        'Roger Ebert': '✍️ Roger Ebert',
        'Common Sense': '👪 Common Sense',
        'Parent Safe': '✅ Parent Safe',
        'Not Safe': '⚠️ Not Parent Safe',
        'Sexual Violence': '💔 Sexual Violence',
        'Sex & Nudity': '🫣 Sex & Nudity',
    };

    return map[source] || `⭐ ${source}`;
}

function getWarningLabel(source) {
    const warningLabels = {
        'Parent Safe': '✅ Certified Parent Safe',
        'Not Safe': '⚠️ Not Parent Safe',
        'Sexual Violence': '💔 Sexual Violence',
        'Sex & Nudity': '🫣 Sex & Nudity',
        'Violence & Scariness': '🔪 Violence & Scariness',
        'Language': '🗣️ Language',
        'Drugs Usage': '💊 Drugs Usage',
    };

    return warningLabels[source] || getFullLabel(source);
}

module.exports = {
    getCompactLabel,
    getFullLabel,
    getWarningLabel,
};
