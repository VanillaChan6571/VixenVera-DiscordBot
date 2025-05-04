// Enhanced reporting functionality for the Discord leveling bot
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

/**
 * Create a content report embed with user history and admin action buttons
 * @param {Object} interaction - The interaction that triggered the report
 * @param {Object} reportedUser - The user being reported
 * @param {String} contentType - Type of content (banner/avatar)
 * @param {String} violationType - Type of violation
 * @param {String} details - Additional details provided by reporter
 * @returns {Object} - Message options with embed and components
 */
function createContentReportEmbed(interaction, reportedUser, contentType, violationType, details = '') {
    const db = interaction.client.levelingDB;
    const guildId = interaction.guild.id;
    const reportId = generateReportId();

    // Get user warning count
    let warningCount = 0;
    try {
        warningCount = db.getGuildSetting(`user_${reportedUser.id}_${guildId}`, 'warning_count', 0);
    } catch (error) {
        console.error('Error getting warning count:', error);
    }

    // Create the embed
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`Content Report - ${getViolationTypeDisplay(violationType)}`)
        .addFields(
            { name: 'Reported User', value: `${reportedUser} (ID: ${reportedUser.id})`, inline: true },
            { name: 'Previous Warnings', value: `${warningCount}`, inline: true },
            { name: 'Reported By', value: `${interaction.user} (ID: ${interaction.user.id})`, inline: true },
            { name: 'Content Type', value: contentType, inline: true },
            { name: 'Violation Type', value: getViolationTypeDisplay(violationType), inline: true }
        )
        .setFooter({ text: `Report ID: ${reportId} • Submitted: ${new Date().toISOString()}` });

    // Add details if provided
    if (details.trim() !== '') {
        embed.addFields({ name: 'Additional Details', value: details });
    }

    // Add the reported image if possible
    if (contentType.toLowerCase() === 'banner' || contentType.toLowerCase() === 'avatar') {
        try {
            // Try to get the user's content URL
            let contentUrl = null;

            // Check for user-specific content
            const userContentPath = db.getGuildSetting(`user_${reportedUser.id}_${guildId}`, `${contentType.toLowerCase()}_url`, null);

            if (userContentPath) {
                // Get base URL from client
                const baseUrl = interaction.client.ugcBaseUrl || 'http://localhost:2100';
                contentUrl = new URL(userContentPath, baseUrl).toString();
            }

            if (contentUrl) {
                // Set the image URL in the embed
                embed.setImage(contentUrl);
            }
        } catch (error) {
            console.error(`Error getting ${contentType} URL:`, error);
        }
    }

    // Add admin action buttons
    const actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`report_accept_warn_${reportId}`)
                .setLabel('Accept | Delete & Warn')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`report_accept_blacklist_${reportId}`)
                .setLabel('Accept | Delete & Blacklist')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`report_deny_${reportId}`)
                .setLabel('Deny | Close Report')
                .setStyle(ButtonStyle.Secondary)
        );

    // Store report data in database for future reference
    storeReportData(db, guildId, reportId, {
        reportedUserId: reportedUser.id,
        reporterId: interaction.user.id,
        contentType: contentType.toLowerCase(),
        violationType,
        details,
        timestamp: Date.now()
    });

    return {
        embeds: [embed],
        components: [actionRow]
    };
}

/**
 * Store report data in the database
 * @param {Object} db - Database instance
 * @param {String} guildId - Guild ID
 * @param {String} reportId - Report ID
 * @param {Object} reportData - Report data
 */
function storeReportData(db, guildId, reportId, reportData) {
    try {
        db.updateGuildSetting(guildId, `report_${reportId}`, {
            ...reportData,
            status: 'pending'
        });
    } catch (error) {
        console.error('Error storing report data:', error);
    }
}

/**
 * Generate a unique report ID
 * @returns {String} - Unique report ID
 */
