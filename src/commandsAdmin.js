// Admin slash command definitions and handlers
const { ApplicationCommandOptionType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

// We'll initialize the database in index.js and pass it to the handlers
let db;

// Command definitions for registration
const commandDefinitions = [
    {
        name: 'systoggle',
        description: 'Configure user content features for this server',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'feature',
                description: 'The feature to configure',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'User Avatars', value: 'avatar' },
                    { name: 'User Banners', value: 'banner' }
                ]
            },
            {
                name: 'enabled',
                description: 'Whether to enable or disable the feature',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            },
            {
                name: 'mode',
                description: 'Advanced mode setting (overrides enabled/disabled)',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: 'Allow User Content', value: 'allow_user' },
                    { name: 'Server-Only Content', value: 'server_only' }
                ]
            }
        ]
    },
    {
        name: 'sysguild',
        description: 'Set server-wide default content',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'type',
                description: 'The type of content to set',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Banner', value: 'banner' },
                    { name: 'Avatar', value: 'avatar' },
                    { name: 'Blacklist', value: 'blacklist' }
                ]
            },
            {
                name: 'url',
                description: 'URL to the image (must be a direct image link, not needed for blacklist)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'action',
                description: 'Action for blacklist (add or remove)',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: 'Add User', value: 'add' },
                    { name: 'Remove User', value: 'remove' }
                ]
            },
            {
                name: 'userid',
                description: 'User ID to add/remove from blacklist',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    },
    {
        name: 'sysdebug',
        description: 'Debug guild settings',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'action',
                description: 'What action to take',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Check Settings', value: 'check' },
                    { name: 'Fix Settings', value: 'fix' }
                ]
            }
        ]
    },
    {
        name: 'syscall',
        description: 'Owner-only system commands',
        defaultMemberPermissions: PermissionFlagsBits.Administrator,
        options: [
            {
                name: 'command',
                description: 'The command to execute',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Global Blacklist', value: 'gblacklist' }
                ]
            },
            {
                name: 'action',
                description: 'Action to perform',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Add User', value: 'add' },
                    { name: 'Remove User', value: 'remove' }
                ]
            },
            {
                name: 'userid',
                description: 'User ID to act upon',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    }
];

const debugCommandDefinition = {
    name: 'ugcdebug',
    description: 'Debug a user\'s UGC content settings',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    options: [
        {
            name: 'user',
            description: 'The user to check (leave empty for yourself)',
            type: ApplicationCommandOptionType.User,
            required: false
        },
        {
            name: 'verbose',
            description: 'Show all database entries for the user',
            type: ApplicationCommandOptionType.Boolean,
            required: false
        }
    ]
};

// Initialize database reference (will be set from index.js)
function setDatabase(database) {
    db = database;
    console.log('Admin command handlers connected to database');
}

