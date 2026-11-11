import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { db } from '../../database';
import { chunkEntriesForFields, DISCORD_EMBED_FIELD_LIMIT, formatAverage } from '../../utils/embeds';

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

    const header = `Ranked by average score (${players.length} players)`;
    const embed = new EmbedBuilder()
        .setTitle('👥 MapTap All Players Leaderboard')
        .setDescription(header)
        .setColor(0x5865F2)
        .setTimestamp();

    const medals = ['🥇', '🥈', '🥉'];
    const playerEntries = players.map((p, i) => {
        const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
        return `${prefix} ${p.username} - **${formatAverage(p.average)}** avg\n   └ ${p.games} games | Best: ${p.best} | Worst: ${p.worst}`;
    });

    const fullText = playerEntries.join('\n');
    if (header.length + 2 + fullText.length <= 3900) {
        embed.setDescription(`${header}\n\n${fullText}`);
    } else {
        const chunks = chunkEntriesForFields(playerEntries, {
            separator: '\n',
            maxFieldLength: DISCORD_EMBED_FIELD_LIMIT,
            maxFields: 20,
            maxTotalLength: 5200,
            overflowLabel: 'player',
        });

        for (let i = 0; i < chunks.length; i++) {
            embed.addFields({
                name: i === 0 ? 'Rankings' : '\u200b',
                value: chunks[i],
            });
        }
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
