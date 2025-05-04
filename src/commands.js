// Slash command definitions and handlers
const { ApplicationCommandOptionType, EmbedBuilder } = require('discord.js');
const { createProgressBar } = require('./levelingSystem');
const config = require('./config');
const LevelingDatabase = require('./database');

// We'll initialize the database in index.js and pass it to the handlers
// This is just a reference declaration to prevent errors
let db;

// Command definitions for registration
const commandDefinitions = [
    {
        name: 'level',
        description: 'Check your level or another user\'s level',
        options: [
            {
                name: 'user',
                description: 'The user to check (leave empty for yourself)',
                type: ApplicationCommandOptionType.User,
                required: false
            }
        ]
    },
    {
        name: 'rank',
        description: 'Check your rank or another user\'s rank (alias for /level)',
        options: [
            {
                name: 'user',
                description: 'The user to check (leave empty for yourself)',
                type: ApplicationCommandOptionType.User,
                required: false
            }
        ]
    },
    {
        name: 'level-sacrifice',
        description: 'The fox will make know... you will understand later...',
        options: []
    },
    {
        name: 'leaderboard',
        description: 'Show the server\'s leveling leaderboard',
        options: [
            {
                name: 'page',
                description: 'Page number to display (default: 1)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1
            }
        ]
    },
    {
        name: 'xp-info',
        description: 'Get information about the XP system',
        options: []
    }
];

// Initialize database reference (will be set from index.js)
function setDatabase(database) {
    db = database;
    console.log('Command handlers connected to database');
}

