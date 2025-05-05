// SQLite database implementation for the leveling system with guild-specific tables
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class LevelingDatabase {
    constructor() {
        this.config = config.database.sqlite;
        this.db = null;
        this.saveInterval = null;
        this.guildTablesCache = new Map(); // Cache to track created guild tables

        // Initialize the database
        this.initialize();
    }

    /**
     * Initialize the database connection and core tables
     */
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
                fs.mkdirSync(dbDir, { recursive: true });
            }

            // Connect to the database
            this.db = new Database(this.config.path);

            // Set up pragmas for performance
            this.setupPragmas();

            // Create core tables
            this.createCoreTables();

            // Setup auto-save interval for WAL mode
            this.setupAutoSave();

            // Apply backward compatibility fixes
            this.fixGuildSettingCompatibility();

            console.log(`Connected to SQLite database: ${this.config.path}`);
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error; // Re-throw to make the error visible
        }
    }

    /**
     * Set up performance pragmas
     */
    setupPragmas() {
        try {
            // Apply all configured pragmas individually
            for (const [key, value] of Object.entries(this.config.pragmas)) {
                this.db.pragma(`${key} = ${value}`);
            }

            console.log('Database pragmas configured for optimal performance');
        } catch (error) {
            console.error('Error setting up pragmas:', error);
            throw error;
        }
    }

    /**
     * Create core tables (users_global, settings_global, and statistics)
     */
    createCoreTables() {
        try {
            // Create users_global table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users_global (
                    user_id TEXT PRIMARY KEY,
                    first_seen INTEGER NOT NULL DEFAULT 0,
                    username TEXT,
                    is_blacklisted INTEGER NOT NULL DEFAULT 0,
                    blacklist_reason TEXT,
                    blacklisted_at INTEGER,
                    blacklisted_by TEXT,
                    last_updated INTEGER NOT NULL DEFAULT 0
                );
            `);

            // Create settings_global table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS settings_global (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT,
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
            `);

            // Create statistics table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS statistics (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
            `);

            console.log('Core database tables initialized');
        } catch (error) {
            console.error('Error creating core tables:', error);
            throw error;
        }
    }

    /**
     * Ensure guild tables exist (create if they don't)
     * @param {string} guildId - Discord Guild ID
     */
    ensureGuildTables(guildId) {
        try {
            // Special handling for global settings
            if (guildId === 'global') {
                // No need to create guild-specific tables for 'global'
                // Instead, make sure the settings_global table exists
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS settings_global (
                        setting_key TEXT PRIMARY KEY,
                        setting_value TEXT,
                        created_at INTEGER NOT NULL DEFAULT 0,
                        updated_at INTEGER NOT NULL DEFAULT 0
                    );
                `);
                return;
            }

            // Validate the guild ID is a proper Discord ID (numeric)
            if (!/^\d+$/.test(guildId)) {
                throw new Error(`Invalid guild ID format: ${guildId}`);
            }

            // Check if this is a user-specific pattern (old format) that should be skipped
            if (guildId.startsWith('user_')) {
                console.warn(`Attempted to create tables for invalid guild ID: ${guildId}`);
                return;
            }

            // Check our cache first to avoid repeated DB checks
            if (this.guildTablesCache.has(guildId)) {
                return;
            }

            // Create settings table for guild
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS settings_${guildId} (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT,
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
            `);

            // Create users table for guild
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users_${guildId} (
                    user_id TEXT PRIMARY KEY,
                    xp INTEGER NOT NULL DEFAULT 0,
                    level INTEGER NOT NULL DEFAULT 0,
                    last_message INTEGER NOT NULL DEFAULT 0,
                    sacrifices INTEGER NOT NULL DEFAULT 0,
                    sacrifice_pending INTEGER NOT NULL DEFAULT 0,
                    is_blacklisted INTEGER NOT NULL DEFAULT 0,
                    warning_count INTEGER NOT NULL DEFAULT 0,
                    banner_url TEXT,
                    avatar_url TEXT,
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                
                CREATE INDEX IF NOT EXISTS idx_${guildId}_users_xp ON users_${guildId}(xp DESC);
                CREATE INDEX IF NOT EXISTS idx_${guildId}_users_level ON users_${guildId}(level DESC);
            `);

            // Add to cache so we don't check again
            this.guildTablesCache.set(guildId, true);

            console.log(`Tables for guild ${guildId} initialized`);
        } catch (error) {
            console.error(`Error ensuring guild tables for ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Set up an interval to checkpoint the WAL file
     */
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

    /**
     * Close database connection
     */
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

    /**
     * Get a guild setting
     * @param {string} guildId - Guild ID
     * @param {string} settingKey - Setting key
     * @param {any} defaultValue - Default value if setting doesn't exist
     * @returns {any} Setting value
     */
    getGuildSetting(guildId, settingKey, defaultValue = null) {
        try {

            // Handle global settings specially
            if (guildId === 'global') {
                try {
                    const stmt = this.db.prepare(`
                        SELECT setting_value FROM settings_global 
                        WHERE setting_key = ?
                    `);
                    const result = stmt.get(settingKey);

                    if (result) {
                        // Process the result just like regular guild settings
                        if (result.setting_value.startsWith('{') || result.setting_value.startsWith('[')) {
                            try {
                                return JSON.parse(result.setting_value);
                            } catch (e) {
                                return result.setting_value;
                            }
                        }

                        if (result.setting_value === 'true') return true;
                        if (result.setting_value === 'false') return false;

                        return result.setting_value;
                    }
                } catch (e) {
                    // Handle the case where the table doesn't exist yet
                    console.log('Global settings table may not exist yet, returning default value');
                }

                return defaultValue;
            }

            // Regular guild setting
            // Validate the guild ID
            if (!/^\d+$/.test(guildId)) {
                console.warn(`Invalid guild ID format in getGuildSetting: ${guildId}`);
                return defaultValue;
            }

            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const stmt = this.db.prepare(`SELECT setting_value FROM settings_${guildId} WHERE setting_key = ?`);
            const result = stmt.get(settingKey);

            if (result) {
                // Try to parse as JSON if it looks like JSON
                if (result.setting_value.startsWith('{') || result.setting_value.startsWith('[')) {
                    try {
                        return JSON.parse(result.setting_value);
                    } catch (e) {
                        // Not valid JSON, return as is
                        return result.setting_value;
                    }
                }

                // Handle boolean values stored as strings
                if (result.setting_value === 'true') return true;
                if (result.setting_value === 'false') return false;

                return result.setting_value;
            }

            return defaultValue;
        } catch (error) {
            console.error(`Error getting guild setting ${settingKey} for guild ${guildId}:`, error);
            return defaultValue;
        }
    }

    /**
     * Update a guild setting
     * @param {string} guildId - Guild ID
     * @param {string} settingKey - Setting key
     * @param {any} settingValue - Setting value
     * @returns {object} Result object
     */
    async updateGuildSetting(guildId, settingKey, settingValue) {
        try {

            // Handle global settings specially
            if (guildId === 'global') {
                const now = Date.now();

                // Create the global settings table if it doesn't exist
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS settings_global (
                        setting_key TEXT PRIMARY KEY,
                        setting_value TEXT,
                        created_at INTEGER NOT NULL DEFAULT 0,
                        updated_at INTEGER NOT NULL DEFAULT 0
                    );
                `);

                // Convert values just like with regular settings
                let valueToStore = settingValue;

                if (typeof valueToStore === 'object' && valueToStore !== null) {
                    valueToStore = JSON.stringify(valueToStore);
                }

                if (typeof valueToStore === 'boolean') {
                    valueToStore = valueToStore.toString();
                }

                const stmt = this.db.prepare(`
                    INSERT INTO settings_global (setting_key, setting_value, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
                `);

                stmt.run(settingKey, valueToStore, now, now);

                return {
                    success: true,
                    guildId: 'global',
                    settingKey,
                    settingValue
                };
            }

            // Regular guild setting
            // Validate the guild ID
            if (!/^\d+$/.test(guildId)) {
                console.warn(`Invalid guild ID format in updateGuildSetting: ${guildId}`);
                throw new Error(`Invalid guild ID format: ${guildId}`);
            }

            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const now = Date.now();

            // Convert objects or arrays to JSON strings
            if (typeof settingValue === 'object' && settingValue !== null) {
                settingValue = JSON.stringify(settingValue);
            }

            // Convert booleans to strings
            if (typeof settingValue === 'boolean') {
                settingValue = settingValue.toString();
            }

            const stmt = this.db.prepare(`
                INSERT INTO settings_${guildId} (setting_key, setting_value, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at = excluded.updated_at
            `);

            stmt.run(settingKey, settingValue, now, now);

            return {
                success: true,
                guildId,
                settingKey,
                settingValue
            };
        } catch (error) {
            console.error(`Error updating guild setting ${settingKey} for guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Get all settings for a guild
     * @param {string} guildId - Guild ID
     * @returns {object} All guild settings
     */
    getAllGuildSettings(guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const stmt = this.db.prepare(`SELECT setting_key, setting_value FROM settings_${guildId}`);
            const results = stmt.all();

            const settings = {};

            for (const row of results) {
                let value = row.setting_value;

                // Try to parse as JSON if it looks like JSON
                if (value.startsWith('{') || value.startsWith('[')) {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        // Not valid JSON, keep as is
                    }
                }

                // Handle boolean values stored as strings
                if (value === 'true') value = true;
                if (value === 'false') value = false;

                settings[row.setting_key] = value;
            }

            return settings;
        } catch (error) {
            console.error(`Error getting all guild settings for guild ${guildId}:`, error);
            return {};
        }
    }

    /**
     * Delete a guild setting
     * @param {string} guildId - Guild ID
     * @param {string} settingKey - Setting key
     * @returns {object} Result object
     */
    deleteGuildSetting(guildId, settingKey) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const stmt = this.db.prepare(`DELETE FROM settings_${guildId} WHERE setting_key = ?`);
            const result = stmt.run(settingKey);

            return {
                success: result.changes > 0,
                guildId,
                settingKey
            };
        } catch (error) {
            console.error(`Error deleting guild setting ${settingKey} for guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Ensure a user exists in the global user table
     * @param {string} userId - User ID
     * @param {string} username - Username (optional)
     * @returns {object} User data
     */
    ensureGlobalUser(userId, username = null) {
        const now = Date.now();

        try {
            const checkUserStmt = this.db.prepare(`
                SELECT * FROM users_global WHERE user_id = ?
            `);

            const insertUserStmt = this.db.prepare(`
                INSERT OR IGNORE INTO users_global (user_id, first_seen, username, last_updated)
                VALUES (?, ?, ?, ?)
            `);

            let user = checkUserStmt.get(userId);

            if (!user) {
                insertUserStmt.run(userId, now, username, now);
                user = checkUserStmt.get(userId);
            } else if (username && user.username !== username) {
                // Update username if it's changed
                const updateUsernameStmt = this.db.prepare(`
                    UPDATE users_global 
                    SET username = ?, last_updated = ?
                    WHERE user_id = ?
                `);
                updateUsernameStmt.run(username, now, userId);
                user.username = username;
            }

            return user;
        } catch (error) {
            console.error(`Error ensuring global user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Ensure a user exists in a guild's user table
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {object} User data
     */
    ensureGuildUser(userId, guildId) {
        const now = Date.now();

        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const checkUserStmt = this.db.prepare(`
                SELECT * FROM users_${guildId} WHERE user_id = ?
            `);

            const insertUserStmt = this.db.prepare(`
                INSERT OR IGNORE INTO users_${guildId} 
                (user_id, xp, level, last_message, created_at, updated_at)
                VALUES (?, 0, 0, ?, ?, ?)
            `);

            let user = checkUserStmt.get(userId);

            if (!user) {
                insertUserStmt.run(userId, now, now, now);
                user = checkUserStmt.get(userId);
            }

            return user;
        } catch (error) {
            console.error(`Error ensuring guild user ${userId} in guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Get a user's data (creates if doesn't exist)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} username - Username (optional)
     * @returns {object} Combined user data
     */
    getUser(userId, guildId, username = null) {
        try {
            // Ensure user exists in both global and guild tables
            const globalUser = this.ensureGlobalUser(userId, username);
            const guildUser = this.ensureGuildUser(userId, guildId);

            // Combine data from both sources
            return {
                ...globalUser,
                ...guildUser
            };
        } catch (error) {
            console.error(`Error getting user ${userId} in guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Get a user's rank position in the guild
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {number} User's rank
     */
    getUserRank(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Make sure user exists
            this.ensureGuildUser(userId, guildId);

            // Get rank
            const getRankStmt = this.db.prepare(`
                SELECT (
                    SELECT COUNT(*)
                    FROM users_${guildId}
                    WHERE xp > (
                        SELECT xp
                        FROM users_${guildId}
                        WHERE user_id = ?
                    )
                ) + 1 as rank
            `);

            const {rank} = getRankStmt.get(userId);
            return rank;
        } catch (error) {
            console.error(`Error getting user rank for ${userId} in guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Add XP to user and update level
     * @param {string} userId - User ID
     * @param {number} xpAmount - Amount of XP to add
     * @param {string} guildId - Guild ID
     * @returns {object} Result with level up information
     */
    addXP(userId, xpAmount, guildId) {
        try {
            // Ensure the user exists first
            this.ensureGuildUser(userId, guildId);

            const now = Date.now();

            // Prepare statements
            const updateXPStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET xp = xp + ?,
                    last_message = ?,
                    updated_at = ?
                WHERE user_id = ?
            `);

            const getUserStmt = this.db.prepare(`
                SELECT *
                FROM users_${guildId}
                WHERE user_id = ?
            `);

            const updateLevelStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET level = ?,
                    updated_at = ?
                WHERE user_id = ?
            `);

            // Execute transaction for atomic operations
            const transaction = this.db.transaction(() => {
                // Add XP
                updateXPStmt.run(xpAmount, now, now, userId);

                // Get updated user data
                const userData = getUserStmt.get(userId);

                // Calculate new level
                const oldLevel = userData.level;
                const newLevel = this.calculateLevel(userData.xp);

                // Update level if it changed
                if (newLevel > oldLevel) {
                    updateLevelStmt.run(newLevel, now, userId);
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
            console.error(`Error adding XP for user ${userId} in guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Get guild leaderboard data
     * @param {number} page - Page number
     * @param {number} pageSize - Number of users per page
     * @param {string} guildId - Guild ID
     * @returns {object} Leaderboard data
     */
    getLeaderboard(page = 1, pageSize = 10, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const offset = (page - 1) * pageSize;

            // Get users for this page
            const getUsersStmt = this.db.prepare(`
                SELECT user_id, xp, level
                FROM users_${guildId}
                ORDER BY xp DESC
                LIMIT ? OFFSET ?
            `);

            // Count total users
            const countUsersStmt = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM users_${guildId}
            `);

            // Get users
            const users = getUsersStmt.all(pageSize, offset);

            // Convert to the expected format
            const formattedUsers = users.map(user => [
                user.user_id,
                { xp: user.xp, level: user.level }
            ]);

            // Get total count
            const { count } = countUsersStmt.get();
            const totalPages = Math.ceil(count / pageSize);

            return {
                users: formattedUsers,
                currentPage: page,
                totalPages,
                totalUsers: count
            };
        } catch (error) {
            console.error(`Error getting leaderboard for guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Calculate required XP for a level with interpolation
     * @param {number} level - Level to calculate XP for
     * @returns {number} XP required
     */
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

    /**
     * Calculate level from XP
     * @param {number} xp - XP amount
     * @returns {number} Level
     */
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

            for (const { level, requiredXP } of levelData) {
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

    /**
     * Sacrifice a user (reset level, increment sacrifice count)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {object} Sacrifice result
     */
    async sacrificeUser(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

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
                    UPDATE users_${guildId}
                    SET level = 1, 
                        xp = ?, 
                        sacrifices = sacrifices + 1,
                        sacrifice_pending = 0,
                        updated_at = ?
                    WHERE user_id = ?
                `);

                // Get the XP needed for level 1
                const level1XP = this.xpForLevel(1);
                const now = Date.now();

                // Execute the sacrifice
                sacrificeStmt.run(level1XP, now, userId);

                return {
                    success: true,
                    message: "*The fox devours your strength... but you feel reborn, and oddly stronger for what's to come...*",
                    sacrificeCount: userData.sacrifices + 1
                };
            } else {
                // Set pending flag for confirmation
                const pendingStmt = this.db.prepare(`
                    UPDATE users_${guildId}
                    SET sacrifice_pending = 1,
                        updated_at = ?
                    WHERE user_id = ?
                `);

                const now = Date.now();
                pendingStmt.run(now, userId);

                return {
                    success: false,
                    message: "*The fox grows its fangs..* Are you sure? This will result in the loss of all your hard dedicated work.. but I will provide a little medal for your sacrifice... run the command again to confirm...",
                    canSacrifice: true,
                    needsConfirmation: true
                };
            }
        } catch (error) {
            console.error(`Error performing sacrifice for user ${userId} in guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Check if a user is eligible for sacrifice prompt
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {boolean} Whether user is eligible
     */
    isEligibleForSacrificePrompt(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Get user data
            const userData = this.getUser(userId, guildId);

            // Check if user is at max level with max XP
            const maxLevelXP = this.xpForLevel(config.xp.maxLevel);

            return userData.level >= config.xp.maxLevel && userData.xp >= maxLevelXP;
        } catch (error) {
            console.error(`Error checking sacrifice eligibility for user ${userId} in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Reset sacrifice pending flag (for timeout)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {boolean} Success
     */
    resetSacrificePending(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            const resetStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET sacrifice_pending = 0,
                    updated_at = ?
                WHERE user_id = ?
            `);

            const now = Date.now();
            resetStmt.run(now, userId);
            return true;
        } catch (error) {
            console.error(`Error resetting sacrifice pending for user ${userId} in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Get a user's banner URL
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {string|null} Banner URL or null
     */
    getUserBanner(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            // Get banner URL directly
            const getBannerStmt = this.db.prepare(`
                SELECT banner_url FROM users_${guildId}
                WHERE user_id = ?
            `);

            const result = getBannerStmt.get(userId);
            return result ? result.banner_url : null;
        } catch (error) {
            console.error(`Error getting banner for user ${userId} in guild ${guildId}:`, error);
            return null;
        }
    }

    /**
     * Set a user's banner URL
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} bannerUrl - Banner URL
     * @returns {boolean} Success
     */
    setUserBanner(userId, guildId, bannerUrl) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            // Update banner URL
            const updateBannerStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET banner_url = ?,
                    updated_at = ?
                WHERE user_id = ?
            `);

            const now = Date.now();
            const result = updateBannerStmt.run(bannerUrl, now, userId);
            return result.changes > 0;
        } catch (error) {
            console.error(`Error setting banner for user ${userId} in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Get a user's avatar URL
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {string|null} Avatar URL or null
     */
    getUserAvatar(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            // Get avatar URL directly
            const getAvatarStmt = this.db.prepare(`
                SELECT avatar_url FROM users_${guildId}
                WHERE user_id = ?
            `);

            const result = getAvatarStmt.get(userId);
            return result ? result.avatar_url : null;
        } catch (error) {
            console.error(`Error getting avatar for user ${userId} in guild ${guildId}:`, error);
            return null;
        }
    }

    /**
     * Set a user's avatar URL
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} avatarUrl - Avatar URL
     * @returns {boolean} Success
     */
    setUserAvatar(userId, guildId, avatarUrl) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            // Update avatar URL
            const updateAvatarStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET avatar_url = ?,
                    updated_at = ?
                WHERE user_id = ?
            `);

            const now = Date.now();
            const result = updateAvatarStmt.run(avatarUrl, now, userId);
            return result.changes > 0;
        } catch (error) {
            console.error(`Error setting avatar for user ${userId} in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Set blacklist status for a user (global)
     * @param {string} userId - User ID
     * @param {boolean} blacklisted - Whether user is blacklisted
     * @param {string} reason - Reason for blacklisting
     * @param {string} adminId - ID of admin who blacklisted
     * @returns {boolean} Success
     */
    setGlobalUserBlacklist(userId, blacklisted, reason = null, adminId = null) {
        try {
            // Ensure user exists in global table
            this.ensureGlobalUser(userId);

            const now = Date.now();

            const updateStmt = this.db.prepare(`
                UPDATE users_global
                SET is_blacklisted = ?,
                    blacklist_reason = ?,
                    blacklisted_at = ?,
                    blacklisted_by = ?,
                    last_updated = ?
                WHERE user_id = ?
            `);

            const result = updateStmt.run(
                blacklisted ? 1 : 0,
                reason,
                blacklisted ? now : null,
                adminId,
                now,
                userId
            );

            return result.changes > 0;
        } catch (error) {
            console.error(`Error setting global blacklist for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Check if a user is globally blacklisted
     * @param {string} userId - User ID
     * @returns {boolean} Whether user is blacklisted
     */
    isUserGloballyBlacklisted(userId) {
        try {
            // Don't try to use ensureGuildTables for global settings
            const stmt = this.db.prepare(`
                SELECT is_blacklisted FROM users_global
                WHERE user_id = ?
            `);

            const result = stmt.get(userId);
            return result ? result.is_blacklisted === 1 : false;
        } catch (error) {
            console.error(`Error checking global blacklist for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Set blacklist status for a user in a guild
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {boolean} blacklisted - Whether user is blacklisted
     * @returns {boolean} Success
     */
    setGuildUserBlacklist(userId, guildId, blacklisted) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            const updateStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET is_blacklisted = ?,
                    updated_at = ?
                WHERE user_id = ?
            `);

            const now = Date.now();
            const result = updateStmt.run(blacklisted ? 1 : 0, now, userId);
            return result.changes > 0;
        } catch (error) {
            console.error(`Error setting guild blacklist for user ${userId} in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Check if a user is blacklisted in a guild
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {boolean} Whether user is blacklisted
     */
    isUserGuildBlacklisted(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Check global blacklist first
            if (this.isUserGloballyBlacklisted(userId)) {
                return true;
            }

            // Then check guild-specific blacklist
            const stmt = this.db.prepare(`
                SELECT is_blacklisted FROM users_${guildId}
                WHERE user_id = ?
            `);

            const result = stmt.get(userId);
            return result ? result.is_blacklisted === 1 : false;
        } catch (error) {
            console.error(`Error checking guild blacklist for user ${userId} in guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Increment warning count for a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {number} New warning count
     */
    incrementUserWarnings(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            const updateStmt = this.db.prepare(`
                UPDATE users_${guildId}
                SET warning_count = warning_count + 1,
                    updated_at = ?
                WHERE user_id = ?
            `);

            const getStmt = this.db.prepare(`
                SELECT warning_count FROM users_${guildId}
                WHERE user_id = ?
            `);

            const now = Date.now();
            updateStmt.run(now, userId);

            const result = getStmt.get(userId);
            return result ? result.warning_count : 0;
        } catch (error) {
            console.error(`Error incrementing warnings for user ${userId} in guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Get warning count for a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {number} Warning count
     */
    getUserWarnings(userId, guildId) {
        try {
            // Ensure guild tables exist
            this.ensureGuildTables(guildId);

            // Ensure user exists
            this.ensureGuildUser(userId, guildId);

            const stmt = this.db.prepare(`
                SELECT warning_count FROM users_${guildId}
                WHERE user_id = ?
            `);

            const result = stmt.get(userId);
            return result ? result.warning_count : 0;
        } catch (error) {
            console.error(`Error getting warnings for user ${userId} in guild ${guildId}:`, error);
            return 0;
        }
    }

    /**
     * Save a statistic value
     * @param {string} key - Statistic key
     * @param {any} value - Statistic value
     * @returns {boolean} Success
     */
    saveStatistic(key, value) {
        try {
            const now = Date.now();

            // Convert value to string if necessary
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }

            const stmt = this.db.prepare(`
                INSERT INTO statistics (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            `);

            const result = stmt.run(key, value.toString(), now);
            return result.changes > 0;
        } catch (error) {
            console.error(`Error saving statistic ${key}:`, error);
            return false;
        }
    }

    /**
     * Get a statistic value
     * @param {string} key - Statistic key
     * @param {any} defaultValue - Default value if not found
     * @returns {any} Statistic value
     */
    getStatistic(key, defaultValue = null) {
        try {
            const stmt = this.db.prepare(`
                SELECT value FROM statistics WHERE key = ?
            `);

            const result = stmt.get(key);

            if (result) {
                // Try to parse JSON
                if (result.value.startsWith('{') || result.value.startsWith('[')) {
                    try {
                        return JSON.parse(result.value);
                    } catch (e) {
                        // Not valid JSON
                    }
                }

                // Handle boolean values
                if (result.value === 'true') return true;
                if (result.value === 'false') return false;

                // Handle numeric values
                if (!isNaN(result.value)) {
                    return Number(result.value);
                }

                return result.value;
            }

            return defaultValue;
        } catch (error) {
            console.error(`Error getting statistic ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Get UGC path for a user
     * @param {string} type - Content type (banner/avatar)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {string|null} UGC path
     */
    getUserUGCPath(type, userId, guildId) {
        try {
            // Get all relevant settings
            const guildOnly = this.getGuildSetting(guildId, `guild_only_${type}`, false);
            const userContentAllowed = this.getGuildSetting(guildId, `allow_user_${type}`, true);
            const guildDefault = this.getGuildSetting(guildId, `default_${type}_url`, null);

            // Get user-specific content
            let userPath = null;
            if (type === 'banner') {
                userPath = this.getUserBanner(userId, guildId);
            } else if (type === 'avatar') {
                userPath = this.getUserAvatar(userId, guildId);
            }

            // Log all the relevant settings for debugging
            console.log(`=== DEBUG: getUserUGCPath for user ${userId} in guild ${guildId} ===`);
            console.log(`Content type: ${type}`);
            console.log(`Guild-only mode: ${guildOnly}`);
            console.log(`User has content: ${userPath !== null}`);
            console.log(`User content path: ${userPath}`);
            console.log(`User content allowed: ${userContentAllowed}`);
            console.log(`Guild default path: ${guildDefault}`);

            // Use user content if:
            // 1. User has uploaded content
            // 2. Server is NOT in guild-only mode
            // 3. User content is allowed
            if (userPath && !guildOnly && userContentAllowed) {
                console.log('DECISION: Using user content');
                return userPath;
            }

            // Fall back to guild default
            if (guildDefault) {
                console.log('DECISION: Using guild default');
                return guildDefault;
            }

            // Fall back to system default only for banner
            if (type === 'banner') {
                console.log('DECISION: Using system default banner');
                return `/ugc/defaults/banner.jpg`;
            }

            console.log('DECISION: No content available');
            return null;
        } catch (error) {
            console.error(`Error getting UGC path for ${userId} in guild ${guildId}:`, error);

            // Return default banner on error, only for banner type
            if (type === 'banner') {
                return `/ugc/defaults/banner.jpg`;
            }

            return null;
        }
    }
    /**
     * This utility function can be added to the database.js file
     * It provides a way to access the old format "global" settings with the new structure
     *
     * @param {string} key - The setting key to get
     * @param {any} defaultValue - Default value if setting doesn't exist
     * @returns {any} - The setting value
     */
    getGlobalSetting(key, defaultValue = null) {
        try {
            // Make sure the global settings table exists
            this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings_global (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
        `);

            const stmt = this.db.prepare(`
            SELECT setting_value FROM settings_global 
            WHERE setting_key = ?
        `);

            const result = stmt.get(key);

            if (result) {
                // Process the result
                if (result.setting_value.startsWith('{') || result.setting_value.startsWith('[')) {
                    try {
                        return JSON.parse(result.setting_value);
                    } catch (e) {
                        return result.setting_value;
                    }
                }

                if (result.setting_value === 'true') return true;
                if (result.setting_value === 'false') return false;

                return result.setting_value;
            }

            return defaultValue;
        } catch (error) {
            console.error(`Error getting global setting ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * This utility function can be added to the database.js file
     * It provides a way to update global settings with the new structure
     *
     * @param {string} key - The setting key to update
     * @param {any} value - The new value
     * @returns {boolean} - Success of the operation
     */
    /**
     * Get global setting
     * @param {string} key - Setting key
     * @param {any} defaultValue - Default value if not found
     * @returns {any} Setting value
     */
    getGlobalSetting(key, defaultValue = null) {
        try {
            // Make sure the global settings table exists
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS settings_global (
                                                               setting_key TEXT PRIMARY KEY,
                                                               setting_value TEXT,
                                                               created_at INTEGER NOT NULL DEFAULT 0,
                                                               updated_at INTEGER NOT NULL DEFAULT 0
                );
            `);

            const stmt = this.db.prepare(`
            SELECT setting_value FROM settings_global 
            WHERE setting_key = ?
        `);

            const result = stmt.get(key);

            if (result) {
                // Process the result
                if (result.setting_value.startsWith('{') || result.setting_value.startsWith('[')) {
                    try {
                        return JSON.parse(result.setting_value);
                    } catch (e) {
                        return result.setting_value;
                    }
                }

                if (result.setting_value === 'true') return true;
                if (result.setting_value === 'false') return false;

                return result.setting_value;
            }

            return defaultValue;
        } catch (error) {
            console.error(`Error getting global setting ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Set global setting
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     * @returns {boolean} Success
     */
    setGlobalSetting(key, value) {
        try {
            // Make sure the global settings table exists
            this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings_global (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
        `);

            const now = Date.now();

            // Convert complex values to strings for storage
            let valueToStore = value;

            if (typeof valueToStore === 'object' && valueToStore !== null) {
                valueToStore = JSON.stringify(valueToStore);
            }

            if (typeof valueToStore === 'boolean') {
                valueToStore = valueToStore.toString();
            }

            const stmt = this.db.prepare(`
            INSERT INTO settings_global (setting_key, setting_value, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = excluded.updated_at
        `);

            stmt.run(key, valueToStore, now, now);

            return true;
        } catch (error) {
            console.error(`Error setting global setting ${key}:`, error);
            return false;
        }
    }

    /**
     * Backward compatibility method to maintain compatibility with old code
     * that uses getGuildSetting with 'global' as the guild ID
     */
    fixGuildSettingCompatibility() {
        const oldGetGuildSetting = this.getGuildSetting;

        this.getGuildSetting = (guildId, settingKey, defaultValue = null) => {
            // If global is used as guild ID, use the global setting method
            if (guildId === 'global') {
                return this.getGlobalSetting(settingKey, defaultValue);
            }

            // Otherwise use the normal method
            return oldGetGuildSetting.call(this, guildId, settingKey, defaultValue);
        };

        const oldUpdateGuildSetting = this.updateGuildSetting;

        this.updateGuildSetting = async (guildId, settingKey, settingValue) => {
            // If global is used as guild ID, use the global setting method
            if (guildId === 'global') {
                const success = this.setGlobalSetting(settingKey, settingValue);
                return {
                    success,
                    guildId: 'global',
                    settingKey,
                    settingValue
                };
            }

            // Otherwise use the normal method
            return oldUpdateGuildSetting.call(this, guildId, settingKey, settingValue);
        };
    }

    // MIGRATION FUNCTIONS


}

module.exports = LevelingDatabase;