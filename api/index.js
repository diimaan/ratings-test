// Load environment variables first
require('dotenv').config();
// Add this before any other imports
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const express = require('express');
const logger = require('../src/utils/logger'); // Adjust path relative to api/index.js
const redisClient = require('../src/cache/redisClient'); // Adjust path
const configApiRoutes = require('../src/routes/configApiRoutes');
const stremioConfigRoutes = require('../src/routes/stremioConfigRoutes');
const jsonErrorHandler = require('../src/middleware/jsonErrorHandler');

let app; // Keep app instance reference

async function initializeApp() {
    if (app) return app; // Return cached app if already initialized

    logger.info('Initializing addon server for Vercel...');

    // Initialize Redis connection
    try {
        await redisClient.connect();
        if (!redisClient.isReady()) {
            logger.warn('Redis connection failed or not ready. Addon will run WITHOUT caching.');
        } else {
            logger.info('Redis connection successful.');
        }
    } catch (redisError) {
        logger.error('Error connecting to Redis during initialization:', redisError);
        // Continue without cache
    }


    // Create Express app
    app = express();
    app.set('trust proxy', true);
    app.use(express.json({ limit: '64kb' }));

    // Serve static files for /configure route (handled by vercel.json rewrites)
    // Vercel will serve the 'frontend/dist' directory directly based on vercel.json
    // No need for app.use('/configure', express.static(...)) here for Vercel.
    // We still need the redirect from '/'
    app.get('/', (_req, res) => {
        // Redirect to the configure page (frontend handles the actual rendering)
        res.redirect('/configure');
    });

    app.use(configApiRoutes);
    app.use(stremioConfigRoutes);
    app.use(jsonErrorHandler);
    logger.info('Routes mounted for Vercel.');

    // DO NOT CALL app.listen() HERE - Vercel handles this.

    return app;
}

// Graceful shutdown handler for Vercel (optional but good practice)
const cleanup = async () => {
    logger.warn('Serverless function instance shutting down...');
    await redisClient.disconnect();
    logger.info('Redis disconnected during cleanup.');
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);


// Export a default function that initializes and returns the app
// Vercel will call this function for each request to the serverless endpoint
export default async function handler(req, res) {
    try {
        const initializedApp = await initializeApp();
        // Let the Express app handle the request
        initializedApp(req, res);
    } catch (error) {
        logger.error('Error handling request in Vercel function:', error);
        res.status(500).send('Internal Server Error');
    }
}

// Optional: If you need to run cleanup after the response is sent
// This might be necessary if redisClient.disconnect() is slow.
// export const config = {
//   api: {
//     bodyParser: false, // Let Express handle body parsing if needed
//     externalResolver: true, // Use if you need fine-grained control over response ending
//   },
// };
