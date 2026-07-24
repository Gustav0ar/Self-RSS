import { TriangleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface SidebarFeedHealthIndicatorProps {
	descriptionId: string;
	feedTitle: string;
	severity: 'warning' | 'error';
	warning: string;
}

export function SidebarFeedHealthIndicator({
	descriptionId,
	feedTitle,
	severity,
	warning,
}: SidebarFeedHealthIndicatorProps) {
	const anchorRef = useRef<HTMLButtonElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
	const tooltipId = useId();

	function showTooltip() {
		const rect = anchorRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({ left: rect.left + rect.width / 2, top: rect.top - 8 });
	}

	return (
		<button
			ref={anchorRef}
			type="button"
			className={cn(
				'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl outline-none hover:bg-background/80 focus-visible:ring-2',
				severity === 'error'
					? 'text-amber-400 focus-visible:ring-amber-300/60'
					: 'text-muted-foreground focus-visible:ring-muted-foreground/40',
			)}
			aria-label={`Show health details for ${feedTitle}`}
			aria-describedby={descriptionId}
			aria-controls={tooltipId}
			aria-expanded={position != null}
			onClick={(event) => {
				event.stopPropagation();
				showTooltip();
			}}
			onMouseEnter={showTooltip}
			onMouseLeave={() => {
				if (document.activeElement !== anchorRef.current) setPosition(null);
			}}
			onFocus={showTooltip}
			onBlur={() => setPosition(null)}
			onKeyDown={(event) => {
				if (event.key !== 'Escape') return;
				event.preventDefault();
				event.stopPropagation();
				setPosition(null);
			}}
		>
			<TriangleAlert className="h-3.5 w-3.5" />
			{position
				? createPortal(
						<div
							id={tooltipId}
							role="tooltip"
							style={{ left: position.left, top: position.top }}
							className="pointer-events-none fixed z-[100] w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-amber-300/20 bg-popover px-3 py-2 text-left text-xs font-normal leading-5 text-popover-foreground shadow-2xl"
						>
							{warning}
						</div>,
						document.body,
					)
				: null}
		</button>
	);
}
