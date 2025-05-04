// UGC reporting functionality with improved report display and admin actions
const {
    EmbedBuilder,
    ApplicationCommandOptionType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    ModalBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { createContentReportEmbed } = require('./report-utils');

// Add the report option to UGC command definitions
function extendUGCCommands(existingDefinitions) {
    // Find the ugc command
    const ugcCommand = existingDefinitions.find(cmd => cmd.name === 'ugc');

    if (ugcCommand && ugcCommand.options) {
        // Add report to the choices if it doesn't exist
        const typeOption = ugcCommand.options.find(opt => opt.name === 'type');

        if (typeOption && typeOption.choices) {
            const hasReport = typeOption.choices.some(choice => choice.value === 'report');

            if (!hasReport) {
                typeOption.choices.push({ name: 'Report Content', value: 'report' });
            }
        }

        // Add user parameter for the report command
        if (!ugcCommand.options.find(opt => opt.name === 'user')) {
            ugcCommand.options.push({
                name: 'user',
                description: 'User whose content you want to report',
                type: ApplicationCommandOptionType.User,
                required: false
            });
        }
    }

    return existingDefinitions;
}

// Handler for the report option
async function handleReportRequest(interaction) {
    try {
        const guildId = interaction.guild.id;
        const db = interaction.client.levelingDB;

        // Check if reporting is set up
        const reportChannelId = db.getGuildSetting(guildId, 'report_channel_id', null);

        if (!reportChannelId) {
            return await interaction.reply({
                content: 'Unable to report a user due to the following: No Report Channel Set or Made. Please Contact an Admin About this if possible.',
                ephemeral: true
            });
        }

        // Check if the report channel exists and is accessible
        const reportChannel = interaction.guild.channels.cache.get(reportChannelId);

        if (!reportChannel) {
            return await interaction.reply({
                content: 'Unable to submit report. The configured report channel no longer exists. Please contact a server administrator.',
                ephemeral: true
            });
        }

        // Get user from options
        const reportedUser = interaction.options.getUser('user');

        if (!reportedUser) {
            return await interaction.reply({
                content: 'Please specify a user to report using the user parameter.',
                ephemeral: true
            });
        }

        // Step 1: Ask what content type they're reporting with a dropdown
        const contentTypeRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`report_content_type_${reportedUser.id}`)
                    .setPlaceholder('Select content type')
                    .addOptions([
                        {
                            label: 'Banner',
                            description: 'Report the user\'s banner image',
                            value: 'Banner',
                        },
                        {
                            label: 'Avatar',
                            description: 'Report the user\'s profile picture',
                            value: 'Avatar',
                        },
                    ]),
            );

        await interaction.reply({
            content: `What content of ${reportedUser} are you reporting?`,
            components: [contentTypeRow],
            ephemeral: true
        });

        // Create a collector for the content type selection
        const contentTypeFilter = i =>
            i.customId === `report_content_type_${reportedUser.id}` &&
            i.user.id === interaction.user.id;

        const contentTypeCollector = interaction.channel.createMessageComponentCollector({
            filter: contentTypeFilter,
            time: 60000,
            max: 1
        });

        contentTypeCollector.on('collect', async contentTypeInteraction => {
            // Get the selected content type
            const contentType = contentTypeInteraction.values[0];

            // Step 2: Now ask about violation type with a dropdown
            const violationTypeRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`report_violation_type_${reportedUser.id}`)
                        .setPlaceholder('Select violation type')
                        .addOptions([
                            {
                                label: '1. Sexual Content',
                                description: 'Inappropriate sexual content',
                                value: 'sexual',
                            },
                            {
                                label: '2. Child Exploitation',
                                description: 'Content that exploits or endangers children',
                                value: 'child_exploitation',
                            },
                            {
                                label: '3. Violence/Gore',
                                description: 'Violent or gory content',
                                value: 'violence',
                            },
                            {
                                label: '4. Hate Speech',
                                description: 'Hateful content targeting protected groups',
                                value: 'hate',
                            },
                            {
                                label: '5. Bullying',
                                description: 'Content that bullies other users',
                                value: 'bullying',
                            },
                            {
                                label: '6. Advertising/Spam',
                                description: 'Unsolicited advertising or spam',
                                value: 'spam',
                            },
                            {
                                label: '7. Graphic Content',
                                description: 'Disturbing or graphic images',
                                value: 'graphic',
                            },
                            {
                                label: '8. Stolen/Copyright',
                                description: 'Content that violates copyright or is stolen',
                                value: 'copyright',
                            },
                        ]),
                );

            await contentTypeInteraction.update({
                content: `Reporting ${contentType} of ${reportedUser}\nWhat type of violation are you reporting?`,
                components: [violationTypeRow]
            });

            // Create a collector for the violation type selection
            const violationTypeFilter = i =>
                i.customId === `report_violation_type_${reportedUser.id}` &&
                i.user.id === interaction.user.id;

            const violationTypeCollector = interaction.channel.createMessageComponentCollector({
                filter: violationTypeFilter,
                time: 60000,
                max: 1
            });

            violationTypeCollector.on('collect', async violationTypeInteraction => {
                // Get the selected violation type
                const violationType = violationTypeInteraction.values[0];

                // Step 3: Create a custom modal based on violation type
                const modal = new ModalBuilder()
                    .setCustomId(`ugc_report_modal_${reportedUser.id}`)
                    .setTitle(`Report ${reportedUser.username}'s ${contentType}`);

                // Add fields based on violation type
                const fields = [];

                // Every report gets a details field
                const detailsInput = new TextInputBuilder()
                    .setCustomId('details')
                    .setLabel('Additional Details')
                    .setPlaceholder('Provide any additional information for the admins')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false);

                fields.push(new ActionRowBuilder().addComponents(detailsInput));

                // Add specific fields based on violation type
                if (violationType === 'copyright') {
                    // Add source link field for copyright claims
                    const sourceLinkInput = new TextInputBuilder()
                        .setCustomId('source_link')
                        .setLabel('Source Link')
                        .setPlaceholder('Provide a link to the original content')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    fields.unshift(new ActionRowBuilder().addComponents(sourceLinkInput));
                }
                else if (violationType === 'child_exploitation') {
                    // Add confirmation field for serious reports
                    const confirmationInput = new TextInputBuilder()
                        .setCustomId('confirmation')
                        .setLabel('Important: Please Read')
                        .setValue('I understand this is a serious accusation and confirm my report is truthful.')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true);

                    fields.unshift(new ActionRowBuilder().addComponents(confirmationInput));
                }

                // Add all fields to the modal
                modal.addComponents(...fields);

                // Show the modal
                await violationTypeInteraction.showModal(modal);

                // Wait for modal submission
                const modalFilter = i =>
                    i.customId === `ugc_report_modal_${reportedUser.id}` &&
                    i.user.id === interaction.user.id;

                try {
                    const modalSubmission = await violationTypeInteraction.awaitModalSubmit({
                        filter: modalFilter,
                        time: 300000 // 5 minutes
                    });

                    // Process the form submission
                    if (modalSubmission) {
                        // Get the details
                        const details = modalSubmission.fields.getTextInputValue('details') || 'No additional details provided';

                        // Get source link for copyright claims
                        let sourceLink = null;
                        if (violationType === 'copyright') {
                            sourceLink = modalSubmission.fields.getTextInputValue('source_link');
                        }

                        // Get confirmation for serious reports
                        let confirmation = null;
                        if (violationType === 'child_exploitation') {
                            confirmation = modalSubmission.fields.getTextInputValue('confirmation');
                        }

                        // Use our new enhanced report embed with user history and admin actions
                        // The createContentReportEmbed function is imported from report-utils.js
                        const reportOptions = createContentReportEmbed(
                            modalSubmission,
                            reportedUser,
                            contentType,
                            violationType,
                            details
                        );

                        // Add source link for copyright if provided
                        if (sourceLink && violationType === 'copyright') {
                            reportOptions.embeds[0].addFields({ name: 'Source Link', value: sourceLink });
                        }

                        // Add confirmation for serious reports if provided
                        if (confirmation && violationType === 'child_exploitation') {
                            reportOptions.embeds[0].addFields({ name: 'User Confirmation', value: confirmation });
                        }

                        // Send the enhanced report to the designated channel
                        await reportChannel.send(reportOptions);

                        // Special handling for child exploitation reports
                        if (violationType === 'child_exploitation') {
                            try {
                                // Get the owner's ID
                                const ownerId = modalSubmission.client.config?.bot?.ownerId || '233055065588367370';

                                if (ownerId) {
                                    const owner = await modalSubmission.client.users.fetch(ownerId).catch(() => null);

                                    if (owner) {
                                        // Create escalation embed
                                        const escalationEmbed = new EmbedBuilder()
                                            .setColor('#FF0000')
                                            .setTitle('⚠️ URGENT: Child Exploitation Report ⚠️')
                                            .setDescription('A user has reported content that may contain child exploitation material. This requires immediate attention.')
                                            .addFields(
                                                { name: 'Reported User', value: `${reportedUser} (ID: ${reportedUser.id})` },
                                                { name: 'Reported By', value: `${modalSubmission.user} (ID: ${modalSubmission.user.id})` },
                                                { name: 'Content Type', value: contentType },
                                                { name: 'Additional Details', value: details },
                                                { name: 'Server', value: modalSubmission.guild.name },
                                                { name: 'Required Actions', value: 'Please investigate immediately. If confirmed, report to Discord Trust & Safety and consider contacting authorities.' }
                                            )
                                            .setFooter({ text: `Escalated: ${new Date().toISOString()}` });

                                        // Send DM to owner
                                        await owner.send({ embeds: [escalationEmbed] });
                                    }
                                }
                            } catch (error) {
                                console.error('Failed to escalate serious report to owner:', error);
                            }
                        }

                        // Confirm submission to the user
                        await modalSubmission.reply({
                            content: 'Your report has been submitted. Thank you for helping maintain community standards.',
                            ephemeral: true
                        });
                    }
                } catch (error) {
                    if (error.code === 'InteractionCollectorError') {
                        console.log('Modal timed out');
                    } else {
                        console.error('Error processing modal submission:', error);
                    }
                }
            });

            violationTypeCollector.on('end', collected => {
                if (collected.size === 0) {
                    contentTypeInteraction.followUp({
                        content: 'Report cancelled due to timeout.',
                        ephemeral: true
                    });
                }
            });
        });

        contentTypeCollector.on('end', collected => {
            if (collected.size === 0) {
                interaction.followUp({
                    content: 'Report cancelled due to timeout.',
                    ephemeral: true
                });
            }
        });
    } catch (error) {
        console.error('Error handling report request:', error);
        await interaction.reply({
            content: 'There was an error processing your report request. Please try again later.',
            ephemeral: true
        });
    }
}

module.exports = {
    extendUGCCommands,
    handleReportRequest
};