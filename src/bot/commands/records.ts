import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getAllTimeTopScores } from '../../database/queries';
import { formatNumber, formatAverage } from '../../utils/embeds';

export async function handleRecords(interaction: ChatInputCommandInteraction): Promise<void> {
    const topScores = getAllTimeTopScores(10);

    const embed = new EmbedBuilder()
        .setTitle('⭐ MapTap All-Time Top Scores')
        .setColor(0xFFD700)
        .setTimestamp();

    if (topScores.length === 0) {
        embed.setDescription('No scores recorded yet. Start playing MapTap!');
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const scoresText = topScores
        .map((s, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            const date = formatDate(s.game_date);
            return `${prefix} **${formatNumber(s.score)}** - ${s.username} (${date})\n   └ Daily avg: ${formatAverage(s.daily_average)}`;
        })
        .join('\n');

    embed.setDescription(scoresText);
    await interaction.reply({ embeds: [embed] });
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
