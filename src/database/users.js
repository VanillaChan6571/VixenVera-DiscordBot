// User-related database methods
const config = require('../config');

/**
 * User-related database methods
 * @param {object} db Database connection
 * @returns {object} User methods
 */
function createUserMethods(db) {
    return {
        /**
         * Ensure a user exists in the database
         * @param {string} userId User ID
         * @param {string} guildId Guild ID (default: 'global')
         * @returns {object} User data
         */
        ensureUser(userId, guildId = 'global') {
            const now = Date.now();

            try {
                // Prepare statements for better performance
                const getUserStmt = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id = ?');
                const insertUserStmt = db.prepare(`
                    INSERT INTO users (user_id, xp, level, last_message, first_seen, guild_id)
                    VALUES (?, 0, 0, ?, ?, ?)
                `);

                // Begin transaction
                const transaction = db.transaction(() => {
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
        },

        /**
         * Get a user's data
         * @param {string} userId User ID
         * @param {string} guildId Guild ID (default: 'global')
         * @returns {object} User data
         */
        getUser(userId, guildId = 'global') {
            try {
                return this.ensureUser(userId, guildId);
            } catch (error) {
                console.error('Error getting user:', error);
                throw error;
            }
        },

        /**
         * Get a user's rank position
         * @param {string} userId User ID
         * @param {string} guildId Guild ID (default: 'global')
         * @returns {number} Rank position
         */
        getUserRank(userId, guildId = 'global') {
            try {
                // Make sure user exists
                this.ensureUser(userId, guildId);

                // Get rank
                const getRankStmt = db.prepare(`
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
    };
}

module.exports = createUserMethods;