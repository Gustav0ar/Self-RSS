import { ArrowDown, ArrowUp, EllipsisVertical, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface SidebarActionsMenuProps {
	name: string;
	onEdit: () => void;
	onDelete: () => void;
	move?: {
		canMoveUp: boolean;
		canMoveDown: boolean;
		onMove: (direction: 'up' | 'down') => Promise<boolean>;
	};
}

export function SidebarActionsMenu({ name, onEdit, onDelete, move }: SidebarActionsMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isMoving, setIsMoving] = useState(false);
	const [position, setPosition] = useState({ left: 0, top: 0 });
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	useLayoutEffect(() => {
		if (!isOpen || !triggerRef.current || !menuRef.current) return;
		const anchor = triggerRef.current.getBoundingClientRect();
		const menu = menuRef.current.getBoundingClientRect();
		setPosition({
			left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
			top:
				anchor.bottom + menu.height + 4 <= window.innerHeight - 8
					? anchor.bottom + 4
					: Math.max(8, anchor.top - menu.height - 4),
		});
		menuRef.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		function dismissOutside(event: Event) {
			if (
				event.target instanceof Node &&
				!triggerRef.current?.contains(event.target) &&
				!menuRef.current?.contains(event.target)
			) {
				setIsOpen(false);
			}
		}
		function dismissOnViewportChange() {
			setIsOpen(false);
		}
		document.addEventListener('pointerdown', dismissOutside);
		document.addEventListener('focusin', dismissOutside);
		window.addEventListener('resize', dismissOnViewportChange);
		window.addEventListener('scroll', dismissOnViewportChange, true);
		return () => {
			document.removeEventListener('pointerdown', dismissOutside);
			document.removeEventListener('focusin', dismissOutside);
			window.removeEventListener('resize', dismissOnViewportChange);
			window.removeEventListener('scroll', dismissOnViewportChange, true);
		};
	}, [isOpen]);

	function closeAndRestoreFocus() {
		setIsOpen(false);
		triggerRef.current?.focus();
	}

	async function moveCategory(direction: 'up' | 'down') {
		if (!move || isMoving || (direction === 'up' ? !move.canMoveUp : !move.canMoveDown)) return;
		setIsMoving(true);
		try {
			if (await move.onMove(direction)) closeAndRestoreFocus();
		} catch {
			// Keep the menu open so the user can retry.
		} finally {
			setIsMoving(false);
		}
	}

	const itemClassName =
		'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setIsOpen((current) => !current)}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						event.stopPropagation();
						setIsOpen(true);
					} else if (event.key === 'Escape' && isOpen) {
						event.preventDefault();
						event.stopPropagation();
						closeAndRestoreFocus();
					}
				}}
				aria-label={`Actions for ${name}`}
				aria-haspopup="menu"
				aria-controls={isOpen ? menuId : undefined}
				aria-expanded={isOpen}
				className="inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 pointer-coarse:w-11"
			>
				<EllipsisVertical className="h-4 w-4" />
			</button>
			{isOpen
				? createPortal(
						<div
							ref={menuRef}
							id={menuId}
							role="menu"
							aria-label={`Actions for ${name}`}
							style={position}
							className="fixed z-[100] w-44 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
							onKeyDown={(event) => {
								if (event.key === 'Escape' || event.key === 'Tab') {
									if (event.key === 'Escape') event.preventDefault();
									event.stopPropagation();
									closeAndRestoreFocus();
									return;
								}
								if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
								event.preventDefault();
								event.stopPropagation();
								const items = Array.from(
									event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
								);
								const activeElement = document.activeElement;
								const index =
									activeElement instanceof HTMLButtonElement ? items.indexOf(activeElement) : -1;
								const nextIndex =
									event.key === 'Home'
										? 0
										: event.key === 'End'
											? items.length - 1
											: (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
								items[nextIndex]?.focus();
							}}
						>
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									closeAndRestoreFocus();
									onEdit();
								}}
								className={itemClassName}
							>
								<Pencil className="h-4 w-4" />
								Edit
							</button>
							{move ? (
								<>
									<button
										type="button"
										role="menuitem"
										disabled={!move.canMoveUp || isMoving}
										onClick={() => void moveCategory('up')}
										className={itemClassName}
									>
										<ArrowUp className="h-4 w-4" />
										Move up
									</button>
									<button
										type="button"
										role="menuitem"
										disabled={!move.canMoveDown || isMoving}
										onClick={() => void moveCategory('down')}
										className={itemClassName}
									>
										<ArrowDown className="h-4 w-4" />
										Move down
									</button>
								</>
							) : null}
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									closeAndRestoreFocus();
									onDelete();
								}}
								className={`${itemClassName} text-red-400`}
							>
								<Trash2 className="h-4 w-4" />
								Delete
							</button>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