// Check if user has admin permissions
function hasAdminPermissions(interaction) {
    return interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

// Check if user is the bot owner
function isOwner(interaction) {
    const ownerId = interaction.client.config?.bot?.ownerId || '233055065588367370';
    return interaction.user.id === ownerId;
}

// Command handlers
const commandHandlers = {
    // systoggle command handler with integrated guild-only functionality
    async systoggle(interaction) {
        if (!db) {
            return await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
        }

        // Check if user has permissions
        if (!hasAdminPermissions(interaction)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const feature = interaction.options.getString('feature');
        const enabled = interaction.options.getBoolean('enabled');
        const mode = interaction.options.getString('mode');
        const guildId = interaction.guild.id;

        try {
            // If mode is provided, it takes precedence over enabled
            if (mode) {
                if (mode === 'allow_user') {
                    // Enable user content, disable server-only mode
                    await db.updateGuildSetting(guildId, `allow_user_${feature}`, true);
                    await db.updateGuildSetting(guildId, `guild_only_${feature}`, false);

                    // Create response embed
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('Feature Setting Updated')
                        .setDescription(`User-generated ${feature} content is now enabled on this server.`)
                        .setFooter({text: 'Server Settings'})
                        .setTimestamp();

                    await interaction.reply({embeds: [embed]});
                } else if (mode === 'server_only') {
                    // Enable server-only mode, but keep user content enabled for backward compatibility
                    await db.updateGuildSetting(guildId, `guild_only_${feature}`, true);
                    await db.updateGuildSetting(guildId, `allow_user_${feature}`, true);

                    // Create response embed
                    const embed = new EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle('Server-Only Setting Updated')
                        .setDescription(`${feature.charAt(0).toUpperCase() + feature.slice(1)} is now set to only use server-defined content.`)
                        .setFooter({text: 'Server Settings'})
                        .setTimestamp();

                    await interaction.reply({embeds: [embed]});
                }
            }
            // If only enabled/disabled is provided (original behavior)
            else if (enabled !== null) {
                // Update the setting in the database
                const result = await db.updateGuildSetting(guildId, `allow_user_${feature}`, enabled);

                // Create response embed
                const embed = new EmbedBuilder()
                    .setColor(enabled ? '#00ff00' : '#ff0000')
                    .setTitle('Feature Setting Updated')
                    .setDescription(`User-generated ${feature} content is now ${enabled ? 'enabled' : 'disabled'} on this server.`)
                    .setFooter({text: 'Server Settings'})
                    .setTimestamp();

                await interaction.reply({embeds: [embed]});
            }
            // No parameters provided
            else {
                return await interaction.reply({
                    content: 'Please provide either the `enabled` parameter or the `mode` parameter.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error in systoggle command:', error);
            await interaction.reply({
                content: 'There was an error updating the settings.',
                ephemeral: true
            });
        }
    },

    // sysguild command handler
    async sysguild(interaction) {
        if (!db) {
            return await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
        }

        // Check if user has permissions
        if (!hasAdminPermissions(interaction)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const type = interaction.options.getString('type');
        const url = interaction.options.getString('url');
        const guildId = interaction.guild.id;

        // Handle blacklist type separately
        if (type === 'blacklist') {
            const action = interaction.options.getString('action');
            const userId = interaction.options.getString('userid');

            if (!action || !userId) {
                return await interaction.reply({
                    content: 'For blacklist operations, both action and userid are required.',
                    ephemeral: true
                });
            }

            try {
                if (action === 'add') {
                    // Add user to server blacklist
                    await db.updateGuildSetting(`user_${userId}_${guildId}`, 'content_blacklisted', true);

                    // Create response embed
                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('User Blacklisted')
                        .setDescription(`User with ID ${userId} has been blacklisted from uploading custom content in this server.`)
                        .setFooter({text: 'Server Settings'})
                        .setTimestamp();

                    await interaction.reply({embeds: [embed]});
                } else if (action === 'remove') {
                    // Remove user from server blacklist
                    await db.updateGuildSetting(`user_${userId}_${guildId}`, 'content_blacklisted', false);

                    // Create response embed
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('User Removed from Blacklist')
                        .setDescription(`User with ID ${userId} has been removed from the content blacklist in this server.`)
                        .setFooter({text: 'Server Settings'})
                        .setTimestamp();

                    await interaction.reply({embeds: [embed]});
                }
            } catch (error) {
                console.error('Error in blacklist operation:', error);
                await interaction.reply({
                    content: 'There was an error processing the blacklist operation.',
                    ephemeral: true
                });
            }

            return;
        }

        // Handle standard content types (banner/avatar)
        try {
            // Check if URL is provided - if not, switch to DM upload mode
            if (!url) {
                // Import handleAdminUploadRequest only if we need it
                const {handleAdminUploadRequest} = require('./ugc');

                // Use the new upload via DM method
                return await handleAdminUploadRequest(interaction, type, guildId);
            }

            // Continue with URL-based upload if URL is provided
            // Validate URL format (basic check)
            if (!url.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
                return await interaction.reply({
                    content: 'Please provide a valid direct image URL (ending with .jpg, .png, .gif, or .webp).',
                    ephemeral: true
                });
            }

            // Update the setting in the database
            const result = await db.updateGuildSetting(guildId, `default_${type}_url`, url);

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Server Default Updated')
                .setDescription(`Default server ${type} has been updated.`)
                .setImage(url)
                .setFooter({text: 'Server Settings'})
                .setTimestamp();

            await interaction.reply({embeds: [embed]});
        } catch (error) {
            console.error('Error in sysguild command:', error);
            await interaction.reply({
                content: 'There was an error updating the settings.',
                ephemeral: true
            });
        }
    },
    // Add this to commandHandlers object
    async sysdebug(interaction) {
        if (!db) {
            return await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
        }

        // Check if user has permissions
        if (!hasAdminPermissions(interaction)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const action = interaction.options.getString('action');
        const guildId = interaction.guild.id;

        try {
            if (action === 'check') {
                // Get all relevant settings
                const guildOnlyBanner = db.getGuildSetting(guildId, 'guild_only_banner', false);
                const allowUserBanner = db.getGuildSetting(guildId, 'allow_user_banner', true);
                const guildOnlyAvatar = db.getGuildSetting(guildId, 'guild_only_avatar', false);
                const allowUserAvatar = db.getGuildSetting(guildId, 'allow_user_avatar', true);
                const defaultBannerUrl = db.getGuildSetting(guildId, 'default_banner_url', null);
                const defaultAvatarUrl = db.getGuildSetting(guildId, 'default_avatar_url', null);

                // Create response embed
                const embed = new EmbedBuilder()
                    .setColor('#00aaff')
                    .setTitle('Guild UGC Settings')
                    .addFields(
                        {
                            name: 'Banner Settings', value:
                                `Guild-only mode: ${guildOnlyBanner ? '✅ ON' : '❌ OFF'}\n` +
                                `Allow user content: ${allowUserBanner ? '✅ ON' : '❌ OFF'}\n` +
                                `Default banner: ${defaultBannerUrl ? '✅ Set' : '❌ Not set'}`
                        },
                        {
                            name: 'Avatar Settings', value:
                                `Guild-only mode: ${guildOnlyAvatar ? '✅ ON' : '❌ OFF'}\n` +
                                `Allow user content: ${allowUserAvatar ? '✅ ON' : '❌ OFF'}\n` +
                                `Default avatar: ${defaultAvatarUrl ? '✅ Set' : '❌ Not set'}`
                        }
                    )
                    .setFooter({text: `Guild ID: ${guildId}`})
                    .setTimestamp();

                return await interaction.reply({embeds: [embed]});
            } else if (action === 'fix') {
                // Turn off guild-only mode and enable user content
                await db.updateGuildSetting(guildId, 'guild_only_banner', false);
                await db.updateGuildSetting(guildId, 'allow_user_banner', true);
                await db.updateGuildSetting(guildId, 'guild_only_avatar', false);
                await db.updateGuildSetting(guildId, 'allow_user_avatar', true);

                // Create response embed
                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('Guild UGC Settings Fixed')
                    .setDescription('All content settings have been reset to allow users to use their custom content.')
                    .setFooter({text: `Guild ID: ${guildId}`})
                    .setTimestamp();

                return await interaction.reply({embeds: [embed]});
            }
        } catch (error) {
            console.error('Error in sysdebug command:', error);
            return await interaction.reply({
                content: 'There was an error processing the debug command.',
                ephemeral: true
            });
        }
    },
    // UGC Debug
    async function ugcDebugHandler(interaction) {
        if (!db) {
            return await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
        }

        // Check if user has permissions
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const verbose = interaction.options.getBoolean('verbose') || false;
        const guildId = interaction.guild.id;
        const userId = targetUser.id;

        try {
            // Start fetching settings
            await interaction.deferReply();

            // Get user-specific settings
            const userBannerPath = db.getGuildSetting(`user_${userId}_${guildId}`, 'banner_url', null);
            const userAvatarPath = db.getGuildSetting(`user_${userId}_${guildId}`, 'avatar_url', null);

            // Get guild settings
            const guildOnlyBanner = db.getGuildSetting(guildId, 'guild_only_banner', false);
            const allowUserBanner = db.getGuildSetting(guildId, 'allow_user_banner', true);
            const guildDefaultBanner = db.getGuildSetting(guildId, 'default_banner_url', null);

            const guildOnlyAvatar = db.getGuildSetting(guildId, 'guild_only_avatar', false);
            const allowUserAvatar = db.getGuildSetting(guildId, 'allow_user_avatar', true);
            const guildDefaultAvatar = db.getGuildSetting(guildId, 'default_avatar_url', null);

            // Get what would actually be displayed
            const {getUserUGCPath} = require('./ugc');  // Make sure to import correctly
            const actualBannerPath = getUserUGCPath(db, 'banner', userId, guildId);
            const actualAvatarPath = getUserUGCPath(db, 'avatar', userId, guildId);

            // Create the debugging embed
            const embed = new EmbedBuilder()
                .setColor('#00aaff')
                .setTitle(`UGC Debug for ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({dynamic: true}))
                .addFields(
                    {
                        name: '🖼️ Banner Status',
                        value: userBannerPath
                            ? `✅ User has uploaded a banner: \`${userBannerPath}\``
                            : `❌ User has not uploaded a banner`
                    },
                    {
                        name: '🖼️ Avatar Status',
                        value: userAvatarPath
                            ? `✅ User has uploaded an avatar: \`${userAvatarPath}\``
                            : `❌ User has not uploaded an avatar`
                    },
                    {
                        name: '🔍 Banner Display Logic',
                        value: `Guild-only mode: ${guildOnlyBanner ? '✅ ON' : '❌ OFF'}\n` +
                            `Allow user content: ${allowUserBanner ? '✅ ON' : '❌ OFF'}\n` +
                            `User has banner: ${userBannerPath ? '✅ YES' : '❌ NO'}\n` +
                            `Guild has default: ${guildDefaultBanner ? '✅ YES' : '❌ NO'}\n` +
                            `-------------------\n` +
                            `Actual banner path: ${actualBannerPath || 'None'}`
                    },
                    {
                        name: '🔍 Avatar Display Logic',
                        value: `Guild-only mode: ${guildOnlyAvatar ? '✅ ON' : '❌ OFF'}\n` +
                            `Allow user content: ${allowUserAvatar ? '✅ ON' : '❌ OFF'}\n` +
                            `User has avatar: ${userAvatarPath ? '✅ YES' : '❌ NO'}\n` +
                            `Guild has default: ${guildDefaultAvatar ? '✅ YES' : '❌ NO'}\n` +
                            `-------------------\n` +
                            `Actual avatar path: ${actualAvatarPath || 'None'}`
                    }
                )
                .setFooter({text: `User ID: ${userId} | Guild ID: ${guildId}`})
                .setTimestamp();

            // Show the banner image if available
            if (actualBannerPath) {
                const baseUrl = interaction.client.ugcBaseUrl || 'http://localhost:2100';
                try {
                    // Create a full URL by combining base URL with path
                    const fullUrl = new URL(actualBannerPath, baseUrl).toString();
                    embed.setImage(fullUrl);
                } catch (error) {
                    console.error('Error setting banner image URL:', error);
                    embed.addFields({name: '⚠️ Error', value: `Could not create valid URL from: ${actualBannerPath}`});
                }
            }

            // For verbose mode, get all database entries for this user
            if (verbose) {
                try {
                    // Get all settings with this user's ID prefix
                    const allSettings = db.getAllGuildSettings(guildId);
                    const userSettings = {};

                    for (const [key, value] of Object.entries(allSettings)) {
                        if (key.includes(`user_${userId}`)) {
                            userSettings[key] = value;
                        }
                    }

                    if (Object.keys(userSettings).length > 0) {
                        let settingsText = '';
                        for (const [key, value] of Object.entries(userSettings)) {
                            settingsText += `${key}: ${value}\n`;
                        }

                        embed.addFields({name: '🔍 All User Settings', value: settingsText || 'No settings found'});
                    } else {
                        embed.addFields({name: '🔍 All User Settings', value: 'No settings found for this user'});
                    }
                } catch (error) {
                    console.error('Error getting all settings:', error);
                    embed.addFields({name: '⚠️ Error', value: 'Could not retrieve all user settings'});
                }
            }

            // Send the debug information
            await interaction.editReply({embeds: [embed]});

            // Additional debug info in console
            console.log(`=== UGC DEBUG FOR USER ${userId} IN GUILD ${guildId} ===`);
            console.log('User Banner Path:', userBannerPath);
            console.log('User Avatar Path:', userAvatarPath);
            console.log('Guild Settings:', {
                guildOnlyBanner,
                allowUserBanner,
                guildDefaultBanner,
                guildOnlyAvatar,
                allowUserAvatar,
                guildDefaultAvatar
            });
            console.log('Actual Display Paths:', {
                banner: actualBannerPath,
                avatar: actualAvatarPath
            });

        } catch (error) {
            console.error('Error in ugcdebug command:', error);

            if (interaction.deferred) {
                await interaction.editReply({
                    content: 'There was an error processing your debug request.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: 'There was an error processing your debug request.',
                    ephemeral: true
                });
            }
        }
    }
}

module.exports = {
    definitions: commandDefinitions,
    handlers: commandHandlers,
    debugCommandDefinition,
    ugcDebugHandler,
    setDatabase
};