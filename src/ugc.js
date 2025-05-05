// User Generated Content (UGC) management
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { isUserContentAllowed } = require('./levelingSystem');
const sharp = require('sharp');
const { isUserContentBlacklisted, isUserGloballyBlacklisted } = require('./report-utils');
const { PermissionFlagsBits } = require('discord.js');

// Create a Map to store active upload sessions
// Key: userId, Value: { type, guildId, timeout, isStaff }
const activeSessions = new Map();

// Dimensions for different content types
const contentDimensions = {
    banner: { width: 1546, height: 423 },
    avatar: { width: 512, height: 512 }
};

// Create directories for UGC storage if they don't exist
function ensureDirectoriesExist() {
    // Use the root-level ugc directory
    const baseDir = path.resolve(__dirname, '../ugc');
    const types = ['avatars', 'banners'];

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    for (const type of types) {
        const typeDir = path.join(baseDir, type);
        if (!fs.existsSync(typeDir)) {
            fs.mkdirSync(typeDir, { recursive: true });
        }
    }

    console.log('UGC directories initialized');
    return baseDir;
}

// Handle user upload request
async function handleUploadRequest(interaction, type, isStaff = false) {
    try {
        // Check if the feature is enabled in the guild
        if (!isStaff) {
            const db = interaction.client.levelingDB;
            const guildId = interaction.guild.id;

            if (!isUserContentAllowed(db, type, guildId)) {
                return await interaction.reply({
                    content: `User ${type}s are not allowed in this server. A server administrator has disabled this feature.`,
                    ephemeral: true
                });
            }

            if (isUserGloballyBlacklisted(db, interaction.user.id)) {
                return await interaction.reply({
                    content: `${interaction.user} System has banned you from Uploading Anything regardless if your staff or a normal user. You have been reported by multiple admins or for other reasons. This cannot be reverted.`,
                    ephemeral: true
                });
            } else if (isUserContentBlacklisted(db, interaction.user.id, guildId)) {
                return await interaction.reply({
                    content: 'You have been blacklisted from uploading custom content in this server due to previous violations.',
                    ephemeral: true
                });
            }
        }

        // Check if user already has an active session
        if (activeSessions.has(interaction.user.id)) {
            return await interaction.reply({
                content: 'You already have an active upload session. Please complete that first or wait for it to expire.',
                ephemeral: true
            });
        }

        // Inform the user that we're sending instructions to DM
        await interaction.reply({
            content: `I've sent you a DM with instructions on how to upload your ${type}!`,
            ephemeral: true
        });

        // Create DM channel
        const dmChannel = await interaction.user.createDM();

        // Create the appropriate embed based on the type and whether it's a staff upload
        const embed = createInstructionEmbed(interaction, type, isStaff);

        // Send the instructions
        await dmChannel.send({ embeds: [embed] });

        // Set up session timeout and store session info
        const sessionTimeout = setTimeout(() => {
            if (activeSessions.has(interaction.user.id)) {
                dmChannel.send(`Your ${type} upload session has expired. Feel free to start a new one when you're ready!`);
                activeSessions.delete(interaction.user.id);
            }
        }, 2 * 60 * 1000); // 2 minutes

        // Store session information
        activeSessions.set(interaction.user.id, {
            type,
            guildId: interaction.guild.id,
            timeout: sessionTimeout,
            isStaff,
            dmChannel
        });

    } catch (error) {
        console.error(`Error starting ${type} upload session:`, error);

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: `There was an error starting your upload session. Make sure your DMs are open and try again later.`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: `There was an error starting your upload session. Make sure your DMs are open and try again later.`,
                ephemeral: true
            });
        }
    }
}

// Create instruction embed for DM
function createInstructionEmbed(interaction, type, isStaff) {
    const guildName = interaction.guild.name;
    const { width, height } = contentDimensions[type];

    const embed = new EmbedBuilder()
        .setColor(isStaff ? '#ff9900' : '#00aaff')
        .setTimestamp();

    if (isStaff) {
        // Staff upload embed
        embed.setTitle(`Server ${type.charAt(0).toUpperCase() + type.slice(1)} Upload`)
            .setDescription(`Hello Staff of ${interaction.guild.name}!\n\nYou are uploading a default guild/server ${type} for **${guildName}**. Please note this will be applied to all users that have not made a UGC upload in your guild!\n\nYou can always disallow UGC regardless if they already uploaded one by using \`/systoggle\` (**In Server Only**) Otherwise you can always change the default for your server and allow UGC.`)
            .addFields({
                    name: `For ${type}s`,
                    value: `Reminder, the size of the ${type} should be **${width}x${height}** (Please note your ${type} will be resized to this regardless if it's bigger or smaller resolution)`
                },
                {
                    name: 'Instructions',
                    value: `You will have 2 minutes to upload the file. **You can always cancel/stop this process by saying "cancel", "exit", or "stop"**`
                });
    } else {
        // User upload embed
        embed.setTitle(`Custom ${type.charAt(0).toUpperCase() + type.slice(1)} Upload`)
            .setDescription(`Hi ${interaction.user}!\n\nYou have requested to submit a custom ${type} for your level up info on **${guildName}**`)
            .addFields({
                    name: `For ${type}s`,
                    value: `Reminder, the size of the ${type} should be **${width}x${height}** (Please note your ${type} will be resized to this regardless if it's bigger or smaller resolution)`
                },
                {
                    name: 'Instructions',
                    value: `You will have 2 minutes to upload the file. **You can always cancel/stop this process by saying "cancel", "exit", or "stop"**`
                });
    }

    return embed;
}

