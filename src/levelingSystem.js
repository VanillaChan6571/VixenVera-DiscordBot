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

module.exports = {
    LevelingDB: LevelingDatabase,
    XPCooldownManager,
    createProgressBar,
    generateXP
};