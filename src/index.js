// Discord Leveling Bot - Main File
const {
    Client,
    GatewayIntentBits,
    ActivityType,
    REST,
    Routes,
    EmbedBuilder
} = require('discord.js');

// Load modules
const config = require('./config');
const { LevelingDB, XPCooldownManager, generateXP } = require('./levelingSystem');
const { definitions: commandDefinitions, handlers: commandHandlers, setDatabase } = require('./commands');
const { definitions: adminCommandDefinitions, handlers: adminCommandHandlers, setDatabase: setAdminDatabase } = require('./commandsAdmin');
// Add import for UGC commands
const { definitions: ugcCommandDefinitions, handlers: ugcCommandHandlers } = require('./commandsUGC');
const { initializeUGCServer } = require('./ugc-server');
const { processUploadedImage, activeSessions } = require('./ugc');

// Validate critical configuration
function validateConfig() {
    let hasErrors = false;

    if (!config.bot || !config.bot.token) {
        console.error('ERROR: Bot token is missing! Make sure you have a valid .env file with BOT_TOKEN.');
        hasErrors = true;
    }

    if (!config.bot || !config.bot.clientId) {
        console.error('ERROR: Client ID is missing! Make sure you have a valid .env file with CLIENT_ID.');
        hasErrors = true;
    }

    if (!config.database || !config.database.sqlite || !config.database.sqlite.path) {
        console.error('ERROR: Database path is undefined! Check your configuration.');
        hasErrors = true;
    }

    return !hasErrors;
}

// Abort if configuration is invalid
if (!validateConfig()) {
    console.error('Critical configuration errors found. Aborting.');
    process.exit(1);
}

// Initialize client with required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages // Add this to handle DM uploads
    ]
});

// Initialize database and cooldown manager
let db;
try {
    db = new LevelingDB();
    // Pass database to command handlers
    setDatabase(db);
    setAdminDatabase(db);
    // Make the database accessible from the client
    client.levelingDB = db;
    console.log('Database initialized successfully');
} catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
}

try {
    const ugcBaseUrl = initializeUGCServer();
    // Store the base URL on the client so it can be accessed throughout the application
    client.ugcBaseUrl = ugcBaseUrl;
    console.log(`UGC server initialized with base URL: ${ugcBaseUrl}`);
} catch (error) {
    console.error('Failed to initialize UGC server:', error);
}

const cooldownManager = new XPCooldownManager();

// Function to register slash commands
async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');

        // Combine regular, admin, and UGC command definitions
        let allCommands = [
            ...commandDefinitions,
            ...(adminCommandDefinitions || []),
            ...(ugcCommandDefinitions || []) // Add UGC commands
        ];

        // Process the commands to handle BigInt permissions
        allCommands = allCommands.map(cmd => {
            const command = { ...cmd };

            // Convert BigInt permissions to strings if they exist
            if (command.defaultMemberPermissions) {
                command.defaultMemberPermissions = command.defaultMemberPermissions.toString();
            }

            return command;
        });

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

// When bot is ready
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Register slash commands
    registerCommands();

    // Set bot activity
    const activityType = ActivityType[config.bot.activity.type] || ActivityType.Watching;
    client.user.setActivity(config.bot.activity.name, { type: activityType });

    console.log('Leveling bot is now online!');
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // Find handler for this command - check all handler types
    const handler = commandHandlers[commandName] ||
        (adminCommandHandlers ? adminCommandHandlers[commandName] : undefined) ||
        (ugcCommandHandlers ? ugcCommandHandlers[commandName] : undefined);

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
});

// Handle DM messages for image uploads
client.on('messageCreate', async message => {
    // Processing for UGC uploads in DMs
    if (message.channel.type === 1 && !message.author.bot) { // Type 1 is DM
        // Check if there's an active upload session for this user
        const sessionData = activeSessions.get(message.author.id);
        if (sessionData) {
            // Process the upload
            await processUploadedImage(message, sessionData);
            return; // Skip XP processing
        }
    }

    // Only process XP in guilds
    if (!message.guild || message.author.bot) return;

    // Get user ID
    const userId = message.author.id;

    // Check if user is on cooldown
    if (cooldownManager.isOnCooldown(userId)) return;

    // Set new cooldown
    cooldownManager.setCooldown(userId);

    try {
        // Give XP to user
        const xpToAdd = generateXP();
        const result = db.addXP(userId, xpToAdd, message.guild.id);

        // Handle level up if it occurred
        if (result.leveledUp && config.xp.levelUp.enabled) {
            // Check if level rewards are enabled
            const newLevel = result.newLevel;
            let roleAwarded = null;

            // Check if there's a role reward for this level
            if (config.xp.levelUp.rewards[newLevel]) {
                const roleId = config.xp.levelUp.rewards[newLevel];
                const role = message.guild.roles.cache.get(roleId);

                // Give role if it exists
                if (role) {
                    try {
                        await message.member.roles.add(role);
                        roleAwarded = role;
                    } catch (err) {
                        console.error(`Failed to add role ${roleId} to user ${userId}:`, err);
                    }
                }
            }

            // Create level up message
            const levelUpEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Level Up!')
                .setDescription(
                    `Congratulations ${config.xp.levelUp.pingUser ? message.author : message.author.username}! ` +
                    `You've reached **Level ${newLevel}**!`
                )
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            // Add role info if a role was awarded
            if (roleAwarded) {
                levelUpEmbed.addFields({
                    name: 'Reward Unlocked!',
                    value: `You've been given the ${roleAwarded.name} role!`
                });
            }

            // Determine where to send level up message
            let channel = message.channel;

            // Check for channel override
            if (config.xp.levelUp.channelOverride) {
                const overrideChannel = client.channels.cache.get(config.xp.levelUp.channelOverride);
                if (overrideChannel) {
                    channel = overrideChannel;
                }
            }

            // Send as DM if configured
            if (config.xp.levelUp.dm) {
                try {
                    await message.author.send({ embeds: [levelUpEmbed] });
                } catch (err) {
                    console.error(`Failed to send DM to user ${userId}:`, err);
                    // Fall back to channel if DM fails
                    channel.send({ embeds: [levelUpEmbed] });
                }
            } else {
                // Send in channel
                channel.send({ embeds: [levelUpEmbed] });
            }

            // Check if user reached max level and is eligible for sacrifice
            if (newLevel === config.xp.maxLevel) {
                // Check if they have reached the maximum XP for the level
                if (db.isEligibleForSacrificePrompt(userId, message.guild.id)) {
                    // Send the fox invitation message
                    const foxMessage = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('🦊 The Fox Calls')
                        .setDescription("The fox lurks beyond the shadows... accept its invitation by using the `/level-sacrifice` command")
                        .setFooter({ text: 'A new beginning awaits...' });

                    channel.send({
                        content: `<@${userId}>`,
                        embeds: [foxMessage]
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error in XP processing:', error);
    }
});

// Login the bot
console.log('Attempting to log in to Discord...');
client.login(config.bot.token).catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});

// Proper shutdown handling
function gracefulShutdown() {
    console.log('Shutting down gracefully...');

    if (db) {
        db.close();
    }

    client.destroy();
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Error handling for client
client.on('error', err => {
    console.error('Discord client error:', err);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});