import type { CategoryWithCounts } from '@self-feed/shared';
import { ArrowDown, ArrowUp, EllipsisVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CategoryReorderHandler } from './sidebar-reorder';

interface SidebarCategoryMoveMenuProps {
	category: CategoryWithCounts;
	siblingCategories: CategoryWithCounts[];
	siblingIndex: number;
	onReorderCategory: CategoryReorderHandler;
	onAnnounce: (message: string) => void;
}

export function SidebarCategoryMoveMenu({
	category,
	siblingCategories,
	siblingIndex,
	onReorderCategory,
	onAnnounce,
}: SidebarCategoryMoveMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isMoving, setIsMoving] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const moveUpRef = useRef<HTMLButtonElement>(null);
	const moveDownRef = useRef<HTMLButtonElement>(null);
	const canMoveUp = siblingIndex > 0;
	const canMoveDown = siblingIndex < siblingCategories.length - 1;

	useEffect(() => {
		if (!isOpen) return;
		const focusTimer = window.setTimeout(() => {
			(canMoveUp ? moveUpRef.current : moveDownRef.current)?.focus();
		}, 0);
		return () => window.clearTimeout(focusTimer);
	}, [canMoveUp, isOpen]);

	function closeAndRestoreFocus() {
		setIsOpen(false);
		window.setTimeout(() => triggerRef.current?.focus(), 0);
	}

	async function move(direction: 'up' | 'down') {
		if (isMoving || (direction === 'up' ? !canMoveUp : !canMoveDown)) return;
		const adjacent = siblingCategories[siblingIndex + (direction === 'up' ? -1 : 1)];
		if (!adjacent) return;

		setIsMoving(true);
		try {
			const succeeded =
				direction === 'up'
					? await onReorderCategory(adjacent.id, category.id)
					: await onReorderCategory(category.id, adjacent.id);
			if (!succeeded) return;
			const nextPosition = siblingIndex + (direction === 'up' ? 0 : 2);
			onAnnounce(
				`${category.name} moved ${direction} to position ${nextPosition} of ${siblingCategories.length}.`,
			);
			closeAndRestoreFocus();
		} catch {
			// Keep the menu open so the user can retry.
		} finally {
			setIsMoving(false);
		}
	}

	return (
		<div className="pointer-events-auto relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setIsOpen((current) => !current)}
				onKeyDown={(event) => {
					if (event.key !== 'Escape' || !isOpen) return;
					event.preventDefault();
					event.stopPropagation();
					closeAndRestoreFocus();
				}}
				aria-label={`Move ${category.name}`}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
			>
				<EllipsisVertical className="h-4 w-4" />
			</button>
			{isOpen ? (
				<div
					role="menu"
					aria-label={`Move ${category.name}`}
					onKeyDown={(event) => {
						if (event.key !== 'Escape') return;
						event.preventDefault();
						event.stopPropagation();
						closeAndRestoreFocus();
					}}
					className="absolute right-0 top-full z-50 w-40 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
				>
					<button
						ref={moveUpRef}
						type="button"
						role="menuitem"
						disabled={!canMoveUp || isMoving}
						onClick={() => void move('up')}
						className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
					>
						<ArrowUp className="h-4 w-4" />
						Move up
					</button>
					<button
						ref={moveDownRef}
						type="button"
						role="menuitem"
						disabled={!canMoveDown || isMoving}
						onClick={() => void move('down')}
						className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
					>
						<ArrowDown className="h-4 w-4" />
						Move down
					</button>
				</div>
			) : null}
		</div>
	);
}
