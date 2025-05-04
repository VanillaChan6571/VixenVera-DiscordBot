// Guild settings database methods
const config = require('../config');

/**
 * Guild settings database methods
 * @param {object} db Database connection
 * @returns {object} Guild settings methods
 */
function createGuildSettingsMethods(db) {
    return {
        /**
         * Get a guild setting with fallback to default
         * @param {string} guildId Guild ID
         * @param {string} settingKey Setting key
         * @param {*} defaultValue Default value if setting doesn't exist
         * @returns {*} Setting value or default
         */
        getGuildSetting(guildId, settingKey, defaultValue = null) {
            try {
                const stmt = db.prepare('SELECT setting_value FROM guild_settings WHERE guild_id = ? AND setting_key = ?');
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
        },

        /**
         * Update a guild setting
         * @param {string} guildId Guild ID
         * @param {string} settingKey Setting key
         * @param {*} settingValue Setting value
         * @returns {object} Result of operation
         */
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

                const stmt = db.prepare(`
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
        },

        /**
         * Get all settings for a guild
         * @param {string} guildId Guild ID
         * @returns {object} Object with all guild settings
         */
        getAllGuildSettings(guildId) {
            try {
                const stmt = db.prepare('SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?');
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
        },

        /**
         * Delete a guild setting
         * @param {string} guildId Guild ID
         * @param {string} settingKey Setting key
         * @returns {object} Result of operation
         */
        deleteGuildSetting(guildId, settingKey) {
            try {
                const stmt = db.prepare('DELETE FROM guild_settings WHERE guild_id = ? AND setting_key = ?');
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
    };
}

module.exports = createGuildSettingsMethods;