import { useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/management/confirm-dialog';
import { useMarkAllRead } from '@/hooks/queries';

interface MarkAllReadDialogProps {
	feedId?: string;
	categoryId?: string;
	feedTitle?: string;
	categoryTitle?: string;
	unreadCount: number;
	onSuccess: () => void;
	onClose: () => void;
}

export function MarkAllReadDialog({
	feedId,
	categoryId,
	feedTitle,
	categoryTitle,
	unreadCount,
	onSuccess,
	onClose,
}: MarkAllReadDialogProps) {
	const markAllRead = useMarkAllRead();
	const [error, setError] = useState<string | null>(null);
	const [isConfirming, setIsConfirming] = useState(false);
	const submissionRef = useRef(false);
	const scope = feedTitle
		? `feed “${feedTitle}”`
		: categoryTitle
			? `category “${categoryTitle}”`
			: 'all feeds';
	const description =
		unreadCount > 0
			? `Mark ${unreadCount} unread ${
					unreadCount === 1 ? 'article' : 'articles'
				} in ${scope} as read?`
			: `Mark every unread article in ${scope} as read?`;
	const isPending = isConfirming || markAllRead.isPending;

	async function handleConfirm() {
		if (submissionRef.current) {
			return;
		}

		submissionRef.current = true;
		setIsConfirming(true);
		setError(null);
		let succeeded = false;
		try {
			await markAllRead.mutateAsync({ feedId, categoryId });
			onSuccess();
			succeeded = true;
		} catch (submitError) {
			const detail = submitError instanceof Error ? ` ${submitError.message}` : '';
			setError(`Could not mark articles as read.${detail} Check your connection and retry.`);
		} finally {
			submissionRef.current = false;
			setIsConfirming(false);
		}
		if (succeeded) {
			onClose();
		}
	}

	return (
		<ConfirmDialog
			title="Mark all as read?"
			description={description}
			confirmLabel="Mark all read"
			isPending={isPending}
			error={error}
			onConfirm={() => void handleConfirm()}
			onClose={onClose}
		/>
	);
}
