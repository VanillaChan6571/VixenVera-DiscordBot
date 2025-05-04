// Configuration loader utility (CommonJS Compatible)
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Load YAML configuration file with environment variable support
 * @param {string} configPath - Path to configuration file relative to config directory
 * @param {boolean} allowEnvOverride - Whether to allow environment variables to override config values
 * @returns {object} - Parsed configuration object
 */
function loadConfig(configPath, allowEnvOverride = true) {
    try {
        // Calculate absolute path to config file
        const configDir = path.resolve(__dirname, '../config');
        const fullPath = path.resolve(configDir, configPath);

        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            console.warn(`Configuration file not found: ${fullPath}`);
            console.warn('Using default configuration');
            return {};
        }

        // Read and parse YAML - using synchronous method
        const fileContents = fs.readFileSync(fullPath, 'utf8');
        let config = yaml.load(fileContents);

        // If env override is enabled, check for environment variables
        if (allowEnvOverride) {
            config = overrideFromEnv(config);
        }

        return config;
    } catch (error) {
        console.error(`Failed to load configuration file ${configPath}:`, error);
        // Return empty config as fallback
        return {};
    }
}

/**
 * Override configuration values from environment variables
 * Environment variables should be in the format CONFIG_SECTION_KEY
 * @param {object} config - Original configuration object
 * @returns {object} - Configuration with environment overrides
 */
function overrideFromEnv(config) {
    // Create a deep copy to avoid modifying the original
    let result = JSON.parse(JSON.stringify(config || {}));

    // For Express config specifically
    if (process.env.HTTP_PORT) {
        result.port = parseInt(process.env.HTTP_PORT, 10);
    }

    if (process.env.PUBLIC_URL) {
        result.public_url = process.env.PUBLIC_URL;
    }

    // More general approach for nested configs
    Object.keys(process.env).forEach(key => {
        // Check if this looks like a configuration override
        if (key.startsWith('CONFIG_')) {
            const parts = key.toLowerCase().split('_');
            if (parts.length >= 3) {
                // Remove 'CONFIG' prefix
                parts.shift();

                // The last part is the actual key
                const configKey = parts.pop();

                // Build the nested path
                let current = result;
                for (const section of parts) {
                    if (!current[section]) {
                        current[section] = {};
                    }
                    current = current[section];
                }

                // Set the value (convert to appropriate type)
                const value = process.env[key];
                current[configKey] = convertValueType(value);
            }
        }
    });

    return result;
}

/**
 * Convert string value to appropriate type
 * @param {string} value - Value to convert
 * @returns {any} - Converted value
 */
function convertValueType(value) {
    // Boolean conversion
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Number conversion
    if (!isNaN(value) && value.trim() !== '') {
        // Check if it's an integer or float
        return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
    }

    // Array conversion (comma-separated)
    if (value.includes(',')) {
        return value.split(',').map(item => item.trim());
    }

    // Default: return as string
    return value;
}

module.exports = { loadConfig };