const logger = require('../utils/logger');

function jsonErrorHandler(err, _req, res, next) {
    void next;

    const statusCode = err.statusCode || err.status || 500;

    if (statusCode >= 500) {
        logger.error('Unhandled request error:', err);
    }

    res.status(statusCode).json({
        error: statusCode >= 500 ? 'Internal Server Error' : err.message,
    });
}

module.exports = jsonErrorHandler;
