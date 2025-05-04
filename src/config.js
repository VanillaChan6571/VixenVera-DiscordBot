// Leveling Bot Configuration Options
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');

// For debugging
console.log('Environment variables loaded:');
console.log('BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('CLIENT_ID exists:', !!process.env.CLIENT_ID);
console.log('DB_FILENAME:', process.env.DB_FILENAME);

module.exports = {
    // Bot configuration
    bot: {
        token: process.env.BOT_TOKEN,
        clientId: process.env.CLIENT_ID,
        ownerId: "233055065588367370", // Set the owner ID here
        activity: {
            name: 'levels increasing',
            type: 'Watching' // Playing, Streaming, Listening, Watching, Competing
        }
    },

    // Database configuration
    database: {
        // Database type: 'sqlite'
        type: 'sqlite',

        // SQLite configuration
        sqlite: {
            filename: process.env.DB_FILENAME || 'leveling.db',
            // Store in data directory at project root
            path: path.resolve(__dirname, '../data', process.env.DB_FILENAME || 'leveling.db'),

            // How often to commit changes to disk (ms)
            saveInterval: 10000, // 10 seconds

            // Pragmas for performance tuning
            pragmas: {
                // Performance optimizations
                'journal_mode': 'WAL',       // Write-ahead logging for better concurrency
                'synchronous': 'NORMAL',     // Sync less often for better performance
                'cache_size': -64000,        // 64MB cache (negative means KB)
                'foreign_keys': 'ON',        // Enforce foreign key constraints
                'temp_store': 'MEMORY'       // Store temp tables in memory
            }
        }
    },

    // XP system configuration
    xp: {
        cooldown: 60000, // Cooldown in milliseconds between XP rewards (default: 1 minute)
        min: 15,         // Minimum XP per message
        max: 25,         // Maximum XP per message
        baseXP: 100,     // Base XP required for level 1 (used for formula fallback)

        // The formula for calculating XP needed for a level is:
        // baseXP * level^curve
        // Higher curve = exponentially more difficult higher levels
        curve: 1.5,

        // Maximum level - users can't go beyond this
        maxLevel: 100,

        // CUSTOM XP REQUIREMENTS
        // Set custom XP thresholds for specific levels
        // Format: { level: required_total_xp }
        customLevelThresholds: {
            1: 5,          // Level 1 requires 5 XP
            10: 1000,      // Level 10 requires 1,000 XP
            20: 5000,      // Level 20 requires 5,000 XP
            50: 10000,     // Level 50 requires 10,000 XP
            100: 30000,    // Level 100 requires 30,000 XP
        },

        // Whether to use custom thresholds or formula
        useCustomThresholds: true,

        // Whether to interpolate XP for levels not explicitly defined
        // If true, levels between defined thresholds will be calculated with linear interpolation
        // If false, levels not defined will use the formula
        interpolateXP: true,

        // Sacrifice system
        sacrifice: {
            enabled: true,
            // Role ID given to users who have sacrificed (leave empty if none)
            sacrificeRoleId: "",  // Add a role ID if you want to give a special role
            // The number of times a user has sacrificed is tracked in the database
        },

        // Level up notification options
        levelUp: {
            enabled: true,          // Whether to send level up messages
            channelOverride: null,  // Set to a channel ID to send level ups to a specific channel, or null for same channel
            dm: false,              // Whether to send level up messages via DM instead of in the channel
            pingUser: true,         // Whether to ping the user in level up messages

            // Custom level rewards (role IDs assigned at specific levels)
            // Format: { level: "roleId" }
            rewards: {
                // Example: 5: "12345678901234567890", // Level 5 gets role ID 123456789...
            }
        }
    },

    // Leaderboard configuration
    leaderboard: {
        pageSize: 10,         // Number of users per leaderboard page
        showGlobalRank: true, // Show user's global rank position in /level command
    },

    // Progress bar configuration
    progressBar: {
        length: 10,     // Length of the progress bar
        filled: '█',    // Character for filled portion
        empty: '░',     // Character for empty portion
    }
};