import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getBiggestDeltas } from '../../database/queries';
import { formatNumber, formatAverage } from '../../utils/embeds';

export async function handleDelta(interaction: ChatInputCommandInteraction): Promise<void> {
    const topDeltas = getBiggestDeltas(10);

    const embed = new EmbedBuilder()
        .setTitle('📈 MapTap Biggest Deltas')
        .setDescription('Highest scores above the daily average')
        .setColor(0x00D4AA)
        .setTimestamp();

    if (topDeltas.length === 0) {
        embed.setDescription('No scores recorded yet. Start playing MapTap!');
        await interaction.reply({ embeds: [embed] });
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const deltasText = topDeltas
        .map((d, i) => {
            const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
            const date = formatDate(d.game_date);
            return `${prefix} **+${formatAverage(d.delta)}** - ${d.username} (${date})\n   └ Score: ${formatNumber(d.score)} | Avg: ${formatAverage(d.daily_average)}`;
        })
        .join('\n');

    embed.setDescription(deltasText);
    await interaction.reply({ embeds: [embed] });
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
