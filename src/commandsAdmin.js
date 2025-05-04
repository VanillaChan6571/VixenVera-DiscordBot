// Admin slash command definitions and handlers
const { ApplicationCommandOptionType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

// We'll initialize the database in index.js and pass it to the handlers
let db;

// Command definitions for registration
// Command definitions for registration
const commandDefinitions = [
    {
        name: 'systoggle',
        description: 'Toggle user content features for this server',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'feature',
                description: 'The feature to toggle',
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
                required: true
            }
        ]
    },
    {
        name: 'sysguildonly',
        description: 'Set a feature to only use server-defined content',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'feature',
                description: 'The feature to set to guild-only mode',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Banner', value: 'banner' }
                ]
            },
            {
                name: 'enabled',
                description: 'Whether to enable or disable guild-only mode',
                type: ApplicationCommandOptionType.Boolean,
                required: true
            }
        ]
    },
    {
        name: 'sysguildonly',
        description: 'Set a feature to only use server-defined content',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'feature',
                description: 'The feature to set to guild-only mode',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Banner', value: 'banner' }
                ]
            },
            {
                name: 'enabled',
                description: 'Whether to enable or disable guild-only mode',
                type: ApplicationCommandOptionType.Boolean,
                required: true
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
                    { name: 'Banner', value: 'banner' }
                ]
            },
            {
                name: 'url',
                description: 'URL to the image (must be a direct image link)',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    }
];

// Initialize database reference (will be set from index.js)
function setDatabase(database) {
    db = database;
    console.log('Admin command handlers connected to database');
}

// Check if user has admin permissions
function hasAdminPermissions(interaction) {
    return interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

// Command handlers
const commandHandlers = {
    // systoggle command handler
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
        const guildId = interaction.guild.id;

        try {
            // Update the setting in the database
            const result = await db.updateGuildSetting(guildId, `allow_user_${feature}`, enabled);

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor(enabled ? '#00ff00' : '#ff0000')
                .setTitle('Feature Setting Updated')
                .setDescription(`User-generated ${feature} content is now ${enabled ? 'enabled' : 'disabled'} on this server.`)
                .setFooter({ text: 'Server Settings' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in systoggle command:', error);
            await interaction.reply({
                content: 'There was an error updating the settings.',
                ephemeral: true
            });
        }
    },

    // sysguildonly command handler
    async sysguildonly(interaction) {
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
        const guildId = interaction.guild.id;

        try {
            // Update the setting in the database
            const result = await db.updateGuildSetting(guildId, `guild_only_${feature}`, enabled);

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor(enabled ? '#00ff00' : '#ff0000')
                .setTitle('Server-Only Setting Updated')
                .setDescription(`${feature.charAt(0).toUpperCase() + feature.slice(1)} is now set to ${enabled ? 'only use server-defined content' : 'allow user content'}.`)
                .setFooter({ text: 'Server Settings' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in sysguildonly command:', error);
            await interaction.reply({
                content: 'There was an error updating the settings.',
                ephemeral: true
            });
        }
    }
};

module.exports = {
    definitions: commandDefinitions,
    handlers: commandHandlers,
    setDatabase
};