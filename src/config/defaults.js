const DEFAULT_HTTP_TIMEOUT_MS = 12000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const DEFAULT_ENABLED_RATINGS = [
    'Content Safety',
    'IMDb (Movie)',
    'IMDb (Show)',
    'IMDb (Episode)',
    'TMDb (Movie)',
    'TMDb (Show)',
    'TMDb (Episode)',
    'MC',
    'RT',
    'PC',
    'Trakt',
    'MAL',
    'Letterboxd',
    'Roger Ebert',
];

const DEFAULT_RATINGS_ORDER = [
    'Content Safety',
    'IMDb (Episode)',
    'IMDb (Show)',
    'IMDb (Movie)',
    'TMDb (Episode)',
    'TMDb (Show)',
    'TMDb (Movie)',
    'MAL',
    'Letterboxd',
    'MC',
    'RT',
    'PC',
    'Trakt',
    'Roger Ebert',
];

module.exports = {
    DEFAULT_HTTP_TIMEOUT_MS,
    DEFAULT_USER_AGENT,
    DEFAULT_ENABLED_RATINGS,
    DEFAULT_RATINGS_ORDER,
};
