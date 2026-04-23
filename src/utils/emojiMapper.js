function getCompactLabel(source) {
    const map = {
        'IMDb (Movie)': '🎬 IMDb',
        'IMDb (Show)': '📺 IMDb',
        'IMDb (Episode)': '📺 IMDb Ep',
        'TMDb (Movie)': '🎬 TMDb',
        'TMDb (Show)': '📺 TMDb',
        'TMDb (Episode)': '📺 TMDb Ep',
        'MDBList': '🧠 MDB',
        'MC': 'Ⓜ️ MC',
        'RT': '🍅 RT',
        'PC': '🍿 PC',
        'Trakt': '🔴 Trakt',
        'MAL': '🌸 MAL',
        'Letterboxd': '🎥 LB',
        'Roger Ebert': '✍️ Ebert',
        'Common Sense': '👪 CSM',
        'Not Safe': '⚠️ Not Safe',
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
        'MC': 'Ⓜ️ MC',
        'RT': '🍅 RT',
        'PC': '🍿 PC',
        'Trakt': '🔴 Trakt',
        'MAL': '🌸 MAL',
        'Letterboxd': '🎥 Letterboxd',
        'Roger Ebert': '✍️ Roger Ebert',
        'Common Sense': '👪 Common Sense',
        'Not Safe': '⚠️ Not Safe',
        'Sexual Violence': '💔 Sexual Violence',
        'Sex & Nudity': '🫣 Sex & Nudity',
    };

    return map[source] || `⭐ ${source}`;
}

module.exports = {
    getCompactLabel,
    getFullLabel,
};