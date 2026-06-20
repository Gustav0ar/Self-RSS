import { Activity, AlertTriangle, BarChart3, BookOpen, FolderOpen, Rss } from 'lucide-react';
import { useStats } from '@/hooks/queries';
import { cn } from '@/lib/utils';

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
	const syncFailures = stats.recentSyncRuns.filter(
		(run) =>
			run &&
			typeof run === 'object' &&
			'status' in run &&
			(run as { status?: unknown }).status === 'failed',
	).length;
	const totalRecentActivity = stats.dailyMetrics.reduce(
		(total, metric) =>
			total + metric.articlesReadCount + metric.feedsSyncedCount + metric.searchCount,
		0,
	);

	return (
		<div className="p-4 sm:p-6">
			<div className="mb-5 flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
						Workspace health
					</p>
					<h2 className="mt-1 text-lg font-semibold tracking-tight">Dashboard</h2>
				</div>
				<div
					className={cn(
						'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
						syncFailures > 0
							? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
							: 'border-border bg-background/50 text-muted-foreground',
					)}
				>
					{syncFailures > 0 ? (
						<AlertTriangle className="h-3.5 w-3.5" />
					) : (
						<Activity className="h-3.5 w-3.5" />
					)}
					<span>
						{syncFailures > 0 ? `${syncFailures} recent sync issues` : 'Feeds syncing cleanly'}
					</span>
				</div>
			</div>

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

			{stats.dailyMetrics.length > 0 && (
				<div className="mt-6">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<h3 className="flex items-center gap-2 text-sm font-medium">
							<BarChart3 className="h-4 w-4" />
							Last 30 Days Activity
						</h3>
						<p className="text-xs text-muted-foreground">
							{totalRecentActivity.toLocaleString()} total actions
						</p>
					</div>
					<ActivityChart metrics={stats.dailyMetrics} />
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

type DailyMetric = NonNullable<ReturnType<typeof useStats>['data']>['dailyMetrics'][number];

function ActivityChart({ metrics }: { metrics: DailyMetric[] }) {
	const visibleMetrics = metrics.slice(-30);
	const maxTotal = Math.max(
		1,
		...visibleMetrics.map(
			(metric) => metric.articlesReadCount + metric.feedsSyncedCount + metric.searchCount,
		),
	);

	return (
		<div
			className="mb-4 flex h-36 items-end gap-1 rounded-lg border border-border bg-background/45 px-3 py-3"
			aria-label="Daily activity chart"
			role="img"
		>
			{visibleMetrics.map((metric) => {
				const total = metric.articlesReadCount + metric.feedsSyncedCount + metric.searchCount;
				const height = Math.max(6, Math.round((total / maxTotal) * 100));
				return (
					<div key={metric.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
						<div
							className="w-full rounded-t bg-primary/80"
							style={{ height: `${height}%` }}
							title={`${metric.date}: ${total} actions`}
							aria-hidden="true"
						/>
						<span className="sr-only">
							{metric.date}: {total} actions
						</span>
					</div>
				);
			})}
		</div>
	);
}
