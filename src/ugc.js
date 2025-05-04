// User Generated Content (UGC) management
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { isUserContentAllowed } = require('./levelingSystem');
const sharp = require('sharp');

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
    const baseDir = path.join(__dirname, '../data/ugc');
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
        const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!validImageTypes.includes(attachment.contentType)) {
            message.channel.send('Please upload a valid image file (JPG, PNG, GIF, or WEBP). If you want to cancel, type "cancel".');
            return;
        }

        // Download and process the image
        const { type, guildId, isStaff } = sessionData;
        const userId = message.author.id;

        // Send processing message
        await message.channel.send(`Processing your ${type}... Please wait.`);

        // Create file paths
        const fileName = `${isStaff ? 'guild' : userId}_${guildId}_${Date.now()}.png`;
        const ugcDir = path.join(__dirname, '../data/ugc', `${type}s`);
        const filePath = path.join(ugcDir, fileName);

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
            // Update guild setting
            await db.updateGuildSetting(guildId, `default_${type}_url`, `/data/ugc/${type}s/${fileName}`);

            // Confirmation message
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle(`Server ${type.charAt(0).toUpperCase() + type.slice(1)} Updated`)
                .setDescription(`Your server's default ${type} has been successfully uploaded and is now active.`)
                .setImage(attachment.url)
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });
        } else {
            // Update user setting
            await db.updateGuildSetting(`user_${userId}_${guildId}`, `${type}_url`, `/data/ugc/${type}s/${fileName}`);

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

// Get UGC path for a user if available
function getUserUGCPath(db, type, userId, guildId) {
    try {
        // First check if user content is allowed
        if (!isUserContentAllowed(db, type, guildId)) {
            return getGuildDefaultPath(db, type, guildId);
        }

        // Then check if user has custom content
        const userPath = db.getGuildSetting(`user_${userId}_${guildId}`, `${type}_url`, null);

        if (userPath) {
            return userPath;
        }

        // Fall back to guild default
        return getGuildDefaultPath(db, type, guildId);
    } catch (error) {
        console.error(`Error getting UGC path for ${userId} in ${guildId}:`, error);
        return null;
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

module.exports = {
    handleUploadRequest,
    processUploadedImage,
    getUserUGCPath,
    getGuildDefaultPath,
    activeSessions,
    ensureDirectoriesExist
};