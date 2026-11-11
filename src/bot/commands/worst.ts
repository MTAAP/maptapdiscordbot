import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { db } from '../../database';
import { formatNumber, formatAverage } from '../../utils/embeds';

interface WorstScore {
    user_id: string;
    username: string;
    score: number;
    game_date: string;
    daily_average: number;
}

export async function handleWorst(interaction: ChatInputCommandInteraction): Promise<void> {
    const worstScores = getWorstScores(10);

    const embed = new EmbedBuilder()
        .setTitle('💩 MapTap Worst Scores')
        .setDescription('The lowest scores ever recorded')
        .setColor(0x8B4513)
        .setTimestamp();

    if (worstScores.length === 0) {
        embed.setDescription('No scores recorded yet. Start playing MapTap!');
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const scoresText = worstScores
        .map((s, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            const date = formatDate(s.game_date);
            const delta = s.score - s.daily_average;
            return `${prefix} **${formatNumber(s.score)}** - ${s.username} (${date})\n   └ Daily avg: ${formatAverage(s.daily_average)} (${formatAverage(delta)})`;
        })
        .join('\n');

    embed.setDescription(scoresText);
    await interaction.reply({ embeds: [embed] });
}

function getWorstScores(limit: number): WorstScore[] {
    const stmt = db.prepare(`
        SELECT s.user_id, s.username, s.score, s.game_date,
            (SELECT AVG(score) FROM scores WHERE game_date = s.game_date) as daily_average
        FROM scores s
        ORDER BY s.score ASC
        LIMIT ?
    `);
    return stmt.all(limit) as WorstScore[];
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
