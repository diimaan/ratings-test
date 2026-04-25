function formatTitleForUrlSlug(title) {
    if (!title) return '';

    return String(title)
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[:_/()[\]&@!$%^*+=?.,";]+/g, '-')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

module.exports = {
    formatTitleForUrlSlug,
};
