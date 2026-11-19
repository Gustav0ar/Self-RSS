/** Let text fields, dialogs, and the browser handle their own keys. */
export function canUseAppShortcut(event: KeyboardEvent) {
	if (
		event.defaultPrevented ||
		event.isComposing ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey
	) {
		return false;
	}
	const target = event.target;
	if (!(target instanceof Element)) return true;
	if (
		target.closest(
			'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
		)
	) {
		return false;
	}
	return event.key !== 'Enter' || !target.closest('button, a[href], summary, [role="button"]');
}
