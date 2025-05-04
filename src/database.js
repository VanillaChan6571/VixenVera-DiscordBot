// SQLite database implementation for the leveling system
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class LevelingDatabase {
    constructor() {
        this.config = config.database.sqlite;
        this.db = null;
        this.saveInterval = null;

        // Initialize the database
        this.initialize();
    }

    // Initialize the database connection and tables
    initialize() {
        try {
            // Make sure we have a valid path
            if (!this.config.path) {
                throw new Error('Database path is undefined. Check your configuration and .env file.');
            }

            // Log the database path for debugging
            console.log('Database path:', this.config.path);

            // Create directory if it doesn't exist
            const dbDir = path.dirname(this.config.path);
            if (!fs.existsSync(dbDir)) {
                console.log(`Creating database directory: ${dbDir}`);
                fs.mkdirSync(dbDir, {recursive: true});
            }

            // Connect to the database
            this.db = new Database(this.config.path);

            // Set up pragmas for performance
            this.setupPragmas();

            // Create tables if they don't exist
            this.createTables();

            // Setup auto-save interval for WAL mode
            this.setupAutoSave();

            console.log(`Connected to SQLite database: ${this.config.path}`);
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error; // Re-throw to make the error visible
        }
    }

    // Set up performance pragmas
    setupPragmas() {
        try {
            // Apply all configured pragmas individually
            // No need for begin/commit as these are direct pragma settings
            for (const [key, value] of Object.entries(this.config.pragmas)) {
                this.db.pragma(`${key} = ${value}`);
            }

            console.log('Database pragmas configured for optimal performance');
        } catch (error) {
            console.error('Error setting up pragmas:', error);
            throw error;
        }
    }

    // Create necessary tables
    createTables() {
        try {
            // Create users table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users
                (
                    user_id
                    TEXT
                    PRIMARY
                    KEY,
                    xp
                    INTEGER
                    NOT
                    NULL
                    DEFAULT
                    0,
                    level
                    INTEGER
                    NOT
                    NULL
                    DEFAULT
                    0,
                    last_message
                    INTEGER
                    NOT
                    NULL
                    DEFAULT
                    0,
                    first_seen
                    INTEGER
                    NOT
                    NULL
                    DEFAULT
                    0,
                    guild_id
                    TEXT
                    NOT
                    NULL
                    DEFAULT
                    'global',
                    sacrifices
                    INTEGER
                    NOT
                    NULL
                    DEFAULT
                    0,
                    sacrifice_pending
                    INTEGER
                    NOT
                    NULL
                    DEFAULT
                    0
                );

                CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);
                CREATE INDEX IF NOT EXISTS idx_users_level ON users(level DESC);
                CREATE INDEX IF NOT EXISTS idx_users_guild ON users(guild_id);
            `);

            // Create statistics table for future expansion
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS statistics
                (
                    key
                    TEXT
                    PRIMARY
                    KEY,
                    value
                    TEXT
                    NOT
                    NULL
                );
            `);

            console.log('Database tables initialized');
        } catch (error) {
            console.error('Error creating tables:', error);
            throw error;
        }
    }

    // Set up an interval to checkpoint the WAL file
    setupAutoSave() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }

        this.saveInterval = setInterval(() => {
            try {
                // Checkpoint the WAL file to ensure data is saved to the main database file
                this.db.pragma('wal_checkpoint(PASSIVE)');
            } catch (error) {
                console.error('Error during automatic database checkpoint:', error);
            }
        }, this.config.saveInterval);

        console.log(`Automatic database checkpoint set up (every ${this.config.saveInterval / 1000}s)`);
    }

    // Close database connection
    close() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }

        if (this.db) {
            try {
                // Final checkpoint
                this.db.pragma('wal_checkpoint(FULL)');
                this.db.close();
                this.db = null;
                console.log('Database connection closed');
            } catch (error) {
                console.error('Error closing database:', error);
            }
        }
    }

    // Ensure a user exists in the database
    ensureUser(userId, guildId = 'global') {
        const now = Date.now();

        try {
            // Prepare statements for better performance
            const getUserStmt = this.db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id = ?');
            const insertUserStmt = this.db.prepare(`
                INSERT INTO users (user_id, xp, level, last_message, first_seen, guild_id)
                VALUES (?, 0, 0, ?, ?, ?)
            `);

            // Begin transaction
            const transaction = this.db.transaction(() => {
                // Check if user exists
                const user = getUserStmt.get(userId, guildId);

                // If not, create them
                if (!user) {
                    insertUserStmt.run(userId, now, now, guildId);
                }

                // Return the user (either existing or new)
                return getUserStmt.get(userId, guildId);
            });

            // Execute transaction
            return transaction();
        } catch (error) {
            console.error('Error ensuring user exists:', error);
            throw error;
        }
    }

    // Get a user's data
    getUser(userId, guildId = 'global') {
        try {
            return this.ensureUser(userId, guildId);
        } catch (error) {
            console.error('Error getting user:', error);
            throw error;
        }
    }

    // Add XP to user and update level
    addXP(userId, xpAmount, guildId = 'global') {
        try {
            // Ensure the user exists first
            this.ensureUser(userId, guildId);

            const now = Date.now();

            // Prepare statements
            const updateXPStmt = this.db.prepare(`
                UPDATE users
                SET xp           = xp + ?,
                    last_message = ?
                WHERE user_id = ?
                  AND guild_id = ?
            `);

            const getUserStmt = this.db.prepare(`
                SELECT *
                FROM users
                WHERE user_id = ?
                  AND guild_id = ?
            `);

            const updateLevelStmt = this.db.prepare(`
                UPDATE users
                SET level = ?
                WHERE user_id = ?
                  AND guild_id = ?
            `);

            // Execute transaction for atomic operations
            const transaction = this.db.transaction(() => {
                // Add XP
                updateXPStmt.run(xpAmount, now, userId, guildId);

                // Get updated user data
                const userData = getUserStmt.get(userId, guildId);

                // Calculate new level
                const oldLevel = userData.level;
                const newLevel = this.calculateLevel(userData.xp);

                // Update level if it changed
                if (newLevel > oldLevel) {
                    updateLevelStmt.run(newLevel, userId, guildId);
                    userData.level = newLevel;
                }

                return {
                    leveledUp: newLevel > oldLevel,
                    oldLevel,
                    newLevel,
                    currentXP: userData.xp,
                    xpToNextLevel: this.xpForLevel(newLevel + 1) - userData.xp
                };
            });

            // Run the transaction
            return transaction();
        } catch (error) {
            console.error('Error adding XP:', error);
            throw error;
        }
    }

    // Get leaderboard data
    getLeaderboard(page = 1, pageSize = config.leaderboard.pageSize, guildId = 'global') {
        try {
            const offset = (page - 1) * pageSize;

            // Get users for this page
            const getUsersStmt = this.db.prepare(`
                SELECT user_id, xp, level
                FROM users
                WHERE guild_id = ?
                ORDER BY xp DESC LIMIT ?
                OFFSET ?
            `);

            // Count total users
            const countUsersStmt = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM users
                WHERE guild_id = ?
            `);

            // Get users
            const users = getUsersStmt.all(guildId, pageSize, offset);

            // Convert to the expected format (compatible with previous JSON format)
            const formattedUsers = users.map(user => [
                user.user_id,
                {xp: user.xp, level: user.level}
            ]);

            // Get total count
            const {count} = countUsersStmt.get(guildId);
            const totalPages = Math.ceil(count / pageSize);

            return {
                users: formattedUsers,
                currentPage: page,
                totalPages,
                totalUsers: count
            };
        } catch (error) {
            console.error('Error getting leaderboard:', error);
            throw error;
        }
    }

    // Get user's rank position
    getUserRank(userId, guildId = 'global') {
        try {
            // Make sure user exists
            this.ensureUser(userId, guildId);

            // Get rank
            const getRankStmt = this.db.prepare(`
                SELECT (SELECT COUNT(*)
                        FROM users
                        WHERE guild_id = ?
                          AND xp > (SELECT xp
                                    FROM users
                                    WHERE user_id = ?
                                      AND guild_id = ?)) + 1 as rank
            `);

            const {rank} = getRankStmt.get(guildId, userId, guildId);
            return rank;
        } catch (error) {
            console.error('Error getting user rank:', error);
            throw error;
        }
    }

    xpForLevel(level) {
        // Make sure level is within bounds
        const maxLevel = config.xp.maxLevel || 100;
        if (level > maxLevel) {
            level = maxLevel;
        }

        // Check if we're using custom thresholds
        if (config.xp.useCustomThresholds && config.xp.customLevelThresholds) {
            // If this exact level has a threshold, return it
            if (config.xp.customLevelThresholds[level] !== undefined) {
                return config.xp.customLevelThresholds[level];
            }

            // If we should interpolate between defined levels
            if (config.xp.interpolateXP) {
                // Get all defined levels
                const definedLevels = Object.keys(config.xp.customLevelThresholds)
                    .map(l => parseInt(l, 10))
                    .sort((a, b) => a - b);

                // Find the two defined levels that our target is between
                let lowerLevel = definedLevels[0];
                let upperLevel = definedLevels[definedLevels.length - 1];

                for (let i = 0; i < definedLevels.length - 1; i++) {
                    if (definedLevels[i] <= level && level <= definedLevels[i + 1]) {
                        lowerLevel = definedLevels[i];
                        upperLevel = definedLevels[i + 1];
                        break;
                    }
                }

                // If the level is below our lowest defined level
                if (level < lowerLevel) {
                    return Math.floor((level / lowerLevel) * config.xp.customLevelThresholds[lowerLevel]);
                }

                // If the level is above our highest defined level
                if (level > upperLevel) {
                    return config.xp.customLevelThresholds[upperLevel];
                }

                // Get the XP values for the bounding levels
                const lowerXP = config.xp.customLevelThresholds[lowerLevel];
                const upperXP = config.xp.customLevelThresholds[upperLevel];

                // Calculate the interpolated XP
                const levelRange = upperLevel - lowerLevel;
                const xpRange = upperXP - lowerXP;
                const levelProgress = level - lowerLevel;

                return Math.floor(lowerXP + (xpRange * levelProgress / levelRange));
            }
        }
        // Fall back to formula
        return config.xp.baseXP * Math.pow(level, config.xp.curve);
    }


// Calculate level from XP
    calculateLevel(xp) {
        const maxLevel = config.xp.maxLevel || 100;

        // If using custom thresholds
        if (config.xp.useCustomThresholds && config.xp.customLevelThresholds) {
            // Get all defined levels and their XP requirements
            const levelData = Object.entries(config.xp.customLevelThresholds)
                .map(([level, requiredXP]) => ({
                    level: parseInt(level, 10),
                    requiredXP
                }))
                .sort((a, b) => a.level - b.level); // Sort lowest to highest

            // Check if user has enough XP for each level
            let userLevel = 0;

            for (const {level, requiredXP} of levelData) {
                if (xp >= requiredXP) {
                    userLevel = level;
                } else {
                    break;
                }
            }

            // If we're interpolating and user has more XP than the lowest level
            if (config.xp.interpolateXP && levelData.length > 0 && xp >= levelData[0].requiredXP) {
                // Find the two defined levels that our XP falls between
                for (let i = 0; i < levelData.length - 1; i++) {
                    const lowerLevelData = levelData[i];
                    const upperLevelData = levelData[i + 1];

                    if (xp >= lowerLevelData.requiredXP && xp < upperLevelData.requiredXP) {
                        // Calculate the interpolated level
                        const xpRange = upperLevelData.requiredXP - lowerLevelData.requiredXP;
                        const levelRange = upperLevelData.level - lowerLevelData.level;
                        const xpProgress = xp - lowerLevelData.requiredXP;

                        // Calculate fractional level
                        const fractionalLevel = lowerLevelData.level + (levelRange * xpProgress / xpRange);

                        // Return integer level
                        return Math.floor(fractionalLevel);
                    }
                }
            }

            // Cap at max level
            return Math.min(userLevel, maxLevel);
        }

        // Fall back to formula-based calculation
        let level = 0;
        while (level < maxLevel && xp >= this.xpForLevel(level + 1)) {
            level++;
        }
        return level;
    }

// Add a new method for the sacrifice system
    async sacrificeUser(userId, guildId = 'global') {
        try {
            // Get the current user data
            const userData = this.getUser(userId, guildId);

            // Make sure user is at max level
            if (userData.level < config.xp.maxLevel) {
                return {
                    success: false,
                    message: "The fox seems to not hunger for you yet...",
                    canSacrifice: false
                };
            }

            // Check if user has already confirmed sacrifice
            if (userData.sacrifice_pending === 1) {
                // Perform the sacrifice
                const sacrificeStmt = this.db.prepare(`
                    UPDATE users
                    SET level             = 1,
                        xp                = ?,
                        sacrifices        = sacrifices + 1,
                        sacrifice_pending = 0
                    WHERE user_id = ?
                      AND guild_id = ?
                `);

                // Get the XP needed for level 1
                const level1XP = this.xpForLevel(1);

                // Execute the sacrifice
                sacrificeStmt.run(level1XP, userId, guildId);

                return {
                    success: true,
                    message: "*The fox devours your strength... but you feel reborn, and oddly stronger for what's to come...*",
                    sacrificeCount: userData.sacrifices + 1
                };
            } else {
                // Set pending flag for confirmation
                const pendingStmt = this.db.prepare(`
                    UPDATE users
                    SET sacrifice_pending = 1
                    WHERE user_id = ?
                      AND guild_id = ?
                `);

                pendingStmt.run(userId, guildId);

                return {
                    success: false,
                    message: "*The fox grows its fangs..* Are you sure? This will result in the loss of all your hard dedicated work.. but I will provide a little medal for your sacrifice... run the command again to confirm...",
                    canSacrifice: true,
                    needsConfirmation: true
                };
            }
        } catch (error) {
            console.error('Error performing sacrifice:', error);
            throw error;
        }
    }

    // Add method to check if a user is eligible for sacrifice prompt
    isEligibleForSacrificePrompt(userId, guildId = 'global') {
        try {
            // Get user data
            const userData = this.getUser(userId, guildId);

            // Check if user is at max level with max XP
            const maxLevelXP = this.xpForLevel(config.xp.maxLevel);

            return userData.level >= config.xp.maxLevel && userData.xp >= maxLevelXP;
        } catch (error) {
            console.error('Error checking sacrifice eligibility:', error);
            return false;
        }
    }

// Add method to reset sacrifice pending flag (for timeout)
    resetSacrificePending(userId, guildId = 'global') {
        try {
            const resetStmt = this.db.prepare(`
                UPDATE users
                SET sacrifice_pending = 0
                WHERE user_id = ?
                  AND guild_id = ?
            `);

            resetStmt.run(userId, guildId);
            return true;
        } catch (error) {
            console.error('Error resetting sacrifice pending:', error);
            return false;
        }
    }
}

module.exports = LevelingDatabase;