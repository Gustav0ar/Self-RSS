import { BarChart3, BookOpen, FolderOpen, Rss } from 'lucide-react';
import { useStats } from '@/hooks/queries';

export function StatsPanel() {
	const { data: stats, isLoading } = useStats();

	if (isLoading || !stats) {
		return <div className="p-4 text-sm text-muted-foreground">Loading stats...</div>;
	}

	const cards = [
		{
			label: 'Unread',
			value: stats.totalUnread,
			icon: BookOpen,
			color: 'text-blue-500',
		},
		{
			label: 'Read',
			value: stats.totalRead,
			icon: BookOpen,
			color: 'text-green-500',
		},
		{
			label: 'Feeds',
			value: stats.totalFeeds,
			icon: Rss,
			color: 'text-orange-500',
		},
		{
			label: 'Categories',
			value: stats.totalCategories,
			icon: FolderOpen,
			color: 'text-purple-500',
		},
	];

	return (
		<div className="p-6">
			<h2 className="mb-4 text-lg font-semibold">Dashboard</h2>

			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				{cards.map((card) => (
					<div key={card.label} className="rounded-lg border border-border bg-card p-4">
						<div className="flex items-center gap-2">
							<card.icon className={`h-4 w-4 ${card.color}`} />
							<span className="text-xs text-muted-foreground">{card.label}</span>
						</div>
						<p className="mt-2 text-2xl font-bold">{card.value}</p>
					</div>
				))}
			</div>

			{/* Daily metrics chart (simple text-based) */}
			{stats.dailyMetrics.length > 0 && (
				<div className="mt-6">
					<h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
						<BarChart3 className="h-4 w-4" />
						Last 30 Days Activity
					</h3>
					<div className="overflow-auto rounded-lg border border-border">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-border bg-accent/50">
									<th className="px-4 py-2 text-left font-medium">Date</th>
									<th className="px-4 py-2 text-right font-medium">Read</th>
									<th className="px-4 py-2 text-right font-medium">Synced</th>
									<th className="px-4 py-2 text-right font-medium">Searches</th>
								</tr>
							</thead>
							<tbody>
								{stats.dailyMetrics.map((m) => (
									<tr key={m.date} className="border-b border-border last:border-0">
										<td className="px-4 py-2 text-muted-foreground">{m.date}</td>
										<td className="px-4 py-2 text-right">{m.articlesReadCount}</td>
										<td className="px-4 py-2 text-right">{m.feedsSyncedCount}</td>
										<td className="px-4 py-2 text-right">{m.searchCount}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}
