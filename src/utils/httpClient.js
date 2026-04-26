const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

const instance = axios.create({
    timeout: config.http.requestTimeoutMs || 10000,
    headers: {
        'User-Agent': config.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
    },
    validateStatus: function (status) {
        return status >= 200 && status < 600;
    },
});


async function getPage(url, providerName, requestConfig = {}) {
    try {
        logger.debug(`[${providerName}] HTTP GET: ${url}`);
        const response = await instance.get(url, requestConfig);

        if (response.status !== 200) {
            if (response.status === 404) {
                logger.debug(`[${providerName}] HTTP GET failed: ${response.status} Not Found - ${url}`);
            } else {
                logger.warn(`[${providerName}] HTTP GET failed: ${response.status} ${response.statusText} - ${url}`);
            }
        }

        return response;
    } catch (error) {
        logger.error(`[${providerName}] Network Error for ${url}: ${error.message}`);
        return null;
    }
}

module.exports = {
    getPage,
    axiosInstance: instance,
};
