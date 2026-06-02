import { ModalShell } from './modal-shell';

interface ConfirmDialogProps {
	title: string;
	description: string;
	confirmLabel: string;
	confirmTone?: 'default' | 'danger';
	isPending?: boolean;
	error?: string | null;
	onConfirm: () => void;
	onClose: () => void;
}

export function ConfirmDialog({
	title,
	description,
	confirmLabel,
	confirmTone = 'default',
	isPending = false,
	error,
	onConfirm,
	onClose,
}: ConfirmDialogProps) {
	return (
		<ModalShell
			title={title}
			onClose={onClose}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						className="rounded-2xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={isPending}
						className={
							confirmTone === 'danger'
								? 'rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50'
								: 'rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
						}
					>
						{isPending ? 'Working...' : confirmLabel}
					</button>
				</>
			}
		>
			<p className="text-sm leading-6 text-muted-foreground">{description}</p>
			{error ? (
				<div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
					{error}
				</div>
			) : null}
		</ModalShell>
	);
}
