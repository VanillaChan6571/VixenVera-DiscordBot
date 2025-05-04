// Main database class that combines all the modules
const config = require('../config');

// Import database modules
const {
    initializeConnection,
    setupPragmas,
    createTables,
    setupAutoSave,
    closeDatabase
} = require('./core');

const createUserMethods = require('./users');
const createLevelingMethods = require('./leveling');
const createLeaderboardMethods = require('./leaderboard');
const createSacrificeMethods = require('./sacrifice');
const createGuildSettingsMethods = require('./guild-settings');

/**
 * LevelingDatabase class that combines all database functionality
 */
class LevelingDatabase {
    constructor() {
        this.config = config.database.sqlite;
        this.db = null;
        this.saveInterval = null;

        // Initialize the database
        this.initialize();
    }

    /**
     * Initialize the database and all methods
     */
    initialize() {
        try {
            // Connect to the database
            this.db = initializeConnection();

            // Create tables if they don't exist
            createTables(this.db);

            // Setup auto-save interval for WAL mode
            this.saveInterval = setupAutoSave(this.db);

            // Initialize method groups
            this.initializeMethods();

            console.log(`Leveling database fully initialized`);
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }

    /**
     * Initialize all method groups and bind them to this instance
     */
    initializeMethods() {
        // Get all method groups
        const userMethods = createUserMethods(this.db);
        const levelingMethods = createLevelingMethods(this.db);
        const leaderboardMethods = createLeaderboardMethods(this.db);
        const sacrificeMethods = createSacrificeMethods(this.db);
        const guildSettingsMethods = createGuildSettingsMethods(this.db);

        // Combine all methods into this instance
        Object.assign(this,
            userMethods,
            levelingMethods,
            leaderboardMethods,
            sacrificeMethods,
            guildSettingsMethods
        );

        console.log('All database methods initialized');
    }

    /**
     * Close the database connection
     */
    close() {
        closeDatabase(this.db, this.saveInterval);
        this.db = null;
        this.saveInterval = null;
    }
}

module.exports = LevelingDatabase;