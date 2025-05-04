// UGC reporting functionality with form-based approach
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

        // Create the report form modal
        const modal = new ModalBuilder()
            .setCustomId(`ugc_report_${reportedUser.id}`)
            .setTitle(`Report ${reportedUser.username}'s Content`);

        // Content type selection
        const contentTypeInput = new TextInputBuilder()
            .setCustomId('content_type')
            .setLabel('What content are you reporting?')
            .setPlaceholder('1 for Banner, 2 for Avatar')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true);

        // Violation type selection
        const violationTypeInput = new TextInputBuilder()
            .setCustomId('violation_type')
            .setLabel('Violation type (1-8, see below)')
            .setPlaceholder('1:Sexual, 2:Child Exploitation, 3:Violence, 4:Hate, 5:Bullying, 6:Spam, 7:Graphic, 8:Stolen')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true);

        // Source link (for copyright claims)
        const sourceLinkInput = new TextInputBuilder()
            .setCustomId('source_link')
            .setLabel('Source link (only for stolen work/option 8)')
            .setPlaceholder('Leave blank if not reporting stolen content')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        // Confirmation for serious reports
        const confirmationInput = new TextInputBuilder()
            .setCustomId('confirmation')
            .setLabel('For option 2 ONLY: Type 1 or 2 to confirm')
            .setPlaceholder('1:I don\'t read but agree, 2:I read and agree. Leave blank if not option 2.')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        // Additional details
        const detailsInput = new TextInputBuilder()
            .setCustomId('details')
            .setLabel('Extra Details')
            .setPlaceholder('Provide any additional information for the admins')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        // Add inputs to the modal
        modal.addComponents(
            new ActionRowBuilder().addComponents(contentTypeInput),
            new ActionRowBuilder().addComponents(violationTypeInput),
            new ActionRowBuilder().addComponents(sourceLinkInput),
            new ActionRowBuilder().addComponents(confirmationInput),
            new ActionRowBuilder().addComponents(detailsInput)
        );

        // Show the modal
        await interaction.showModal(modal);

        // Wait for modal submission
        const filter = i => i.customId === `ugc_report_${reportedUser.id}` && i.user.id === interaction.user.id;

        try {
            const submission = await interaction.awaitModalSubmit({ filter, time: 300000 }); // 5 minute timeout

            if (submission) {
                // Get form values
                const contentType = submission.fields.getTextInputValue('content_type');
                const violationType = submission.fields.getTextInputValue('violation_type');
                const sourceLink = submission.fields.getTextInputValue('source_link') || 'Not provided';
                const confirmation = submission.fields.getTextInputValue('confirmation') || 'Not provided';
                const details = submission.fields.getTextInputValue('details') || 'No additional details provided';

                // Map content type to text
                const contentTypeText = {
                    '1': 'Banner',
                    '2': 'Avatar'
                }[contentType] || 'Unknown';

                // Map violation type to text
                const violationTypeText = {
                    '1': 'Sexual Content',
                    '2': 'Child Exploitation & Endangerment',
                    '3': 'Violence and/or Gore',
                    '4': 'Hate Speech',
                    '5': 'Bullying',
                    '6': 'Self Advertising/Ad/Spam',
                    '7': 'Unwanted Graphic Content',
                    '8': 'Stolen Work/Trademark/Copyright Issue'
                }[violationType] || 'Unknown';

                // Create the report embed
                const reportEmbed = new EmbedBuilder()
                    .setColor(violationType === '2' ? '#FF0000' : '#ff9900') // Red for serious reports, orange for others
                    .setTitle(`Content Report - ${violationTypeText}`)
                    .addFields(
                        { name: 'Reported User', value: `${reportedUser} (ID: ${reportedUser.id})` },
                        { name: 'Reported By', value: `${interaction.user} (ID: ${interaction.user.id})` },
                        { name: 'Content Type', value: contentTypeText },
                        { name: 'Violation Type', value: violationTypeText }
                    )
                    .setFooter({ text: `Submitted: ${new Date().toISOString()}` });

                // Add source link field if it's a copyright claim
                if (violationType === '8' && sourceLink !== 'Not provided') {
                    reportEmbed.addFields({ name: 'Source Link', value: sourceLink });
                }

                // Add confirmation field if it's a serious report
                if (violationType === '2') {
                    const confirmationText = {
                        '1': 'User did not read but agreed anyway',
                        '2': 'User read and agreed'
                    }[confirmation] || 'No confirmation provided';

                    reportEmbed.addFields({ name: 'User Confirmation', value: confirmationText });
                }

                // Add details field
                reportEmbed.addFields({ name: 'Additional Details', value: details });

                // Send the report to the designated channel
                await reportChannel.send({ embeds: [reportEmbed] });

                // Special handling for child exploitation reports
                if (violationType === '2') {
                    try {
                        // Get the owner's ID from config or settings
                        const ownerId = config.bot.ownerId || db.getGuildSetting(guildId, 'owner_id', null);

                        if (ownerId) {
                            const owner = await interaction.client.users.fetch(ownerId);

                            if (owner) {
                                // Create escalation embed
                                const escalationEmbed = new EmbedBuilder()
                                    .setColor('#FF0000')
                                    .setTitle('⚠️ URGENT: Child Exploitation Report ⚠️')
                                    .setDescription('A user has reported content that may contain child exploitation material. This requires immediate attention.')
                                    .addFields(
                                        { name: 'Reported User', value: `${reportedUser} (ID: ${reportedUser.id})` },
                                        { name: 'Reported By', value: `${interaction.user} (ID: ${interaction.user.id})` },
                                        { name: 'Content Type', value: contentTypeText },
                                        { name: 'Additional Details', value: details },
                                        { name: 'Server', value: interaction.guild.name },
                                        { name: 'Required Actions', value: 'Please investigate immediately. If confirmed, report to Discord Trust & Safety and consider contacting authorities.' }
                                    )
                                    .setFooter({ text: `Escalated: ${new Date().toISOString()}` });

                                // Send DM to owner
                                await owner.send({ embeds: [escalationEmbed] });

                                console.log(`Escalated child exploitation report to owner: ${ownerId}`);
                            }
                        }
                    } catch (error) {
                        console.error('Failed to escalate serious report to owner:', error);
                    }
                }

                // Confirm submission to the user
                await submission.reply({
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