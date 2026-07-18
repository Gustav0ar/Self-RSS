import { cn } from '@/lib/utils';

export function FeedToolbarButton({
	active,
	onClick,
	label,
	children,
	disabled,
	className,
	title,
}: {
	active?: boolean;
	onClick: () => void;
	label: string;
	children: React.ReactNode;
	disabled?: boolean;
	className?: string;
	title?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={cn(
				'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
				active && 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary',
				className,
			)}
		>
			{children}
			{label}
		</button>
	);
}
