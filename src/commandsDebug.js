const { ApplicationCommandOptionType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Command definition for debugging user content
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

// Command handler for debugging user content
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
        const { getUserUGCPath } = require('./ugc');  // Make sure to import correctly
        const actualBannerPath = getUserUGCPath(db, 'banner', userId, guildId);
        const actualAvatarPath = getUserUGCPath(db, 'avatar', userId, guildId);

        // Create the debugging embed
        const embed = new EmbedBuilder()
            .setColor('#00aaff')
            .setTitle(`UGC Debug for ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
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
            .setFooter({ text: `User ID: ${userId} | Guild ID: ${guildId}` })
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
                embed.addFields({ name: '⚠️ Error', value: `Could not create valid URL from: ${actualBannerPath}` });
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

                    embed.addFields({ name: '🔍 All User Settings', value: settingsText || 'No settings found' });
                } else {
                    embed.addFields({ name: '🔍 All User Settings', value: 'No settings found for this user' });
                }
            } catch (error) {
                console.error('Error getting all settings:', error);
                embed.addFields({ name: '⚠️ Error', value: 'Could not retrieve all user settings' });
            }
        }

        // Send the debug information
        await interaction.editReply({ embeds: [embed] });

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

module.exports = {
    definitions: [debugCommandDefinition],
    handlers: {
        ugcdebug: ugcDebugHandler
    },
    setDatabase: function(database) {
        db = database;
        console.log('Debug command handlers connected to database');
    }
};