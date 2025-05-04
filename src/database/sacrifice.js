// Leaderboard-related database methods
const config = require('../config');

/**
 * Leaderboard-related database methods
 * @param {object} db Database connection
 * @returns {object} Leaderboard methods
 */
function createLeaderboardMethods(db) {
    return {
        /**
         * Get leaderboard data
         * @param {number} page Page number (default: 1)
         * @param {number} pageSize Number of users per page (default: from config)
         * @param {string} guildId Guild ID (default: 'global')
         * @returns {object} Leaderboard data with pagination
         */
        getLeaderboard(page = 1, pageSize = config.leaderboard.pageSize, guildId = 'global') {
            try {
                const offset = (page - 1) * pageSize;

                // Get users for this page
                const getUsersStmt = db.prepare(`
                    SELECT user_id, xp, level
                    FROM users
                    WHERE guild_id = ?
                    ORDER BY xp DESC LIMIT ?
                    OFFSET ?
                `);

                // Count total users
                const countUsersStmt = db.prepare(`
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
    };
}

module.exports = createLeaderboardMethods;