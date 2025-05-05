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

    getGuildSetting(guildId, settingKey, defaultValue = null) {
        try {
            const stmt = this.db.prepare('SELECT setting_value FROM guild_settings WHERE guild_id = ? AND setting_key = ?');
            const result = stmt.get(guildId, settingKey);

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
            console.error(`Error getting guild setting ${settingKey}:`, error);
            return defaultValue;
        }
    }

    // Update a guild setting
    async updateGuildSetting(guildId, settingKey, settingValue) {
        try {
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
            INSERT INTO guild_settings (guild_id, setting_key, setting_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = excluded.updated_at
        `);

            stmt.run(guildId, settingKey, settingValue, now, now);

            return {
                success: true,
                guildId,
                settingKey,
                settingValue
            };
        } catch (error) {
            console.error(`Error updating guild setting ${settingKey}:`, error);
            throw error;
        }
    }

    // Get all settings for a guild
    getAllGuildSettings(guildId) {
        try {
            const stmt = this.db.prepare('SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?');
            const results = stmt.all(guildId);

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
            console.error('Error getting all guild settings:', error);
            return {};
        }
    }

    // Delete a guild setting
    deleteGuildSetting(guildId, settingKey) {
        try {
            const stmt = this.db.prepare('DELETE FROM guild_settings WHERE guild_id = ? AND setting_key = ?');
            const result = stmt.run(guildId, settingKey);

            return {
                success: result.changes > 0,
                guildId,
                settingKey
            };
        } catch (error) {
            console.error(`Error deleting guild setting ${settingKey}:`, error);
            throw error;
        }
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
                fs.mkdirSync(dbDir, { recursive: true });
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

    // Create necessary tables with improved schema
    createTables() {
        try {
            // Create users table for global data
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    first_seen INTEGER NOT NULL DEFAULT 0
                );
            `);

            // Create guild_users table for guild-specific data
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS guild_users (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL DEFAULT 'global',
                    xp INTEGER NOT NULL DEFAULT 0,
                    level INTEGER NOT NULL DEFAULT 0,
                    last_message INTEGER NOT NULL DEFAULT 0,
                    sacrifices INTEGER NOT NULL DEFAULT 0,
                    sacrifice_pending INTEGER NOT NULL DEFAULT 0,
                    banner_url TEXT,
                    avatar_url TEXT,
                    PRIMARY KEY (user_id, guild_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_guild_users_xp ON guild_users(xp DESC);
                CREATE INDEX IF NOT EXISTS idx_guild_users_level ON guild_users(level DESC);
                CREATE INDEX IF NOT EXISTS idx_guild_users_guild ON guild_users(guild_id);
            `);

            // Create statistics table for future expansion
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS statistics (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            `);

            // Create guild_settings table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id TEXT NOT NULL,
                    setting_key TEXT NOT NULL,
                    setting_value TEXT,
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (guild_id, setting_key)
                );
                CREATE INDEX IF NOT EXISTS idx_guild_settings ON guild_settings(guild_id);
            `);

            // Check if we need to migrate legacy data
            this.checkAndMigrateLegacyData();

            console.log('Database tables initialized');
        } catch (error) {
            console.error('Error creating tables:', error);
            throw error;
        }
    }

    // Check and migrate legacy data if needed
    checkAndMigrateLegacyData() {
        try {
            // Check if legacy users table exists and has data
            const legacyTableExists = this.db.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='users' 
                AND sql LIKE '%guild_id%'
            `).get();

            if (legacyTableExists) {
                console.log('Detected legacy database structure, checking for data to migrate...');

                // Check if we have data to migrate
                const userCount = this.db.prepare(`SELECT COUNT(*) as count FROM users`).get();

                if (userCount.count > 0 && !this.hasAlreadyMigrated()) {
                    console.log(`Found ${userCount.count} users to migrate. Starting migration...`);
                    this.migrateLegacyData();
                } else {
                    console.log('No legacy data to migrate or migration already completed.');
                }
            }
        } catch (error) {
            console.error('Error checking for legacy data:', error);
            // Continue without migration - not a critical error
        }
    }

    // Check if we've already migrated
    hasAlreadyMigrated() {
        try {
            const migrationDone = this.db.prepare(`
                SELECT value FROM statistics WHERE key = 'migration_completed'
            `).get();

            return migrationDone && migrationDone.value === 'true';
        } catch (error) {
            return false;
        }
    }

    // Migrate legacy data to new schema
    migrateLegacyData() {
        try {
            console.log('Starting data migration...');

            // Begin transaction for atomicity
            this.db.exec('BEGIN TRANSACTION');

            // Step 1: Create temporary table for users
            this.db.exec(`
                CREATE TEMPORARY TABLE temp_users AS
                SELECT DISTINCT user_id, MIN(first_seen) as first_seen 
                FROM users GROUP BY user_id
            `);

            // Step 2: Insert users into new global users table
            const insertedUsers = this.db.prepare(`
                INSERT INTO users (user_id, first_seen)
                SELECT user_id, first_seen FROM temp_users
            `).run();

            console.log(`Migrated ${insertedUsers.changes} users to global table`);

            // Step 3: Insert users guild data into guild_users table
            const insertedGuildUsers = this.db.prepare(`
                INSERT INTO guild_users (
                    user_id, guild_id, xp, level, last_message, 
                    sacrifices, sacrifice_pending
                )
                SELECT 
                    user_id, guild_id, xp, level, last_message,
                    COALESCE(sacrifices, 0), COALESCE(sacrifice_pending, 0)
                FROM users
            `).run();

            console.log(`Migrated ${insertedGuildUsers.changes} user-guild relationships`);

            // Step 4: Migrate UGC content (banners & avatars)
            this.migrateLegacyUserContent();

            // Step 5: Record that migration is complete
            this.db.prepare(`
                INSERT INTO statistics (key, value) VALUES ('migration_completed', 'true')
            `).run();

            // Clean up temporary table
            this.db.exec(`DROP TABLE temp_users`);

            // Commit transaction
            this.db.exec('COMMIT');

            console.log('Data migration completed successfully!');
        } catch (error) {
            // Rollback on error
            this.db.exec('ROLLBACK');
            console.error('Error during data migration:', error);
            console.log('Database restored to previous state');
        }
    }

    // Migrate legacy UGC content
    migrateLegacyUserContent() {
        try {
            // Find banner/avatar URLs in guild_settings
            const contentSettings = this.db.prepare(`
                SELECT guild_id, setting_key, setting_value
                FROM guild_settings
                WHERE setting_key IN ('banner_url', 'avatar_url')
                AND guild_id LIKE 'user_%'
            `).all();

            let migratedCount = 0;

            // Prepare statement for updating user content
            const updateStmt = this.db.prepare(`
                UPDATE guild_users
                SET banner_url = CASE WHEN ? = 'banner_url' THEN ? ELSE banner_url END,
                    avatar_url = CASE WHEN ? = 'avatar_url' THEN ? ELSE avatar_url END
                WHERE user_id = ? AND guild_id = ?
            `);

            for (const setting of contentSettings) {
                // Parse user_id and guild_id from settings key
                // Format is typically user_USER_ID_GUILD_ID
                const idParts = setting.guild_id.split('_');
                if (idParts.length >= 3) {
                    const userId = idParts[1];
                    // The guild ID is typically the last part
                    const guildId = idParts[idParts.length - 1];

                    // Update the appropriate field
                    updateStmt.run(
                        setting.setting_key,
                        setting.setting_value,
                        setting.setting_key,
                        setting.setting_value,
                        userId,
                        guildId
                    );

                    migratedCount++;
                }
            }

            console.log(`Migrated ${migratedCount} user content URLs`);
        } catch (error) {
            console.error('Error migrating legacy user content:', error);
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

    // Ensure a user exists in the database (improved version)
    ensureUser(userId, guildId = 'global') {
        const now = Date.now();

        try {
            // Begin transaction
            const transaction = this.db.transaction(() => {
                // Step 1: Ensure user exists in global table
                const checkGlobalUserStmt = this.db.prepare(`
                    SELECT * FROM users WHERE user_id = ?
                `);

                const insertGlobalUserStmt = this.db.prepare(`
                    INSERT OR IGNORE INTO users (user_id, first_seen)
                    VALUES (?, ?)
                `);

                let globalUser = checkGlobalUserStmt.get(userId);
                if (!globalUser) {
                    insertGlobalUserStmt.run(userId, now);
                    globalUser = checkGlobalUserStmt.get(userId);
                }

                // Step 2: Ensure user exists in guild_users table
                const checkGuildUserStmt = this.db.prepare(`
                    SELECT * FROM guild_users WHERE user_id = ? AND guild_id = ?
                `);

                const insertGuildUserStmt = this.db.prepare(`
                    INSERT OR IGNORE INTO guild_users 
                    (user_id, guild_id, xp, level, last_message)
                    VALUES (?, ?, 0, 0, ?)
                `);

                let guildUser = checkGuildUserStmt.get(userId, guildId);
                if (!guildUser) {
                    insertGuildUserStmt.run(userId, guildId, now);
                    guildUser = checkGuildUserStmt.get(userId, guildId);
                }

                // Return combined data
                return {
                    ...globalUser,
                    ...guildUser
                };
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

    // Get a user's rank position
    getUserRank(userId, guildId = 'global') {
        try {
            // Make sure user exists
            this.ensureUser(userId, guildId);

            // Get rank - updated for new schema
            const getRankStmt = this.db.prepare(`
                SELECT (
                    SELECT COUNT(*)
                    FROM guild_users
                    WHERE guild_id = ? AND xp > (
                        SELECT xp
                        FROM guild_users
                        WHERE user_id = ? AND guild_id = ?
                    )
                ) + 1 as rank
            `);

            const {rank} = getRankStmt.get(guildId, userId, guildId);
            return rank;
        } catch (error) {
            console.error('Error getting user rank:', error);
            throw error;
        }
    }

    // Add XP to user and update level - updated for new schema
    addXP(userId, xpAmount, guildId = 'global') {
        try {
            // Ensure the user exists first
            this.ensureUser(userId, guildId);

            const now = Date.now();

            // Prepare statements - updated for new schema
            const updateXPStmt = this.db.prepare(`
                UPDATE guild_users
                SET xp = xp + ?,
                    last_message = ?
                WHERE user_id = ? AND guild_id = ?
            `);

            const getUserStmt = this.db.prepare(`
                SELECT *
                FROM guild_users
                WHERE user_id = ? AND guild_id = ?
            `);

            const updateLevelStmt = this.db.prepare(`
                UPDATE guild_users
                SET level = ?
                WHERE user_id = ? AND guild_id = ?
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

    // Get leaderboard data - updated for new schema
    getLeaderboard(page = 1, pageSize = config.leaderboard.pageSize, guildId = 'global') {
        try {
            const offset = (page - 1) * pageSize;

            // Get users for this page - updated for new schema
            const getUsersStmt = this.db.prepare(`
                SELECT user_id, xp, level
                FROM guild_users
                WHERE guild_id = ?
                ORDER BY xp DESC
                LIMIT ? OFFSET ?
            `);

            // Count total users - updated for new schema
            const countUsersStmt = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM guild_users
                WHERE guild_id = ?
            `);

            // Get users
            const users = getUsersStmt.all(guildId, pageSize, offset);

            // Convert to the expected format (compatible with previous JSON format)
            const formattedUsers = users.map(user => [
                user.user_id,
                { xp: user.xp, level: user.level }
            ]);

            // Get total count
            const { count } = countUsersStmt.get(guildId);
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

    // Calculate required XP for a level with interpolation
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

    // Add a new method for the sacrifice system - updated for new schema
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
                // Perform the sacrifice - updated for new schema
                const sacrificeStmt = this.db.prepare(`
                    UPDATE guild_users
                    SET level = 1, 
                        xp = ?, 
                        sacrifices = sacrifices + 1,
                        sacrifice_pending = 0
                    WHERE user_id = ? AND guild_id = ?
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
                // Set pending flag for confirmation - updated for new schema
                const pendingStmt = this.db.prepare(`
                    UPDATE guild_users
                    SET sacrifice_pending = 1
                    WHERE user_id = ? AND guild_id = ?
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

    // Add method to check if a user is eligible for sacrifice prompt - updated for new schema
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

    // Add method to reset sacrifice pending flag (for timeout) - updated for new schema
    resetSacrificePending(userId, guildId = 'global') {
        try {
            const resetStmt = this.db.prepare(`
                UPDATE guild_users
                SET sacrifice_pending = 0
                WHERE user_id = ? AND guild_id = ?
            `);

            resetStmt.run(userId, guildId);
            return true;
        } catch (error) {
            console.error('Error resetting sacrifice pending:', error);
            return false;
        }
    }

    // NEW METHODS FOR UGC CONTENT

    /**
     * Get a user's banner URL
     * @param {string} userId User ID
     * @param {string} guildId Guild ID
     * @returns {string|null} Banner URL or null
     */
    getUserBanner(userId, guildId) {
        try {
            // Ensure user exists
            this.ensureUser(userId, guildId);

            // Get banner URL directly
            const getBannerStmt = this.db.prepare(`
                SELECT banner_url FROM guild_users
                WHERE user_id = ? AND guild_id = ?
            `);

            const result = getBannerStmt.get(userId, guildId);
            return result ? result.banner_url : null;
        } catch (error) {
            console.error('Error getting user banner:', error);
            return null;
        }
    }

    /**
     * Set a user's banner URL
     * @param {string} userId User ID
     * @param {string} guildId Guild ID
     * @param {string} bannerUrl Banner URL
     * @returns {boolean} Success
     */
    setUserBanner(userId, guildId, bannerUrl) {
        try {
            // Ensure user exists
            this.ensureUser(userId, guildId);

            // Update banner URL
            const updateBannerStmt = this.db.prepare(`
                UPDATE guild_users
                SET banner_url = ?
                WHERE user_id = ? AND guild_id = ?
            `);

            const result = updateBannerStmt.run(bannerUrl, userId, guildId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error setting user banner:', error);
            return false;
        }
    }

    /**
     * Get a user's avatar URL
     * @param {string} userId User ID
     * @param {string} guildId Guild ID
     * @returns {string|null} Avatar URL or null
     */
    getUserAvatar(userId, guildId) {
        try {
            // Ensure user exists
            this.ensureUser(userId, guildId);

            // Get avatar URL directly
            const getAvatarStmt = this.db.prepare(`
                SELECT avatar_url FROM guild_users
                WHERE user_id = ? AND guild_id = ?
            `);

            const result = getAvatarStmt.get(userId, guildId);
            return result ? result.avatar_url : null;
        } catch (error) {
            console.error('Error getting user avatar:', error);
            return null;
        }
    }

    /**
     * Set a user's avatar URL
     * @param {string} userId User ID
     * @param {string} guildId Guild ID
     * @param {string} avatarUrl Avatar URL
     * @returns {boolean} Success
     */
    setUserAvatar(userId, guildId, avatarUrl) {
        try {
            // Ensure user exists
            this.ensureUser(userId, guildId);

            // Update avatar URL
            const updateAvatarStmt = this.db.prepare(`
                UPDATE guild_users
                SET avatar_url = ?
                WHERE user_id = ? AND guild_id = ?
            `);

            const result = updateAvatarStmt.run(avatarUrl, userId, guildId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error setting user avatar:', error);
            return false;
        }
    }

    // Backward compatibility wrapper for legacy code that uses the old approach
    getUserUGCPath(type, userId, guildId) {
        try {
            // First check if the server is in guild-only mode
            const guildOnly = this.getGuildSetting(guildId, `guild_only_${type}`, false);

            // Get user content path directly from the new table
            let userPath = null;
            if (type === 'banner') {
                userPath = this.getUserBanner(userId, guildId);
            } else if (type === 'avatar') {
                userPath = this.getUserAvatar(userId, guildId);
            }

            const userContentAllowed = this.getGuildSetting(guildId, `allow_user_${type}`, true);

            // Use user content if:
            // 1. User has uploaded content
            // 2. Server is NOT in guild-only mode
            // 3. User content is allowed
            if (userPath && !guildOnly && userContentAllowed) {
                return userPath;
            }

            // Fall back to guild default
            const guildDefault = this.getGuildSetting(guildId, `default_${type}_url`, null);
            if (guildDefault) {
                return guildDefault;
            }

            // Fall back to system default only for banner
            if (type === 'banner') {
                return `/ugc/defaults/banner.jpg`;
            }

            return null;
        } catch (error) {
            console.error(`Error getting UGC path for ${userId} in ${guildId}:`, error);

            // Return default banner on error, only for banner type
            if (type === 'banner') {
                return `/ugc/defaults/banner.jpg`;
            }

            return null;
        }
    }
}

module.exports = LevelingDatabase;