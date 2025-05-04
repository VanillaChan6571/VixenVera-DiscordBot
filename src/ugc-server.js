// Express server for serving UGC files (CommonJS Compatible)
const express = require('express');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Initialize the Express server for UGC serving
function initializeUGCServer() {
    // Default config
    const defaultConfig = {
        port: 3000,
        public_url: 'http://localhost:3000',
        content: {
            ugc_dir: '../ugc',
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

    // Load config from file - using synchronous methods to avoid top-level await
    let expressConfig = {};
    try {
        const configPath = path.resolve(__dirname, 'config/express.yml');
        if (fs.existsSync(configPath)) {
            const fileContents = fs.readFileSync(configPath, 'utf8');
            expressConfig = yaml.load(fileContents);
            console.log('Loaded Express configuration from YAML file');
        } else {
            console.warn('Express config file not found:', configPath);
            console.warn('Using default configuration');
        }
    } catch (error) {
        console.warn('Could not load Express configuration from file:', error.message);
        console.warn('Using default configuration');
    }

    // Merge with defaults
    const config = { ...defaultConfig, ...expressConfig };

    // Extract configuration values
    const PORT = process.env.UGC_PORT || config.port;
    const BASE_URL = process.env.UGC_URL || config.public_url;
    const UGC_DIR = path.resolve(__dirname, '..', 'ugc');
    const UGC_PATH = config.content.ugc_path;

    console.log('UGC Directory Path:', UGC_DIR);

    // Ensure UGC directory structure exists
    if (!fs.existsSync(UGC_DIR)) {
        fs.mkdirSync(UGC_DIR, { recursive: true });
        console.log(`Created UGC directory: ${UGC_DIR}`);
    }

    // Create subdirectories for different content types
    const contentTypes = ['avatars', 'banners', 'test'];
    for (const type of contentTypes) {
        const typePath = path.join(UGC_DIR, type);
        if (!fs.existsSync(typePath)) {
            fs.mkdirSync(typePath, { recursive: true });
            console.log(`Created ${type} directory: ${typePath}`);
        }
    }

    // Create a test file to verify serving works
    const testFilePath = path.join(UGC_DIR, 'test', 'test.txt');
    fs.writeFileSync(testFilePath, 'UGC Server Test File');
    console.log(`Created test file at: ${testFilePath}`);

    // Log directory contents for debugging
    console.log('UGC directory contents:');
    try {
        const dirContents = fs.readdirSync(UGC_DIR);
        console.log(dirContents);

        // Check subdirectories too
        for (const item of dirContents) {
            const itemPath = path.join(UGC_DIR, item);
            if (fs.statSync(itemPath).isDirectory()) {
                console.log(`Contents of ${item}:`, fs.readdirSync(itemPath));
            }
        }
    } catch (e) {
        console.error('Error reading UGC directory:', e);
    }

    // Create Express app
    const app = express();

    // Add CORS headers for development
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        next();
    });

    // Serve static files from the UGC directory with detailed options
    app.use(UGC_PATH, express.static(UGC_DIR, {
        index: false,
        fallthrough: true,
        redirect: false
    }));

    // Add a directory listing endpoint for debugging
    app.get('/ugc-debug', (req, res) => {
        try {
            const dirContents = fs.readdirSync(UGC_DIR);
            const result = {
                ugc_dir: UGC_DIR,
                contents: dirContents,
                subdirectories: {}
            };

            // Include contents of subdirectories
            for (const item of dirContents) {
                const itemPath = path.join(UGC_DIR, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    result.subdirectories[item] = fs.readdirSync(itemPath);
                }
            }

            res.json(result);
        } catch (error) {
            res.status(500).json({
                error: 'Error reading directory',
                message: error.message
            });
        }
    });

    // Add a simple status endpoint
    app.get('/status', (req, res) => {
        res.status(200).json({
            status: 'ok',
            message: 'UGC server is running',
            config: {
                port: PORT,
                public_url: BASE_URL,
                ugc_path: UGC_PATH,
                ugc_dir: UGC_DIR
            }
        });
    });

    // Start the server
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`UGC server running on port ${PORT}`);
        console.log(`UGC files available at ${BASE_URL}${UGC_PATH}/`);
        console.log(`Status endpoint: ${BASE_URL}/status`);
        console.log(`Debug endpoint: ${BASE_URL}/ugc-debug`);
    });

    // Return base URL for use in other parts of the application
    return BASE_URL;
}

module.exports = {
    initializeUGCServer
};