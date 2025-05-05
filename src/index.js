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
const { definitions: ugcCommandDefinitions, handlers: ugcCommandHandlers } = require('./commandsUGC');
const { initializeUGCServer } = require('./ugc-server');
const { processUploadedImage, activeSessions } = require('./ugc');
// New imports for setup command functionality
const { definitions: setupCommandDefinitions, handlers: setupCommandHandlers, setDatabase: setSetupDatabase } = require('./commandsSetup');
const { definitions: debugCommandDefinitions, handlers: debugCommandHandlers, setDatabase: setDebugDatabase } = require('./commandsDebug');
const { extendUGCCommands, handleReportRequest } = require('./ugc-report');
const { setupReportHandlers } = require('./report-utils');

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
    // Connect setup commands to database
    try {
        setSetupDatabase(db);
        console.log('Setup command handlers connected to database');
    } catch (error) {
        console.warn('Error connecting setup commands to database:', error.message);
        console.log('Setup commands may not function correctly');
    }
    try {
        setDebugDatabase(db);
        console.log('Debug command handlers connected to database');
    } catch (error) {
        console.warn('Error connecting debug commands to database:', error.message);
    }
    // Make the database accessible from the client
    client.levelingDB = db;
    setupReportHandlers(client);
    console.log('Enhanced report system initialized');
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

        // Combine regular, admin, setup, and UGC command definitions
        let allCommands = [
            ...commandDefinitions,
            ...(adminCommandDefinitions || []),
            ...(setupCommandDefinitions || []),
            ...(debugCommandDefinitions || [])
        ];

        // Get UGC commands and extend with report functionality
        if (ugcCommandDefinitions) {
            const extendedUGCCommands = extendUGCCommands(ugcCommandDefinitions);
            allCommands = [...allCommands, ...extendedUGCCommands];
        }

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

    // Check if command restrictions are enabled and enforce them
    if (interaction.guild) {
        const guildId = interaction.guild.id;
        const channelId = interaction.channel.id;

        // Skip system commands which are exempt from restrictions
        const restrictedCommands = ['level', 'rank', 'leaderboard', 'xp-info'];

        if (restrictedCommands.includes(interaction.commandName)) {
            const restrictionsEnabled = db.getGuildSetting(guildId, 'command_restrictions_enabled', false);

            if (restrictionsEnabled) {
                const commandChannelId = db.getGuildSetting(guildId, 'command_channel_id', null);

                if (commandChannelId && channelId !== commandChannelId) {
                    return await interaction.reply({
                        content: `This command can only be used in <#${commandChannelId}>.`,
                        ephemeral: true
                    });
                }
            }
        }
    }

    const { commandName } = interaction;

    // For the UGC command, check if it's a report
    if (commandName === 'ugc' && interaction.options.getString('type') === 'report') {
        return await handleReportRequest(interaction);
    }

    // Find handler for this command - check all handler types
    const handler = commandHandlers[commandName] ||
        (adminCommandHandlers ? adminCommandHandlers[commandName] : undefined) ||
        (setupCommandHandlers ? setupCommandHandlers[commandName] : undefined) ||
        (ugcCommandHandlers ? ugcCommandHandlers[commandName] : undefined) ||
        (debugCommandHandlers ? debugCommandHandlers[commandName] : undefined);

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

