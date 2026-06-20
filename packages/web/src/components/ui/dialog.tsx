import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const focusableSelector =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
	children: ReactNode;
	onClose: () => void;
	ariaLabel?: string;
	ariaLabelledBy?: string;
	className?: string;
	panelClassName?: string;
	closeOnBackdrop?: boolean;
}

export function Dialog({
	children,
	onClose,
	ariaLabel,
	ariaLabelledBy,
	className,
	panelClassName,
	closeOnBackdrop = true,
}: DialogProps) {
	const dialogRef = useRef<HTMLDivElement | null>(null);
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.body.style.overflow;

		function getFocusable() {
			return Array.from(
				dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
			).filter((element) => {
				const disabled = element.getAttribute('aria-disabled') === 'true';
				const hidden = element.getAttribute('aria-hidden') === 'true';
				return !disabled && !hidden;
			});
		}

		function handleKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onCloseRef.current();
				return;
			}

			if (event.key !== 'Tab') {
				return;
			}

			const focusable = getFocusable();
			if (focusable.length === 0) {
				event.preventDefault();
				dialogRef.current?.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		}

		window.addEventListener('keydown', handleKey);
		document.body.style.overflow = 'hidden';
		window.setTimeout(() => {
			const firstFocusable = getFocusable()[0];
			(firstFocusable ?? dialogRef.current)?.focus();
		}, 0);

		return () => {
			window.removeEventListener('keydown', handleKey);
			document.body.style.overflow = previousOverflow;
			previouslyFocused?.focus();
		};
	}, []);

	return (
		<div
			ref={dialogRef}
			className={className}
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			tabIndex={-1}
			onMouseDown={(event) => {
				if (closeOnBackdrop && event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<div className={cn('relative', panelClassName)}>{children}</div>
		</div>
	);
}
