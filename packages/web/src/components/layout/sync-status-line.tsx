import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { useOfflineStatus } from '@/providers/offline-status';

export function SyncStatusLine() {
	const { snapshot, online, sessionOffline, retrying, retry, dismissRejections } =
		useOfflineStatus();
	const pending = snapshot?.pendingCount ?? 0;
	const rejected = snapshot?.rejectedCount ?? 0;
	const syncing = retrying || snapshot?.syncing;
	const label = !snapshot
		? 'Checking sync status'
		: pending > 0
			? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting`
			: rejected > 0
				? `${rejected} ${rejected === 1 ? 'change' : 'changes'} rejected`
				: !snapshot.storageAvailable
					? 'Offline storage unavailable'
					: online && !sessionOffline
						? 'Up to date'
						: 'Offline';
	const Icon =
		!online || sessionOffline
			? CloudOff
			: pending > 0 || rejected > 0 || !snapshot?.storageAvailable
				? RefreshCw
				: Check;
	return (
		<div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 border-t border-white/20 bg-black px-3 py-1 text-xs text-white">
			<span role="status" className="flex items-center gap-2">
				<Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
				{label}
			</span>
			{pending > 0 ? (
				!snapshot?.storageAvailable ? (
					<span>Keep this tab open</span>
				) : !online ? (
					<span>Syncs when online</span>
				) : null
			) : null}
			{online && pending > 0 ? (
				<button
					type="button"
					disabled={syncing}
					onClick={() => void retry()}
					className="min-h-8 px-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 disabled:no-underline disabled:opacity-70"
				>
					{syncing ? 'Syncing' : 'Retry'}
				</button>
			) : null}
			{rejected > 0 ? (
				<button
					type="button"
					onClick={dismissRejections}
					className="min-h-8 px-2 underline underline-offset-4"
				>
					{pending > 0 ? `Dismiss ${rejected} rejected` : 'Dismiss'}
				</button>
			) : null}
		</div>
	);
}
