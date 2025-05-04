// Core leveling system functionality
const fs = require('fs');
const config = require('./config');

// Database management
class LevelingDB {
    constructor() {
        this.data = { users: {} };
        this.load();
    }

    // Load database from file
    load() {
        try {
            const rawData = fs.readFileSync(config.database.path, 'utf8');
            this.data = JSON.parse(rawData);
            console.log('Loaded leveling database');
        } catch (err) {
            console.log('No existing database found, creating new one');
            this.save(); // Create a new file
        }
    }

    // Save database to file
    save() {
        try {
            fs.writeFileSync(config.database.path, JSON.stringify(this.data, null, 2));
            return true;
        } catch (err) {
            console.error('Error saving database:', err);
            return false;
        }
    }

    // Initialize user if they don't exist
    ensureUser(userId) {
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                xp: 0,
                level: 0,
                lastMessage: 0,
                // Store when they first started earning XP for potential "account age" features
                firstSeen: Date.now()
            };
        }
        return this.data.users[userId];
    }

    // Get a user's data
    getUser(userId) {
        return this.ensureUser(userId);
    }

    // Update a user's XP and level
    addXP(userId, xpAmount) {
        const userData = this.ensureUser(userId);
        const oldLevel = userData.level;

        // Add XP
        userData.xp += xpAmount;
        userData.lastMessage = Date.now();

        // Calculate new level
        const newLevel = this.calculateLevel(userData.xp);
        const leveledUp = newLevel > oldLevel;

        // Update level if needed
        if (leveledUp) {
            userData.level = newLevel;
        }

        // Save changes
        this.save();

        return {
            leveledUp,
            oldLevel,
            newLevel,
            currentXP: userData.xp,
            xpToNextLevel: this.xpForLevel(newLevel + 1) - userData.xp
        };
    }

    // Get sorted leaderboard
    getLeaderboard(page = 1, pageSize = config.leaderboard.pageSize) {
        const userEntries = Object.entries(this.data.users);
        const sortedUsers = userEntries.sort((a, b) => b[1].xp - a[1].xp);

        const startIndex = (page - 1) * pageSize;
        const pageUsers = sortedUsers.slice(startIndex, startIndex + pageSize);
        const totalPages = Math.ceil(sortedUsers.length / pageSize);

        return {
            users: pageUsers,
            currentPage: page,
            totalPages,
            totalUsers: sortedUsers.length
        };
    }

    // Get a user's rank position
    getUserRank(userId) {
        const userEntries = Object.entries(this.data.users);
        const sortedUsers = userEntries.sort((a, b) => b[1].xp - a[1].xp);

        const position = sortedUsers.findIndex(entry => entry[0] === userId);
        return position !== -1 ? position + 1 : null; // 1-based position
    }

    // Calculate required XP for a specific level
    xpForLevel(level) {
        return config.xp.baseXP * Math.pow(level, config.xp.curve);
    }

    // Calculate level from XP
    calculateLevel(xp) {
        let level = 0;
        while (xp >= this.xpForLevel(level + 1)) {
            level++;
        }
        return level;
    }
}

// Cooldown management
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
    LevelingDB,
    XPCooldownManager,
    createProgressBar,
    generateXP
};