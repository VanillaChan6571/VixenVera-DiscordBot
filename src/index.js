// Discord Leveling Bot - Main File
const {
    Client,
    GatewayIntentBits,
    ActivityType,
    REST,
    Routes
} = require('discord.js');

// Load modules
const config = require('./config');
const { LevelingDB, XPCooldownManager, generateXP } = require('./levelingSystem');
const { definitions: commandDefinitions, handlers: commandHandlers } = require('./commands');

// Initialize client with required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize database and cooldown manager
const db = new LevelingDB();
const cooldownManager = new XPCooldownManager();

// Function to register slash commands
async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');

        const rest = new REST({ version: '10' }).setToken(config.bot.token);

        await rest.put(
            Routes.applicationCommands(config.bot.clientId),
            { body: commandDefinitions }
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

    // Find handler for this command
    const handler = commandHandlers[commandName];

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

// Process messages for XP
client.on('messageCreate', async message => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) return;

    // Get user ID
    const userId = message.author.id;

    // Check if user is on cooldown
    if (cooldownManager.isOnCooldown(userId)) return;

    // Set new cooldown
    cooldownManager.setCooldown(userId);

    // Give XP to user
    const xpToAdd = generateXP();
    const result = db.addXP(userId, xpToAdd);

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
        const { EmbedBuilder } = require('discord.js');
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
    }
});

// Login the bot
client.login(config.bot.token);

// Error handling for client
client.on('error', err => {
    console.error('Discord client error:', err);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});