// Process uploaded image
async function processUploadedImage(message, sessionData) {
    try {
        // Check for cancellation keywords
        const cancelKeywords = ['cancel', 'exit', 'stop'];
        if (message.content && cancelKeywords.includes(message.content.toLowerCase())) {
            message.channel.send('Upload session cancelled. You can start a new one when you\'re ready!');
            clearTimeout(sessionData.timeout);
            activeSessions.delete(message.author.id);
            return;
        }

        // Check if there's an attachment
        const attachment = message.attachments.first();
        if (!attachment) {
            message.channel.send('Please upload an image file. If you want to cancel, type "cancel".');
            return;
        }

        // Check if it's an image
        const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (!validImageTypes.includes(attachment.contentType)) {
            message.channel.send('Please upload a valid image file (JPG, PNG, GIF, or WEBP). If you want to cancel, type "cancel".');
            return;
        }

        // Download and process the image
        const { type, guildId, isStaff } = sessionData;
        const userId = message.author.id;

        // Send processing message
        await message.channel.send(`Processing your ${type}... Please wait.`);

        // Create file paths - updated to use absolute paths
        const fileName = `${isStaff ? 'guild' : userId}_${guildId}_${Date.now()}.png`;
        const typePlural = type.endsWith('s') ? type : `${type}s`;
        const ugcDir = path.resolve(__dirname, '../ugc', typePlural);
        const filePath = path.join(ugcDir, fileName);

        // URL path for the file (to be stored in DB)
        const urlPath = `/ugc/${typePlural}/${fileName}`;

        // Ensure directories exist
        ensureDirectoriesExist();

        // Download image
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

        const imageBuffer = await response.arrayBuffer();

        // Resize image with Sharp
        const { width, height } = contentDimensions[type];
        await sharp(Buffer.from(imageBuffer))
            .resize(width, height, { fit: 'cover' })
            .toFile(filePath);

        // Record in database
        const db = message.client.levelingDB;

        if (isStaff) {
            // Update guild setting - this method is unchanged
            await db.updateGuildSetting(guildId, `default_${type}_url`, urlPath);

            // Make sure we're not automatically setting guild-only mode
            // This ensures user banners can still be shown
            const guildOnly = db.getGuildSetting(guildId, `guild_only_${type}`, false);
            if (guildOnly) {
                await message.channel.send("⚠️ **Note:** Your server is in 'Server-Only' mode, which forces all users to use this banner. If you want to allow users to use their own banners, use `/systoggle feature:banner mode:allow_user`");
            }

            // Confirmation message
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle(`Server ${type.charAt(0).toUpperCase() + type.slice(1)} Updated`)
                .setDescription(`Your server's default ${type} has been successfully uploaded and is now active.`)
                .setImage(attachment.url)
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });
        } else {
            // Update user setting - use the new dedicated methods
            if (type === 'banner') {
                // Use the new method instead of updateGuildSetting
                await db.setUserBanner(userId, guildId, urlPath);
            } else if (type === 'avatar') {
                // Use the new method instead of updateGuildSetting
                await db.setUserAvatar(userId, guildId, urlPath);
            }

            // Confirmation message
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle(`${type.charAt(0).toUpperCase() + type.slice(1)} Updated`)
                .setDescription(`Your custom ${type} has been successfully uploaded and will appear on your level card in **${message.client.guilds.cache.get(guildId).name}**.`)
                .setImage(attachment.url)
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });
        }

        // Clean up session
        clearTimeout(sessionData.timeout);
        activeSessions.delete(message.author.id);

    } catch (error) {
        console.error('Error processing uploaded image:', error);
        message.channel.send(`There was an error processing your image. Please try again later or contact a server administrator if the issue persists.`);

        // Clean up session
        clearTimeout(sessionData.timeout);
        activeSessions.delete(message.author.id);
    }
}

// Get guild default UGC path
function getGuildDefaultPath(db, type, guildId) {
    try {
        return db.getGuildSetting(guildId, `default_${type}_url`, null);
    } catch (error) {
        console.error(`Error getting guild default for ${type} in ${guildId}:`, error);
        return null;
    }
}

