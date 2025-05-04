// XP and level-related database methods
const config = require('../config');

/**
 * XP and leveling-related database methods
 * @param {object} db Database connection
 * @returns {object} Leveling methods
 */
function createLevelingMethods(db) {
    return {
        /**
         * Add XP to user and update level
         * @param {string} userId User ID
         * @param {number} xpAmount Amount of XP to add
         * @param {string} guildId Guild ID (default: 'global')
         * @returns {object} Result object with level up information
         */
        addXP(userId, xpAmount, guildId = 'global') {
            try {
                // Ensure the user exists first
                this.ensureUser(userId, guildId);

                const now = Date.now();

                // Prepare statements
                const updateXPStmt = db.prepare(`
                    UPDATE users
                    SET xp           = xp + ?,
                        last_message = ?
                    WHERE user_id = ?
                      AND guild_id = ?
                `);

                const getUserStmt = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE user_id = ?
                      AND guild_id = ?
                `);

                const updateLevelStmt = db.prepare(`
                    UPDATE users
                    SET level = ?
                    WHERE user_id = ?
                      AND guild_id = ?
                `);

                // Execute transaction for atomic operations
                const transaction = db.transaction(() => {
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
        },

        /**
         * Calculate XP required for a level
         * @param {number} level Level to calculate XP for
         * @returns {number} XP required for the level
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
        },

        /**
         * Calculate level from XP
         * @param {number} xp Total XP
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
    };
}

module.exports = createLevelingMethods;