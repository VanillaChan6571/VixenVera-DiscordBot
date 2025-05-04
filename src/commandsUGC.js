// UGC (User Generated Content) commands
const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const ugc = require('./ugc');

// Command definitions for registration
const commandDefinitions = [
    {
        name: 'ugc',
        description: 'Upload your own custom images for the leveling system',
        options: [
            {
                name: 'type',
                description: 'Type of content to upload',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Banner', value: 'banner' },
                    { name: 'Avatar', value: 'avatar' }
                ]
            }
        ]
    },
    {
        name: 'sysupload',
        description: 'Upload server-wide default images for the leveling system',
        defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
        options: [
            {
                name: 'type',
                description: 'Type of content to upload',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Banner', value: 'banner' },
                    { name: 'Avatar', value: 'avatar' }
                ]
            }
        ]
    }
];

// Command handlers
const commandHandlers = {
    // User upload handler
    async ugc(interaction) {
        const type = interaction.options.getString('type');
        await ugc.handleUploadRequest(interaction, type, false);
    },

    // Staff/Admin upload handler
    async sysupload(interaction) {
        // Check if user has permissions
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const type = interaction.options.getString('type');
        await ugc.handleUploadRequest(interaction, type, true);
    }
};

module.exports = {
    definitions: commandDefinitions,
    handlers: commandHandlers
};