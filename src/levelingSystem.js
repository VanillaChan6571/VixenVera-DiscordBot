// Core leveling system functionality
const config = require('./config');
const LevelingDatabase = require('./database');

// XP Cooldown management
class XPCooldownManager {
    constructor() {
        this.cooldowns = new Map();
    }

    // Check if a user is on cooldown
    isOnCooldown(userId) {
        if (!this.cooldowns.has(userId)) return false;

        const expirationTime = this.cooldowns.get(userId);
        return Date.now() < expirationTime;
    }

    // Set cooldown for a user
    setCooldown(userId) {
        this.cooldowns.set(userId, Date.now() + config.xp.cooldown);
    }

    // Get time remaining on cooldown in ms
    getRemainingCooldown(userId) {
        if (!this.cooldowns.has(userId)) return 0;

        const expirationTime = this.cooldowns.get(userId);
        const remaining = expirationTime - Date.now();
        return remaining > 0 ? remaining : 0;
    }
}

// Helper function to create a visual progress bar
function createProgressBar(percentage) {
    const { length, filled, empty } = config.progressBar;
    const filledLength = Math.round((percentage / 100) * length);

    let bar = filled.repeat(filledLength);
    bar += empty.repeat(length - filledLength);

    return `[${bar}]`;
}

// Generate random XP amount
function generateXP() {
    return Math.floor(Math.random() * (config.xp.max - config.xp.min + 1)) + config.xp.min;
}

// Helper function to check guild settings for user content permissions
function isUserContentAllowed(db, feature, guildId) {
    try {
        // First check if the feature is set to guild-only mode
        const guildOnly = db.getGuildSetting(guildId, `guild_only_${feature}`, false);
        if (guildOnly) {
            return false;
        }

        // Then check if the feature is toggled on/off
        return db.getGuildSetting(guildId, `allow_user_${feature}`, true);
    } catch (error) {
        console.error(`Error checking user content permissions for ${feature}:`, error);
        return true; // Default to allowed if there's an error
    }
}

// Helper function to get guild default content for a feature
function getGuildDefaultContent(db, type, guildId) {
    try {
        return db.getGuildSetting(guildId, `default_${type}_url`, null);
    } catch (error) {
        console.error(`Error getting guild default content for ${type}:`, error);
        return null;
    }
}

module.exports = {
    LevelingDB: LevelingDatabase,
    XPCooldownManager,
    createProgressBar,
    generateXP,
    isUserContentAllowed,
    getGuildDefaultContent
};