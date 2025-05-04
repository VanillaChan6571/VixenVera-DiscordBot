// In index.js, make sure you have this import:
const { definitions: adminCommandDefinitions, handlers: adminCommandHandlers, setDatabase: setAdminDatabase } = require('./commandsAdmin');

// After loading the database:
// Set the database for command handlers
setDatabase(db);

// Also set for admin commands
try {
    setAdminDatabase(db);
    console.log('Admin command handlers connected to database');
} catch (error) {
    console.warn('Error connecting admin commands to database:', error.message);
    console.log('Admin commands may not function correctly');
}

// In the registerCommands function, use error handling when combining commands:
async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');

        // Safely combine all command types
        let allCommands = [...commandDefinitions];

        // Add admin commands if they exist
        if (adminCommandDefinitions) {
            allCommands = [...allCommands, ...adminCommandDefinitions];
        }

        // Add UGC commands if they exist
        try {
            const { definitions: ugcCommandDefinitions } = require('./commandsUGC');
            if (ugcCommandDefinitions) {
                allCommands = [...allCommands, ...ugcCommandDefinitions];
                console.log('UGC commands loaded successfully');
            }
        } catch (error) {
            console.warn('UGC commands not available:', error.message);
        }

        console.log('Registering commands:', allCommands.map(cmd => cmd.name).join(', '));

        const rest = new REST({ version: '10' }).setToken(config.bot.token);

        await rest.put(
            Routes.applicationCommands(config.bot.clientId),
            { body: allCommands }
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Similar approach for the interaction handler:
// Find handler for this command with error handling
let handler = commandHandlers[commandName];

// Try admin handlers if no regular handler found
if (!handler && adminCommandHandlers && adminCommandHandlers[commandName]) {
    handler = adminCommandHandlers[commandName];
}

// Try UGC handlers if no handler found yet
if (!handler) {
    try {
        const { handlers: ugcCommandHandlers } = require('./commandsUGC');
        if (ugcCommandHandlers && ugcCommandHandlers[commandName]) {
            handler = ugcCommandHandlers[commandName];
        }
    } catch (error) {
        // UGC commands not available
    }
}

if (handler) {
    try {
        await handler(interaction);
    } catch (error) {
        console.error(`Error executing command ${commandName}:`, error);

        // Reply with error message if interaction hasn't been replied to
        const replyContent = {
            content: 'There was an error executing this command!',
            ephemeral: true
        };

        if (interaction.deferred) {
            await interaction.editReply(replyContent);
        } else if (!interaction.replied) {
            await interaction.reply(replyContent);
        }
    }
}