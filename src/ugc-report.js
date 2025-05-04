// UGC reporting functionality
const { EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');

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

        // Reply to start the reporting flow
        await interaction.reply({
            content: 'Please mention or provide the ID of the user whose content you want to report:',
            ephemeral: true
        });

        // Create a message collector to wait for the user's response
        const filter = m => m.author.id === interaction.user.id;
        const responseChannel = await interaction.user.createDM().catch(() => null);

        if (!responseChannel) {
            return await interaction.followUp({
                content: 'I wasn\'t able to send you a DM. Please enable DMs from server members and try again.',
                ephemeral: true
            });
        }

        // Send initial prompt in DM
        await responseChannel.send('Please mention or provide the ID of the user whose content you want to report:');

        const collector = responseChannel.createMessageCollector({ filter, time: 60000, max: 1 });

        collector.on('collect', async msg => {
            // Try to extract a user mention or ID
            let targetUserId = msg.content.trim();

            // Check if it's a mention
            const mentionMatch = targetUserId.match(/<@!?(\d+)>/);
            if (mentionMatch) {
                targetUserId = mentionMatch[1];
            }

            // Validate it's a valid user ID
            if (!/^\d+$/.test(targetUserId)) {
                return await msg.reply('Please provide a valid user ID or mention. To get a user ID, right-click on their name with Developer Mode enabled and select "Copy ID".');
            }

            // Ask for the reason
            await msg.reply('Please describe the issue with the user\'s content:');

            // Create another collector for the reason
            const reasonCollector = responseChannel.createMessageCollector({ filter, time: 120000, max: 1 });

            reasonCollector.on('collect', async reasonMsg => {
                const reason = reasonMsg.content;

                // Create the report embed
                const reportEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Content Report')
                    .addFields(
                        { name: 'Reported User', value: `<@${targetUserId}> (ID: ${targetUserId})` },
                        { name: 'Reported By', value: `${interaction.user} (ID: ${interaction.user.id})` },
                        { name: 'Reason', value: reason }
                    )
                    .setFooter({ text: `Submitted: ${new Date().toISOString()}` });

                // Send the report to the designated channel
                await reportChannel.send({ embeds: [reportEmbed] });

                // Confirm to the user
                await reasonMsg.reply('Your report has been submitted to the moderators. Thank you for helping keep the server appropriate!');

                // Notify in the original channel too
                await interaction.followUp({
                    content: 'Your report has been submitted successfully.',
                    ephemeral: true
                });
            });

            reasonCollector.on('end', collected => {
                if (collected.size === 0) {
                    msg.reply('Report cancelled due to timeout. Please try again if you still want to submit a report.');
                }
            });
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.followUp({
                    content: 'Report cancelled due to timeout. Please try again if you still want to submit a report.',
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