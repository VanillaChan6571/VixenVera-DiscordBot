// Admin setup slash command definitions and handlers
const { ApplicationCommandOptionType, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('./config');

// We'll initialize the database in index.js and pass it to the handlers
let db;

// Command definitions for registration
const commandDefinitions = [
    {
        name: 'syssetup',
        description: 'Configure server-wide settings for the leveling bot',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'reports',
                description: 'Set up a channel for users to report inappropriate banners/avatars',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'channel',
                        description: 'Channel to use for reports',
                        type: ApplicationCommandOptionType.Channel,
                        required: true,
                        channel_types: [ChannelType.GuildText]
                    }
                ]
            },
            {
                name: 'levelup',
                description: 'Configure level up announcements',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'channel',
                        description: 'Channel to send level up announcements (leave empty to use the channel where XP is earned)',
                        type: ApplicationCommandOptionType.Channel,
                        required: false,
                        channel_types: [ChannelType.GuildText]
                    },
                    {
                        name: 'dm',
                        description: 'Whether to send level up messages via DM instead',
                        type: ApplicationCommandOptionType.Boolean,
                        required: false
                    },
                    {
                        name: 'ping',
                        description: 'Whether to ping users in level up messages',
                        type: ApplicationCommandOptionType.Boolean,
                        required: false
                    }
                ]
            },
            {
                name: 'levelrewards',
                description: 'Manage level rewards',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'action',
                        description: 'Action to perform',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: [
                            { name: 'Add Reward', value: 'add' },
                            { name: 'Remove Reward', value: 'remove' },
                            { name: 'List Rewards', value: 'list' }
                        ]
                    },
                    {
                        name: 'level',
                        description: 'Level to add/remove reward for (only for add/remove)',
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                        min_value: 1,
                        max_value: 100
                    },
                    {
                        name: 'role',
                        description: 'Role to award (only for add)',
                        type: ApplicationCommandOptionType.Role,
                        required: false
                    },
                    {
                        name: 'reward_id',
                        description: 'ID of reward to remove (or "all" to remove all rewards for level)',
                        type: ApplicationCommandOptionType.String,
                        required: false
                    },
                    {
                        name: 'destination',
                        description: 'Where to send the reward list (only for list)',
                        type: ApplicationCommandOptionType.String,
                        required: false,
                        choices: [
                            { name: 'DM', value: 'dm' },
                            { name: 'Current Channel', value: 'channel' }
                        ]
                    },
                    {
                        name: 'list_channel',
                        description: 'Channel to send the reward list (only for list with destination=channel)',
                        type: ApplicationCommandOptionType.Channel,
                        required: false,
                        channel_types: [ChannelType.GuildText]
                    }
                ]
            },
            {
                name: 'usercommands',
                description: 'Restrict user commands to specific channels',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'mode',
                        description: 'How to handle command restrictions',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: [
                            { name: 'Enable Restrictions', value: 'enable' },
                            { name: 'Disable Restrictions', value: 'disable' }
                        ]
                    },
                    {
                        name: 'channel',
                        description: 'Channel to allow commands in (required if enabling restrictions)',
                        type: ApplicationCommandOptionType.Channel,
                        required: false,
                        channel_types: [ChannelType.GuildText]
                    }
                ]
            },
            {
                name: 'xpchannels',
                description: 'Configure which channels can earn XP',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'mode',
                        description: 'Whitelist or Blacklist mode',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: [
                            { name: 'Whitelist', value: 'whitelist' },
                            { name: 'Blacklist', value: 'blacklist' },
                            { name: 'Disable Filtering', value: 'disable' }
                        ]
                    },
                    {
                        name: 'channels',
                        description: 'Comma-separated list of channel names or IDs (e.g. "general,bot-commands,gaming")',
                        type: ApplicationCommandOptionType.String,
                        required: false
                    }
                ]
            }
        ]
    }
];

// Initialize database reference (will be set from index.js)
function setDatabase(database) {
    db = database;
    console.log('Setup command handlers connected to database');
}

