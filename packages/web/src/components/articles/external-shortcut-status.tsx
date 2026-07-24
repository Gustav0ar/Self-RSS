export function ExternalShortcutStatus({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p
			role="status"
			className="border-b border-border/70 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
		>
			{message}
		</p>
	);
}