// FIXED VERSION - Get UGC path for a user
function getUserUGCPath(db, type, userId, guildId) {
    try {
        // Get all relevant settings and log them for debugging
        const guildOnly = db.getGuildSetting(guildId, `guild_only_${type}`, false);
        const userPath = db.getGuildSetting(`user_${userId}_${guildId}`, `${type}_url`, null);
        const userContentAllowed = db.getGuildSetting(guildId, `allow_user_${type}`, true);
        const guildDefault = getGuildDefaultPath(db, type, guildId);

        // Log all the relevant settings
        console.log(`=== DEBUG: getUserUGCPath for user ${userId} in guild ${guildId} ===`);
        console.log(`Content type: ${type}`);
        console.log(`Guild-only mode: ${guildOnly}`);
        console.log(`User has content: ${userPath !== null}`);
        console.log(`User content path: ${userPath}`);
        console.log(`User content allowed: ${userContentAllowed}`);
        console.log(`Guild default path: ${guildDefault}`);

        // Use user content if:
        // 1. User has uploaded content
        // 2. Server is NOT in guild-only mode
        // 3. User content is allowed
        if (userPath && !guildOnly && userContentAllowed) {
            console.log('DECISION: Using user content');
            return userPath;
        }

        // Fall back to guild default
        if (guildDefault) {
            console.log('DECISION: Using guild default');
            return guildDefault;
        }

        // Fall back to system default only for banner
        if (type === 'banner') {
            console.log('DECISION: Using system default banner');
            return `/ugc/defaults/banner.jpg`;
        }

        console.log('DECISION: No content available');
        return null;
    } catch (error) {
        console.error(`Error getting UGC path for ${userId} in ${guildId}:`, error);

        // Return default banner on error, only for banner type
        if (type === 'banner') {
            return `/ugc/defaults/banner.jpg`;
        }

        return null;
    }
}

/**
 * Handle admin upload request for setting server-wide default content
 * @param {Object} interaction - The interaction that triggered the command
 * @param {String} type - Content type (banner/avatar)
 * @param {String} guildId - Guild ID
 * @returns {Promise<void>}
 */
async function handleAdminUploadRequest(interaction, type, guildId) {
    try {
        // Check if user has permissions
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        // Check for global blacklist
        const db = interaction.client.levelingDB;
        if (isUserGloballyBlacklisted(db, interaction.user.id)) {
            return await interaction.reply({
                content: `${interaction.user} System has banned you from Uploading Anything regardless if your staff or a normal user. You have been reported by multiple admins or for other reasons. This cannot be reverted.`,
                ephemeral: true
            });
        }

        // Check if user already has an active session
        if (activeSessions.has(interaction.user.id)) {
            return await interaction.reply({
                content: 'You already have an active upload session. Please complete that first or wait for it to expire.',
                ephemeral: true
            });
        }

        // Inform the user that we're sending instructions to DM
        await interaction.reply({
            content: `I've sent you a DM with instructions on how to upload a server-wide default ${type}!`,
            ephemeral: true
        });

        // Create DM channel
        const dmChannel = await interaction.user.createDM();

        // Create the instruction embed
        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle(`Server ${type.charAt(0).toUpperCase() + type.slice(1)} Upload`)
            .setDescription(`Hello Staff of ${interaction.guild.name}!\n\nYou are uploading a default guild/server ${type} for **${interaction.guild.name}**. This will be used as the default ${type} for all users who haven't uploaded their own content.`)
            .addFields(
                {
                    name: `For ${type}s`,
                    value: `Reminder, the ideal size of the ${type} should be **${contentDimensions[type].width}x${contentDimensions[type].height}** (Your image will be resized to these dimensions)`
                },
                {
                    name: 'Instructions',
                    value: `You have 2 minutes to upload the image file. **You can cancel this process by typing "cancel", "exit", or "stop"**`
                }
            )
            .setTimestamp();

        // Send the instructions
        await dmChannel.send({ embeds: [embed] });

        // Set up session timeout and store session info
        const sessionTimeout = setTimeout(() => {
            if (activeSessions.has(interaction.user.id)) {
                dmChannel.send(`Your ${type} upload session has expired. Feel free to start a new one when you're ready!`);
                activeSessions.delete(interaction.user.id);
            }
        }, 2 * 60 * 1000); // 2 minutes

        // Store session information
        activeSessions.set(interaction.user.id, {
            type,
            guildId: interaction.guild.id,
            timeout: sessionTimeout,
            isStaff: true,
            dmChannel
        });

    } catch (error) {
        console.error(`Error starting admin ${type} upload session:`, error);

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: `There was an error starting your upload session. Make sure your DMs are open and try again later.`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: `There was an error starting your upload session. Make sure your DMs are open and try again later.`,
                ephemeral: true
            });
        }
    }
}

module.exports = {
    handleUploadRequest,
    processUploadedImage,
    getUserUGCPath,
    getGuildDefaultPath,
    activeSessions,
    ensureDirectoriesExist,
    handleAdminUploadRequest
};