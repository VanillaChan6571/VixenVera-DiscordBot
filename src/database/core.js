// Core database functionality - connection management and setup
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Initialize a database connection
 * @returns {object} Database connection
 */
function initializeConnection() {
    try {
        // Make sure we have a valid path
        if (!config.database.sqlite.path) {
            throw new Error('Database path is undefined. Check your configuration and .env file.');
        }

        // Log the database path for debugging
        console.log('Database path:', config.database.sqlite.path);

        // Create directory if it doesn't exist
        const dbDir = path.dirname(config.database.sqlite.path);
        if (!fs.existsSync(dbDir)) {
            console.log(`Creating database directory: ${dbDir}`);
            fs.mkdirSync(dbDir, {recursive: true});
        }

        // Connect to the database
        const db = new Database(config.database.sqlite.path);

        // Configure database
        setupPragmas(db);

        console.log(`Connected to SQLite database: ${config.database.sqlite.path}`);

        return db;
    } catch (error) {
        console.error('Error initializing database connection:', error);
        throw error;
    }
}

/**
 * Set up database pragmas for performance
 * @param {object} db Database connection
 */
function setupPragmas(db) {
    try {
        // Apply all configured pragmas individually
        for (const [key, value] of Object.entries(config.database.sqlite.pragmas)) {
            db.pragma(`${key} = ${value}`);
        }

        console.log('Database pragmas configured for optimal performance');
    } catch (error) {
        console.error('Error setting up pragmas:', error);
        throw error;
    }
}

/**
 * Create necessary database tables
 * @param {object} db Database connection
 */
function createTables(db) {
    try {
        // Create users table
        db.exec(`
            CREATE TABLE IF NOT EXISTS users
            (
                user_id TEXT PRIMARY KEY,
                xp INTEGER NOT NULL DEFAULT 0,
                level INTEGER NOT NULL DEFAULT 0,
                last_message INTEGER NOT NULL DEFAULT 0,
                first_seen INTEGER NOT NULL DEFAULT 0,
                guild_id TEXT NOT NULL DEFAULT 'global',
                sacrifices INTEGER NOT NULL DEFAULT 0,
                sacrifice_pending INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);
            CREATE INDEX IF NOT EXISTS idx_users_level ON users(level DESC);
            CREATE INDEX IF NOT EXISTS idx_users_guild ON users(guild_id);
        `);

        // Create statistics table
        db.exec(`
            CREATE TABLE IF NOT EXISTS statistics
            (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        // Create guild settings table
        db.exec(`
            CREATE TABLE IF NOT EXISTS guild_settings
            (
                guild_id TEXT NOT NULL,
                setting_key TEXT NOT NULL,
                setting_value TEXT,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (guild_id, setting_key)
            );
            CREATE INDEX IF NOT EXISTS idx_guild_settings ON guild_settings(guild_id);
        `);

        console.log('Database tables initialized');
    } catch (error) {
        console.error('Error creating tables:', error);
        throw error;
    }
}

/**
 * Set up an interval to checkpoint the WAL file
 * @param {object} db Database connection
 * @returns {number} Interval ID
 */
function setupAutoSave(db) {
    const saveInterval = setInterval(() => {
        try {
            // Checkpoint the WAL file to ensure data is saved to the main database file
            db.pragma('wal_checkpoint(PASSIVE)');
        } catch (error) {
            console.error('Error during automatic database checkpoint:', error);
        }
    }, config.database.sqlite.saveInterval);

    console.log(`Automatic database checkpoint set up (every ${config.database.sqlite.saveInterval / 1000}s)`);

    return saveInterval;
}

/**
 * Perform a full checkpoint and close database
 * @param {object} db Database connection
 * @param {number} saveInterval Interval ID to clear
 */
function closeDatabase(db, saveInterval) {
    if (saveInterval) {
        clearInterval(saveInterval);
    }

    if (db) {
        try {
            // Final checkpoint
            db.pragma('wal_checkpoint(FULL)');
            db.close();
            console.log('Database connection closed');
        } catch (error) {
            console.error('Error closing database:', error);
        }
    }
}

module.exports = {
    initializeConnection,
    setupPragmas,
    createTables,
    setupAutoSave,
    closeDatabase
};