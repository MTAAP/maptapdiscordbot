import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { db } from '../../database';
import { formatAverage } from '../../utils/embeds';

interface PlayerStats {
    user_id: string;
    username: string;
    games: number;
    average: number;
    best: number;
    worst: number;
}

export async function handleAllPlayers(interaction: ChatInputCommandInteraction): Promise<void> {
    const players = getAllPlayerStats();

    if (players.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('👥 MapTap All Players')
            .setDescription('No scores recorded yet. Start playing MapTap!')
            .setColor(0x5865F2);
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('👥 MapTap All Players Leaderboard')
        .setDescription(`Ranked by average score (${players.length} players)`)
        .setColor(0x5865F2)
        .setTimestamp();

    const medals = ['🥇', '🥈', '🥉'];
    const playerText = players
        .map((p, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            return `${prefix} ${p.username} - **${formatAverage(p.average)}** avg\n   └ ${p.games} games | Best: ${p.best} | Worst: ${p.worst}`;
        })
        .join('\n');

    // Discord embed field limit is 1024 characters, description limit is 4096
    if (playerText.length > 4000) {
        // Split into multiple fields if too long
        const chunks = splitIntoChunks(playerText, 1000);
        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? 'Rankings' : '\u200b',
                value: chunks[i],
            });
        }
    } else {
        embed.setDescription(`Ranked by average score (${players.length} players)\n\n${playerText}`);
    }

    await interaction.reply({ embeds: [embed] });
}

function getAllPlayerStats(): PlayerStats[] {
    const stmt = db.prepare(`
        SELECT
            user_id,
            username,
            COUNT(*) as games,
            AVG(score) as average,
            MAX(score) as best,
            MIN(score) as worst
        FROM scores
        GROUP BY user_id
        ORDER BY average DESC
    `);
    return stmt.all() as PlayerStats[];
}

function splitIntoChunks(text: string, maxLength: number): string[] {
    const lines = text.split('\n');
    const chunks: string[] = [];
    let currentChunk = '';

    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}