// Handle DM messages for image uploads and regular messages for XP
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

    // Skip XP checks if message is a command
    if (message.content.startsWith('/')) return;

    // Get user ID and channel ID
    const userId = message.author.id;
    const channelId = message.channel.id;
    const guildId = message.guild.id;

    // Check XP channel settings
    const xpMode = db.getGuildSetting(guildId, 'xp_channels_mode', 'disable');

    // Skip if disabled
    if (xpMode !== 'disable') {
        const xpChannels = db.getGuildSetting(guildId, 'xp_channels_list', []);
        const channelIds = xpChannels.map(c => c.id);

        // Check if the channel is in the list
        const channelInList = channelIds.includes(channelId);

        // In whitelist mode, skip if channel is not in list
        // In blacklist mode, skip if channel is in list
        if ((xpMode === 'whitelist' && !channelInList) ||
            (xpMode === 'blacklist' && channelInList)) {
            return;
        }
    }

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
            let roleAwarded = [];

            // Get server-specific settings
            const guildLevelUpChannel = db.getGuildSetting(message.guild.id, 'levelup_channel_id', null);
            const guildLevelUpDM = db.getGuildSetting(message.guild.id, 'levelup_dm', null);
            const guildLevelUpPing = db.getGuildSetting(message.guild.id, 'levelup_ping', null);

            // Use server settings if available, otherwise fall back to global config
            const useDM = guildLevelUpDM !== null ? guildLevelUpDM : config.xp.levelUp.dm;
            const pingUser = guildLevelUpPing !== null ? guildLevelUpPing : config.xp.levelUp.pingUser;

            // Get level rewards from guild settings
            const guildRewards = db.getGuildSetting(message.guild.id, 'level_rewards', {});

            // Check for legacy format or new format rewards
            if (guildRewards[newLevel]) {
                if (Array.isArray(guildRewards[newLevel])) {
                    // New format - array of reward objects
                    for (const reward of guildRewards[newLevel]) {
                        const roleId = reward.roleId;
                        const role = message.guild.roles.cache.get(roleId);

                        if (role) {
                            try {
                                await message.member.roles.add(role);
                                roleAwarded.push(role);
                            } catch (err) {
                                console.error(`Failed to add role ${roleId} to user ${userId}:`, err);
                            }
                        }
                    }
                } else {
                    // Legacy format - single role ID string
                    const roleId = guildRewards[newLevel];
                    const role = message.guild.roles.cache.get(roleId);

                    if (role) {
                        try {
                            await message.member.roles.add(role);
                            roleAwarded.push(role);
                        } catch (err) {
                            console.error(`Failed to add role ${roleId} to user ${userId}:`, err);
                        }
                    }
                }
            } else if (config.xp.levelUp.rewards[newLevel]) {
                // Fall back to global config if no guild rewards
                const roleId = config.xp.levelUp.rewards[newLevel];
                const role = message.guild.roles.cache.get(roleId);

                if (role) {
                    try {
                        await message.member.roles.add(role);
                        roleAwarded.push(role);
                    } catch (err) {
                        console.error(`Failed to add role ${roleId} to user ${userId}:`, err);
                    }
                }
            }

            // Create level up message with banner and avatar
            const levelUpEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Level Up!')
                .setDescription(
                    `Congratulations ${pingUser ? message.author : message.author.username}! ` +
                    `You've reached **Level ${newLevel}**!`
                )
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            // Get the base URL from the client
            const baseUrl = client.ugcBaseUrl || 'http://localhost:2100';

            // Try to get the user's custom banner
            const bannerPath = db.getUserUGCPath('banner', userId, guildId);
            if (bannerPath) {
                try {
                    // Create a full URL by combining base URL with path
                    const fullUrl = new URL(bannerPath, baseUrl).toString();
                    console.log(`Adding banner to level-up message: ${fullUrl}`);
                    levelUpEmbed.setImage(fullUrl);
                } catch (error) {
                    console.error('Error setting banner image for level-up:', error);
                }
            }

            // Add role info if roles were awarded
            if (roleAwarded.length > 0) {
                const roleList = roleAwarded.map(r => r.name).join(', ');
                levelUpEmbed.addFields({
                    name: roleAwarded.length === 1 ? 'Reward Unlocked!' : 'Rewards Unlocked!',
                    value: `You've been given the ${roleList} ${roleAwarded.length === 1 ? 'role' : 'roles'}!`
                });
            }

            // Add XP progress information
            const currentXP = result.currentXP;
            const nextLevelXP = db.xpForLevel(newLevel + 1);
            const xpNeeded = nextLevelXP - currentXP;
            const progressPercentage = Math.floor((currentXP / nextLevelXP) * 100);

            // Create progress bar using the same function as in the /level command
            const { createProgressBar } = require('./levelingSystem');
            const progressBar = createProgressBar(progressPercentage);

            // Add progress field to show how far they are to next level
            levelUpEmbed.addFields({
                name: 'Progress to Next Level',
                value: `${progressBar} ${progressPercentage}%\n${currentXP}/${nextLevelXP} XP (${xpNeeded} more needed)`
            });

            // Determine where to send level up message
            let channel = message.channel;

            // Check for guild-specific channel override first
            if (guildLevelUpChannel) {
                const overrideChannel = client.channels.cache.get(guildLevelUpChannel);
                if (overrideChannel) {
                    channel = overrideChannel;
                }
            }
            // If no guild override, check global config
            else if (config.xp.levelUp.channelOverride) {
                const overrideChannel = client.channels.cache.get(config.xp.levelUp.channelOverride);
                if (overrideChannel) {
                    channel = overrideChannel;
                }
            }

            // Send as DM if configured
            if (useDM) {
                try {
                    await message.author.send({ embeds: [levelUpEmbed] });
                } catch (err) {
                    console.error(`Failed to send DM to user ${userId}:`, err);
                    // Fall back to channel if DM fails
                    await channel.send({
                        content: pingUser ? `<@${userId}>` : null,
                        embeds: [levelUpEmbed]
                    });
                }
            } else {
                // Send in channel
                await channel.send({
                    content: pingUser ? `<@${userId}>` : null,
                    embeds: [levelUpEmbed]
                });
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

                    await channel.send({
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