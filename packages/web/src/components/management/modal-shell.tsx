import { X } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Dialog } from '@/components/ui/dialog';

interface ModalShellProps {
	title: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
}

export function ModalShell({ title, onClose, children, footer }: ModalShellProps) {
	const titleId = useId();

	return (
		<Dialog
			onClose={onClose}
			ariaLabelledBy={titleId}
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-md"
			panelClassName="surface-card motion-scale w-full max-w-lg rounded-[1.75rem] p-6 shadow-2xl sm:p-7"
		>
			<div className="mb-5 flex items-start justify-between gap-4">
				<div>
					<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
						Workspace action
					</p>
					<h2 id={titleId} className="mt-1 text-xl font-semibold tracking-tight">
						{title}
					</h2>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Close"
				>
					<X className="h-4 w-4" />
				</button>
			</div>
			<div className="space-y-4">{children}</div>
			{footer ? <div className="mt-6 flex items-center justify-end gap-2">{footer}</div> : null}
		</Dialog>
	);
}