// Command handlers
const commandHandlers = {
    // Level/Rank command handler
    async level(interaction) {
        if (!db) {
            await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
            return;
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;
        const guildId = interaction.guild.id;

        try {
            // Get user data
            const userData = db.getUser(userId, guildId);
            const currentXP = userData.xp;
            const currentLevel = userData.level;
            const nextLevelXP = db.xpForLevel(currentLevel + 1);
            const xpNeeded = nextLevelXP - currentXP;

            // Calculate progress
            const progressPercentage = Math.floor((currentXP / nextLevelXP) * 100);
            const progressBar = createProgressBar(progressPercentage);

            // Create embed
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`${targetUser.username}'s Level`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'Level', value: currentLevel.toString(), inline: true },
                    { name: 'XP', value: `${currentXP}/${nextLevelXP}`, inline: true }
                );

            // Add rank position if enabled
            if (config.leaderboard.showGlobalRank) {
                const rank = db.getUserRank(userId, guildId);
                if (rank) {
                    embed.addFields({ name: 'Rank', value: `#${rank}`, inline: true });
                }
            }

            // Add progress bar
            embed.addFields({
                name: 'Progress to Next Level',
                value: `${progressBar} ${progressPercentage}%`
            });

            // Add footer
            embed.setFooter({ text: `${xpNeeded} XP needed for next level` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in level command:', error);
            await interaction.reply({
                content: 'There was an error processing your request.',
                ephemeral: true
            });
        }
    },

    // Leaderboard command handler
    async leaderboard(interaction) {
        if (!db) {
            await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
            return;
        }

        const page = interaction.options.getInteger('page') || 1;
        const guildId = interaction.guild.id;

        try {
            // Get leaderboard data
            const leaderboard = db.getLeaderboard(page, config.leaderboard.pageSize, guildId);

            if (leaderboard.users.length === 0) {
                await interaction.reply('No users found on this page of the leaderboard!');
                return;
            }

            // Defer reply since fetching multiple users might take time
            await interaction.deferReply();

            let leaderboardText = '';

            // Build leaderboard text
            for (let i = 0; i < leaderboard.users.length; i++) {
                const userId = leaderboard.users[i][0];
                const userData = leaderboard.users[i][1];
                const position = ((leaderboard.currentPage - 1) * config.leaderboard.pageSize) + i + 1;

                try {
                    const user = await interaction.client.users.fetch(userId);
                    leaderboardText += `**${position}.** ${user.username} - Level ${userData.level} (${userData.xp} XP)\n`;
                } catch (err) {
                    leaderboardText += `**${position}.** Unknown User - Level ${userData.level} (${userData.xp} XP)\n`;
                }
            }

            // Create embed
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Level Leaderboard')
                .setDescription(leaderboardText)
                .setFooter({
                    text: `Page ${leaderboard.currentPage}/${leaderboard.totalPages} • ${leaderboard.totalUsers} total users • Keep chatting to earn XP!`
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in leaderboard command:', error);

            if (interaction.deferred) {
                await interaction.editReply('There was an error processing your request.');
            } else {
                await interaction.reply({
                    content: 'There was an error processing your request.',
                    ephemeral: true
                });
            }
        }
    },

    async 'level-sacrifice'(interaction) {
        if (!db) {
            return await interaction.reply({
                content: 'Database is not initialized. Please try again later.',
                ephemeral: true
            });
        }

        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        try {
            // Attempt to sacrifice
            const result = await db.sacrificeUser(userId, guildId);

            if (result.success) {
                // Successful sacrifice
                const embed = new EmbedBuilder()
                    .setColor('#FF4500')
                    .setTitle('🦊 Sacrifice Completed')
                    .setDescription(result.message)
                    .addFields(
                        { name: 'Sacrifice Count', value: `${result.sacrificeCount}`, inline: true },
                        { name: 'New Level', value: '1', inline: true }
                    )
                    .setFooter({ text: 'The path begins anew...' })
                    .setTimestamp();

                // If there's a sacrifice role, add it to the user
                if (config.xp.sacrifice.enabled && config.xp.sacrifice.sacrificeRoleId) {
                    try {
                        const role = interaction.guild.roles.cache.get(config.xp.sacrifice.sacrificeRoleId);
                        if (role) {
                            await interaction.member.roles.add(role);
                            embed.addFields({ name: 'Reward', value: `You've been granted the ${role.name} role!` });
                        }
                    } catch (roleError) {
                        console.error('Error adding sacrifice role:', roleError);
                    }
                }

                return await interaction.reply({
                    content: `<@${userId}>`,
                    embeds: [embed]
                });
            } else {
                // Not successful - various reasons
                if (result.needsConfirmation) {
                    // User needs to confirm
                    // Set a timeout to reset the pending flag after 2 minutes
                    setTimeout(() => {
                        db.resetSacrificePending(userId, guildId);
                    }, 2 * 60 * 1000);

                    return await interaction.reply({
                        content: `<@${userId}> ${result.message}`,
                        ephemeral: false
                    });
                } else {
                    // User is not eligible
                    return await interaction.reply({
                        content: result.message,
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error('Error executing sacrifice command:', error);
            return await interaction.reply({
                content: 'There was an error processing your sacrifice. Please try again later.',
                ephemeral: true
            });
        }
    },

    // XP Info command handler
    async 'xp-info'(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('XP System Information')
            .setDescription('Here\'s how the leveling system works:')
            .addFields(
                {
                    name: '🔹 Earning XP',
                    value: `Send messages to earn ${config.xp.min}-${config.xp.max} XP with a ${config.xp.cooldown/1000} second cooldown between rewards.`
                },
                {
                    name: '🔹 Leveling Up',
                    value: `Each level requires progressively more XP. Level 1 requires ${config.xp.baseXP} XP, and it increases from there.`
                },
                {
                    name: '🔹 Commands',
                    value: '`/level` - Check your level and XP\n`/level @user` - Check someone else\'s level\n`/leaderboard` - See the server\'s top users'
                }
            )
            .setFooter({ text: 'Happy chatting!' })
            .setTimestamp();

        // Add reward roles if any are configured
        const rewards = config.xp.levelUp.rewards;
        if (Object.keys(rewards).length > 0) {
            let rewardsText = '';
            for (const [level, roleId] of Object.entries(rewards)) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    rewardsText += `Level ${level}: ${role.name}\n`;
                }
            }

            if (rewardsText) {
                embed.addFields({ name: '🔹 Level Rewards', value: rewardsText });
            }
        }

        await interaction.reply({ embeds: [embed] });
    }
};

// Map rank command to level handler
commandHandlers.rank = commandHandlers.level;

module.exports = {
    definitions: commandDefinitions,
    handlers: commandHandlers,
    setDatabase
};