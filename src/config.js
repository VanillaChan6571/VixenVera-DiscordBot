// Leveling Bot Configuration Options
require('dotenv').config();
const path = require('path');

module.exports = {
    // Bot configuration
    bot: {
        token: process.env.BOT_TOKEN,
        clientId: process.env.CLIENT_ID,
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
            path: path.join(__dirname, process.env.DB_FILENAME || 'leveling.db'),

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
        baseXP: 100,     // Base XP required for level 1

        // The formula for calculating XP needed for a level is:
        // baseXP * level^curve
        // Higher curve = exponentially more difficult higher levels
        curve: 1.5,

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