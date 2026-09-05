import { Download } from 'lucide-react';
import { useOfflineStatus } from '@/providers/offline-status';

export function OfflineTextStatus({ articleId }: { articleId: string }) {
	const { snapshot } = useOfflineStatus();
	const available = snapshot?.articleIds.has(articleId) ?? false;
	return (
		<span className="mt-1 flex items-center gap-1 text-xs leading-4 text-muted-foreground">
			<Download aria-hidden="true" className="h-3 w-3 shrink-0" />
			{!snapshot
				? 'Checking offline text'
				: available
					? 'Text available offline'
					: 'Text not downloaded'}
		</span>
	);
}
