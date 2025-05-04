// Express server for serving UGC files
const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./utils/configLoader');

// Initialize the Express server for UGC serving
function initializeUGCServer() {
    // Load Express configuration
    const defaultConfig = {
        port: 3000,
        public_url: 'http://localhost:3000',
        content: {
            ugc_dir: '../data/ugc',
            ugc_path: '/ugc'
        },
        security: {
            max_upload_size: 8,
            allowed_mime_types: [
                'image/jpeg',
                'image/png',
                'image/gif',
                'image/webp'
            ]
        }
    };

    // Load config from file with environment variable overrides
    let expressConfig;
    try {
        expressConfig = loadConfig('express.yml');
        console.log('Loaded Express configuration from YAML file');
    } catch (error) {
        console.warn('Could not load Express configuration from file:', error.message);
        console.warn('Using default configuration');
        expressConfig = {};
    }

    // Merge with defaults
    const config = { ...defaultConfig, ...expressConfig };

    // Extract configuration values
    const PORT = config.port;
    const BASE_URL = config.public_url;
    const UGC_DIR = path.join(__dirname, config.content.ugc_dir);
    const UGC_PATH = config.content.ugc_path;

    // Ensure UGC directory exists
    if (!fs.existsSync(UGC_DIR)) {
        fs.mkdirSync(UGC_DIR, { recursive: true });
        console.log(`Created UGC directory: ${UGC_DIR}`);
    }

    // Create Express app
    const app = express();

    // Serve static files from the UGC directory
    app.use(UGC_PATH, express.static(UGC_DIR));

    // Add a simple status endpoint
    app.get('/status', (req, res) => {
        res.status(200).json({
            status: 'ok',
            message: 'UGC server is running',
            config: {
                port: PORT,
                public_url: BASE_URL,
                ugc_path: UGC_PATH
            }
        });
    });

    // Start the server
    app.listen(PORT, () => {
        console.log(`UGC server running on port ${PORT}`);
        console.log(`UGC files available at ${BASE_URL}${UGC_PATH}/`);
    });

    // Return base URL for use in other parts of the application
    return BASE_URL;
}

module.exports = {
    initializeUGCServer
};