// Helper function to validate permissions
function hasAdminPermissions(interaction) {
    return interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

// Command handlers
const commandHandlers = {
    async syssetup(interaction) {
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

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // Handle different subcommands
        switch (subcommand) {
            case 'reports':
                return await handleReportsSetup(interaction, guildId);
            case 'levelup':
                return await handleLevelUpSetup(interaction, guildId);
            case 'levelrewards':
                return await handleLevelRewardsSetup(interaction, guildId);
            case 'usercommands':
                return await handleUserCommandsSetup(interaction, guildId);
            case 'xpchannels':
                return await handleXPChannelsSetup(interaction, guildId);
            default:
                return await interaction.reply({
                    content: 'Unknown subcommand. Please try again.',
                    ephemeral: true
                });
        }
    }
};

// Handle Reports setup
async function handleReportsSetup(interaction, guildId) {
    const channel = interaction.options.getChannel('channel');

    try {
        // Update the setting in the database
        await db.updateGuildSetting(guildId, 'report_channel_id', channel.id);

        // Create response embed
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Reports Channel Set')
            .setDescription(`Reports channel has been set to ${channel}.\n\nUsers can now report inappropriate content using \`/ugc report\`.`)
            .setFooter({ text: 'Server Settings' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in reports setup:', error);
        await interaction.reply({
            content: 'There was an error updating the settings.',
            ephemeral: true
        });
    }
}

// Handle LevelUp setup
async function handleLevelUpSetup(interaction, guildId) {
    const channel = interaction.options.getChannel('channel');
    const dm = interaction.options.getBoolean('dm');
    const ping = interaction.options.getBoolean('ping');

    try {
        // Prepare the settings to update
        const settings = {};

        if (channel) {
            settings.levelup_channel_id = channel.id;
        }

        if (dm !== null) {
            settings.levelup_dm = dm;
        }

        if (ping !== null) {
            settings.levelup_ping = ping;
        }

        // Update settings in database
        for (const [key, value] of Object.entries(settings)) {
            await db.updateGuildSetting(guildId, key, value);
        }

        // Create response embed
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Level Up Settings Updated')
            .setDescription('The following level up settings have been updated:')
            .setFooter({ text: 'Server Settings' })
            .setTimestamp();

        if (channel) {
            embed.addFields({ name: 'Level Up Channel', value: `Level up announcements will be sent to ${channel}` });
        }

        if (dm !== null) {
            embed.addFields({ name: 'DM Notifications', value: dm ? 'Enabled' : 'Disabled' });
        }

        if (ping !== null) {
            embed.addFields({ name: 'User Pings', value: ping ? 'Enabled' : 'Disabled' });
        }

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in level up setup:', error);
        await interaction.reply({
            content: 'There was an error updating the settings.',
            ephemeral: true
        });
    }
}

// Handle LevelRewards setup
async function handleLevelRewardsSetup(interaction, guildId) {
    const action = interaction.options.getString('action');
    const level = interaction.options.getInteger('level');
    const role = interaction.options.getRole('role');
    const rewardId = interaction.options.getString('reward_id');
    const destination = interaction.options.getString('destination') || 'channel';
    const listChannel = interaction.options.getChannel('list_channel');

    try {
        // Get current rewards
        let rewards = db.getGuildSetting(guildId, 'level_rewards', {});

        // If rewards is not an object, initialize it
        if (typeof rewards !== 'object' || rewards === null) {
            rewards = {};
        }

        switch (action) {
            case 'add':
                if (!level || !role) {
                    return await interaction.reply({
                        content: 'Please provide both a level and a role when adding a reward.',
                        ephemeral: true
                    });
                }

                // Create the level entry if it doesn't exist
                if (!rewards[level]) {
                    rewards[level] = [];
                } else if (!Array.isArray(rewards[level])) {
                    // Convert from old format (single roleId string) to new format (array of objects)
                    rewards[level] = [{ id: "1", roleId: rewards[level] }];
                }

                // Generate a simple ID for the reward
                const newId = Date.now().toString().substring(9);

                // Add the reward
                rewards[level].push({
                    id: newId,
                    roleId: role.id,
                    roleName: role.name
                });

                // Save back to database
                await db.updateGuildSetting(guildId, 'level_rewards', rewards);

                // Create response embed
                const addEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('Level Reward Added')
                    .setDescription(`Role ${role} will now be awarded at Level ${level}`)
                    .setFooter({ text: 'Server Settings • Use /syssetup levelrewards list to see all rewards' })
                    .setTimestamp();

                await interaction.reply({ embeds: [addEmbed] });
                break;

            case 'remove':
                if (!level) {
                    return await interaction.reply({
                        content: 'Please provide a level when removing a reward.',
                        ephemeral: true
                    });
                }

                if (!rewards[level] || (Array.isArray(rewards[level]) && rewards[level].length === 0)) {
                    return await interaction.reply({
                        content: `No rewards found for Level ${level}.`,
                        ephemeral: true
                    });
                }

                // Handle multiple rewards for the same level
                if (Array.isArray(rewards[level]) && rewards[level].length > 1 && !rewardId) {
                    // List the rewards with their IDs
                    const rewardsList = rewards[level].map(reward =>
                        `ID: ${reward.id} - Role: ${reward.roleName || `<@&${reward.roleId}>`}`
                    ).join('\n');

                    const listEmbed = new EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle(`Multiple Rewards for Level ${level}`)
                        .setDescription('Please specify which reward to remove using the reward_id parameter:')
                        .addFields({ name: 'Available Rewards', value: rewardsList })
                        .setFooter({ text: 'Use /syssetup levelrewards remove level:X reward_id:Y' })
                        .setTimestamp();

                    return await interaction.reply({ embeds: [listEmbed], ephemeral: true });
                }

                // Remove the specified reward or all rewards for the level
                if (rewardId === 'all') {
                    delete rewards[level];
                } else if (rewardId) {
                    if (Array.isArray(rewards[level])) {
                        const initialLength = rewards[level].length;
                        rewards[level] = rewards[level].filter(reward => reward.id !== rewardId);

                        if (rewards[level].length === initialLength) {
                            return await interaction.reply({
                                content: `No reward with ID ${rewardId} found for Level ${level}.`,
                                ephemeral: true
                            });
                        }

                        if (rewards[level].length === 0) {
                            delete rewards[level];
                        }
                    } else {
                        // Old format - just delete the level entry
                        delete rewards[level];
                    }
                } else {
                    // Single reward or old format - just delete the level entry
                    delete rewards[level];
                }

                // Save back to database
                await db.updateGuildSetting(guildId, 'level_rewards', rewards);

                // Create response embed
                const removeEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('Level Reward Removed')
                    .setDescription(rewardId === 'all'
                        ? `All rewards for Level ${level} have been removed`
                        : `Reward ${rewardId ? `with ID ${rewardId} ` : ''}for Level ${level} has been removed`)
                    .setFooter({ text: 'Server Settings' })
                    .setTimestamp();

                await interaction.reply({ embeds: [removeEmbed] });
                break;

            case 'list':
                // If there are no rewards, return early
                if (Object.keys(rewards).length === 0) {
                    return await interaction.reply({
                        content: 'No level rewards have been set up for this server.',
                        ephemeral: true
                    });
                }

                // Sort levels
                const sortedLevels = Object.keys(rewards).map(Number).sort((a, b) => a - b);

                // Build reward list
                let rewardText = '';
                for (const level of sortedLevels) {
                    if (Array.isArray(rewards[level]) && rewards[level].length > 0) {
                        rewardText += `**Level ${level}**\n`;
                        for (const reward of rewards[level]) {
                            rewardText += `• ID: ${reward.id} - Role: ${reward.roleName || `<@&${reward.roleId}>`}\n`;
                        }
                        rewardText += '\n';
                    } else if (rewards[level]) {
                        // Old format (single role ID)
                        rewardText += `**Level ${level}**\n• Role: <@&${rewards[level]}>\n\n`;
                    }
                }

                // Create response embed
                const listEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('Level Rewards')
                    .setDescription('These roles will be awarded when users reach the specified levels:')
                    .addFields({ name: 'Rewards', value: rewardText })
                    .setFooter({ text: 'Server Settings • Use /syssetup levelrewards to manage these rewards' })
                    .setTimestamp();

                // Send the list to the appropriate destination
                if (destination === 'dm') {
                    try {
                        await interaction.user.send({ embeds: [listEmbed] });
                        await interaction.reply({
                            content: 'Level rewards list has been sent to your DMs.',
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error('Error sending DM:', error);
                        await interaction.reply({
                            content: 'Unable to send DM. Please check your privacy settings and try again.',
                            ephemeral: true
                        });
                    }
                } else {
                    // Send to specified channel or current channel
                    if (listChannel) {
                        try {
                            await listChannel.send({ embeds: [listEmbed] });
                            await interaction.reply({
                                content: `Level rewards list has been sent to ${listChannel}.`,
                                ephemeral: true
                            });
                        } catch (error) {
                            console.error('Error sending to channel:', error);
                            await interaction.reply({
                                content: `Unable to send message to ${listChannel}. Please check bot permissions and try again.`,
                                ephemeral: true
                            });
                        }
                    } else {
                        await interaction.reply({ embeds: [listEmbed] });
                    }
                }
                break;

            default:
                await interaction.reply({
                    content: 'Invalid action. Please use add, remove, or list.',
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error('Error in level rewards setup:', error);
        await interaction.reply({
            content: 'There was an error managing level rewards.',
            ephemeral: true
        });
    }
}

// Handle UserCommands setup
async function handleUserCommandsSetup(interaction, guildId) {
    const mode = interaction.options.getString('mode');
    const channel = interaction.options.getChannel('channel');

    try {
        if (mode === 'enable' && !channel) {
            return await interaction.reply({
                content: 'Please provide a channel when enabling command restrictions.',
                ephemeral: true
            });
        }

        // Update settings
        await db.updateGuildSetting(guildId, 'command_restrictions_enabled', mode === 'enable');

        if (channel) {
            await db.updateGuildSetting(guildId, 'command_channel_id', channel.id);
        }

        // Create response embed
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('User Commands Settings Updated')
            .setDescription(mode === 'enable'
                ? `User commands are now restricted to ${channel}`
                : 'User commands can now be used in any channel')
            .setFooter({ text: 'Server Settings' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in user commands setup:', error);
        await interaction.reply({
            content: 'There was an error updating the settings.',
            ephemeral: true
        });
    }
}

// Handle XPChannels setup
async function handleXPChannelsSetup(interaction, guildId) {
    const mode = interaction.options.getString('mode');
    const channelsInput = interaction.options.getString('channels');

    try {
        // Update mode setting
        await db.updateGuildSetting(guildId, 'xp_channels_mode', mode);

        let processedChannels = [];

        // Process channels if provided
        if (channelsInput && mode !== 'disable') {
            // Split by commas and trim whitespace
            const channelNames = channelsInput.split(',').map(c => c.trim());

            // Process each channel
            for (const channelRef of channelNames) {
                // Try to find the channel (by name or ID)
                let channel;

                // Check if it's an ID (strip <# and > if present for mentions)
                const cleanId = channelRef.replace(/^<#|>$/g, '');
                if (/^\d+$/.test(cleanId)) {
                    channel = interaction.guild.channels.cache.get(cleanId);
                }

                // If not found by ID, try by name
                if (!channel) {
                    channel = interaction.guild.channels.cache.find(
                        c => c.name.toLowerCase() === channelRef.toLowerCase() && c.type === ChannelType.GuildText
                    );
                }

                if (channel) {
                    processedChannels.push({
                        id: channel.id,
                        name: channel.name
                    });
                }
            }

            // Save the processed channels
            await db.updateGuildSetting(guildId, 'xp_channels_list', processedChannels);
        } else if (mode === 'disable') {
            // Clear the channel list if disabling
            await db.updateGuildSetting(guildId, 'xp_channels_list', []);
        }

        // Create response embed
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('XP Channel Settings Updated')
            .setFooter({ text: 'Server Settings' })
            .setTimestamp();

        if (mode === 'disable') {
            embed.setDescription('XP channel filtering has been disabled. Users can earn XP in all channels.');
        } else {
            embed.setDescription(`XP channel mode set to **${mode}**`);

            if (processedChannels.length > 0) {
                const channelList = processedChannels.map(c => `<#${c.id}>`).join(', ');
                embed.addFields({
                    name: mode === 'whitelist' ? 'XP Allowed In' : 'XP Blocked In',
                    value: channelList
                });
            } else {
                embed.addFields({
                    name: 'No Channels Configured',
                    value: mode === 'whitelist'
                        ? 'Warning: No channels are currently whitelisted. Users cannot earn XP anywhere.'
                        : 'No channels are blacklisted. Users can earn XP everywhere.'
                });
            }
        }

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in XP channels setup:', error);
        await interaction.reply({
            content: 'There was an error updating the settings.',
            ephemeral: true
        });
    }
}

module.exports = {
    definitions: commandDefinitions,
    handlers: commandHandlers,
    setDatabase
};