function generateReportId() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${dateStr}-${randomPart}`;
}

/**
 * Get a display-friendly violation type label
 * @param {String} violationType - The internal violation type code
 * @returns {String} - User-friendly violation type label
 */
function getViolationTypeDisplay(violationType) {
    const violationLabels = {
        'sexual': 'Sexual Content',
        'child_exploitation': 'Child Exploitation & Endangerment',
        'violence': 'Violence and/or Gore',
        'hate': 'Hate Speech',
        'bullying': 'Bullying',
        'spam': 'Self Advertising/Ad/Spam',
        'graphic': 'Unwanted Graphic Content',
        'copyright': 'Stolen Work/Trademark/Copyright Issue'
    };

    return violationLabels[violationType] || violationType;
}

/**
 * Setup report button handlers for the client
 * @param {Client} client - Discord.js client
 */
function setupReportHandlers(client) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        // Check if this is a report action button
        if (interaction.customId.startsWith('report_')) {
            // Extract report ID and action type
            const parts = interaction.customId.split('_');
            const action = parts[1];
            const reportId = parts[parts.length - 1];

            // Check if user has admin permissions
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return await interaction.reply({
                    content: 'You do not have permission to perform this action.',
                    ephemeral: true
                });
            }

            // Handle the report action
            if (action === 'accept') {
                if (interaction.customId.includes('warn')) {
                    await handleAcceptWarn(interaction, reportId);
                } else if (interaction.customId.includes('blacklist')) {
                    await handleAcceptBlacklist(interaction, reportId);
                }
            } else if (action === 'deny') {
                await handleDenyReport(interaction, reportId);
            }
        }
    });
}

/**
 * Handle Accept + Warn action
 * @param {Interaction} interaction - Button interaction
 * @param {String} reportId - Report ID
 */
async function handleAcceptWarn(interaction, reportId) {
    // Defer the reply to give us time to process
    await interaction.deferUpdate();

    const db = interaction.client.levelingDB;
    const guildId = interaction.guild.id;

    try {
        // Extract data from the original report embed
        const embed = interaction.message.embeds[0];
        const reportedUserField = embed.fields.find(f => f.name === 'Reported User');
        const contentTypeField = embed.fields.find(f => f.name === 'Content Type');

        if (!reportedUserField || !contentTypeField) {
            return await interaction.followUp({
                content: 'Could not extract necessary data from the report.',
                ephemeral: true
            });
        }

        // Extract user ID from the field value (format: "@Username (ID: 123456789)")
        const userIdMatch = reportedUserField.value.match(/\(ID: (\d+)\)/);
        if (!userIdMatch || !userIdMatch[1]) {
            return await interaction.followUp({
                content: 'Could not extract user ID from the report.',
                ephemeral: true
            });
        }

        const reportedUserId = userIdMatch[1];
        const contentType = contentTypeField.value.toLowerCase();

        // 1. Delete the user's content
        await deleteUserContent(db, contentType, reportedUserId, guildId);

        // 2. Increment warning count
        const currentWarnings = db.getGuildSetting(`user_${reportedUserId}_${guildId}`, 'warning_count', 0);
        await db.updateGuildSetting(`user_${reportedUserId}_${guildId}`, 'warning_count', currentWarnings + 1);

        // 3. Try to notify the user
        try {
            const reportedUser = await interaction.client.users.fetch(reportedUserId);
            const notificationEmbed = new EmbedBuilder()
                .setColor('#FF9900')
                .setTitle('Content Warning')
                .setDescription(`Your ${contentType} in **${interaction.guild.name}** has been removed for violating server rules.`)
                .addFields(
                    { name: 'Warning Count', value: `${currentWarnings + 1}` },
                    { name: 'Note', value: 'Continued violations may result in further restrictions or actions.' }
                )
                .setFooter({ text: `Server: ${interaction.guild.name}` })
                .setTimestamp();

            await reportedUser.send({ embeds: [notificationEmbed] });
        } catch (error) {
            console.error('Failed to notify user:', error);
        }

        // 4. Update the report message
        const updatedEmbed = EmbedBuilder.from(embed)
            .setColor('#00FF00')
            .setTitle(`✅ RESOLVED: ${embed.title}`)
            .addFields({ name: 'Action Taken', value: `Deleted content and warned user\nHandled by ${interaction.user}` });

        // Empty component row to remove buttons
        const emptyRow = new ActionRowBuilder().addComponents();

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [emptyRow]
        });

        // 5. Update report status in the database
        try {
            const reportData = db.getGuildSetting(guildId, `report_${reportId}`, null);

            if (reportData) {
                reportData.status = 'resolved';
                reportData.resolvedBy = interaction.user.id;
                reportData.resolvedAt = Date.now();
                reportData.action = 'warn';

                await db.updateGuildSetting(guildId, `report_${reportId}`, reportData);
            }
        } catch (error) {
            console.error('Error updating report status:', error);
        }

        // 6. Notify channel of action
        await interaction.followUp({
            content: `Content from <@${reportedUserId}> has been deleted and the user has been warned.`
        });
    } catch (error) {
        console.error('Error handling accept/warn action:', error);
        await interaction.followUp({
            content: 'An error occurred while processing this action.',
            ephemeral: true
        });
    }
}

/**
 * Handle Accept + Blacklist action
 * @param {Interaction} interaction - Button interaction
 * @param {String} reportId - Report ID
 */
async function handleAcceptBlacklist(interaction, reportId) {
    // Defer the reply to give us time to process
    await interaction.deferUpdate();

    const db = interaction.client.levelingDB;
    const guildId = interaction.guild.id;

    try {
        // Extract data from the original report embed
        const embed = interaction.message.embeds[0];
        const reportedUserField = embed.fields.find(f => f.name === 'Reported User');
        const contentTypeField = embed.fields.find(f => f.name === 'Content Type');

        if (!reportedUserField || !contentTypeField) {
            return await interaction.followUp({
                content: 'Could not extract necessary data from the report.',
                ephemeral: true
            });
        }

        // Extract user ID from the field value (format: "@Username (ID: 123456789)")
        const userIdMatch = reportedUserField.value.match(/\(ID: (\d+)\)/);
        if (!userIdMatch || !userIdMatch[1]) {
            return await interaction.followUp({
                content: 'Could not extract user ID from the report.',
                ephemeral: true
            });
        }

        const reportedUserId = userIdMatch[1];
        const contentType = contentTypeField.value.toLowerCase();

        // 1. Delete the user's content
        await deleteUserContent(db, contentType, reportedUserId, guildId);

        // 2. Blacklist the user from uploading content
        await db.updateGuildSetting(`user_${reportedUserId}_${guildId}`, 'content_blacklisted', true);

        // 3. Increment warning count
        const currentWarnings = db.getGuildSetting(`user_${reportedUserId}_${guildId}`, 'warning_count', 0);
        await db.updateGuildSetting(`user_${reportedUserId}_${guildId}`, 'warning_count', currentWarnings + 1);

        // 4. Try to notify the user
        try {
            const reportedUser = await interaction.client.users.fetch(reportedUserId);
            const notificationEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Content Violation')
                .setDescription(`Your ${contentType} in **${interaction.guild.name}** has been removed for violating server rules.`)
                .addFields(
                    { name: 'Action Taken', value: 'You have been blacklisted from uploading custom content in this server.' },
                    { name: 'Warning Count', value: `${currentWarnings + 1}` }
                )
                .setFooter({ text: `Server: ${interaction.guild.name}` })
                .setTimestamp();

            await reportedUser.send({ embeds: [notificationEmbed] });
        } catch (error) {
            console.error('Failed to notify user:', error);
        }

        // 5. Update the report message
        const updatedEmbed = EmbedBuilder.from(embed)
            .setColor('#00FF00')
            .setTitle(`✅ RESOLVED: ${embed.title}`)
            .addFields({ name: 'Action Taken', value: `Deleted content and blacklisted user\nHandled by ${interaction.user}` });

        // Empty component row to remove buttons
        const emptyRow = new ActionRowBuilder().addComponents();

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [emptyRow]
        });

        // 6. Update report status in the database
        try {
            const reportData = db.getGuildSetting(guildId, `report_${reportId}`, null);

            if (reportData) {
                reportData.status = 'resolved';
                reportData.resolvedBy = interaction.user.id;
                reportData.resolvedAt = Date.now();
                reportData.action = 'blacklist';

                await db.updateGuildSetting(guildId, `report_${reportId}`, reportData);
            }
        } catch (error) {
            console.error('Error updating report status:', error);
        }

        // 7. Notify channel of action
        await interaction.followUp({
            content: `Content from <@${reportedUserId}> has been deleted and the user has been blacklisted from uploading custom content.`
        });
    } catch (error) {
        console.error('Error handling accept/blacklist action:', error);
        await interaction.followUp({
            content: 'An error occurred while processing this action.',
            ephemeral: true
        });
    }
}

/**
 * Handle Deny action
 * @param {Interaction} interaction - Button interaction
 * @param {String} reportId - Report ID
 */
async function handleDenyReport(interaction, reportId) {
    // Defer the reply to give us time to process
    await interaction.deferUpdate();

    const db = interaction.client.levelingDB;
    const guildId = interaction.guild.id;

    try {
        // Extract data from the original report embed
        const embed = interaction.message.embeds[0];
        const reportedUserField = embed.fields.find(f => f.name === 'Reported User');

        if (!reportedUserField) {
            return await interaction.followUp({
                content: 'Could not extract necessary data from the report.',
                ephemeral: true
            });
        }

        // Extract user ID from the field value
        const userIdMatch = reportedUserField.value.match(/\(ID: (\d+)\)/);
        if (!userIdMatch || !userIdMatch[1]) {
            return await interaction.followUp({
                content: 'Could not extract user ID from the report.',
                ephemeral: true
            });
        }

        const reportedUserId = userIdMatch[1];

        // Update the report message
        const updatedEmbed = EmbedBuilder.from(embed)
            .setColor('#808080')
            .setTitle(`❌ DENIED: ${embed.title}`)
            .addFields({ name: 'Action Taken', value: `Report denied\nHandled by ${interaction.user}` });

        // Empty component row to remove buttons
        const emptyRow = new ActionRowBuilder().addComponents();

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [emptyRow]
        });

        // Update report status in the database
        try {
            const reportData = db.getGuildSetting(guildId, `report_${reportId}`, null);

            if (reportData) {
                reportData.status = 'denied';
                reportData.resolvedBy = interaction.user.id;
                reportData.resolvedAt = Date.now();
                reportData.action = 'deny';

                await db.updateGuildSetting(guildId, `report_${reportId}`, reportData);
            }
        } catch (error) {
            console.error('Error updating report status:', error);
        }

        // Notify channel of action
        await interaction.followUp({
            content: `Report against <@${reportedUserId}> has been reviewed and denied.`
        });
    } catch (error) {
        console.error('Error handling deny action:', error);
        await interaction.followUp({
            content: 'An error occurred while processing this action.',
            ephemeral: true
        });
    }
}

/**
 * Delete user content file and database record
 * @param {Object} db - Database connection
 * @param {String} contentType - Type of content (banner/avatar)
 * @param {String} userId - User ID
 * @param {String} guildId - Guild ID
 */
async function deleteUserContent(db, contentType, userId, guildId) {
    try {
        // Get the file path
        const contentPath = db.getGuildSetting(`user_${userId}_${guildId}`, `${contentType}_url`, null);

        if (contentPath) {
            // Delete the file from disk
            try {
                // Convert URL path to filesystem path
                const typePlural = contentType.endsWith('s') ? contentType : `${contentType}s`;
                const fileName = path.basename(contentPath);
                const filePath = path.resolve(__dirname, '../ugc', typePlural, fileName);

                await fs.unlink(filePath);
                console.log(`Deleted content file: ${filePath}`);
            } catch (fileError) {
                console.error('Error deleting content file:', fileError);
            }

            // Remove from database
            await db.updateGuildSetting(`user_${userId}_${guildId}`, `${contentType}_url`, null);
        }
    } catch (error) {
        console.error('Error deleting user content:', error);
        throw error;
    }
}

/**
 * Check if a user is blacklisted from uploading content
 * @param {Object} db - Database connection
 * @param {String} userId - User ID
 * @param {String} guildId - Guild ID
 * @returns {Boolean} - True if user is blacklisted
 */
function isUserContentBlacklisted(db, userId, guildId) {
    try {
        // Check global blacklist first
        if (isUserGloballyBlacklisted(db, userId)) {
            return true;
        }

        // Then check server-specific blacklist
        return db.getGuildSetting(`user_${userId}_${guildId}`, 'content_blacklisted', false);
    } catch (error) {
        console.error('Error checking if user is blacklisted:', error);
        return false;
    }
}

/**
 * Check if a user is globally blacklisted
 * @param {Object} db - Database connection
 * @param {String} userId - User ID
 * @returns {Boolean} - True if user is globally blacklisted
 */
function isUserGloballyBlacklisted(db, userId) {
    try {
        return db.getGuildSetting('global', `blacklist_user_${userId}`, false);
    } catch (error) {
        console.error('Error checking if user is globally blacklisted:', error);
        return false;
    }
}

module.exports = {
    createContentReportEmbed,
    setupReportHandlers,
    isUserContentBlacklisted,
    isUserGloballyBlacklisted
};