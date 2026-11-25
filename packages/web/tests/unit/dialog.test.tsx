import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../../src/components/ui/dialog';

describe('Dialog', () => {
	it('clears the scheduled focus timer when it unmounts before the timer fires', () => {
		vi.useFakeTimers();
		const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

		try {
			const { unmount } = render(
				<Dialog ariaLabel="Test dialog" onClose={() => {}}>
					<button type="button">Confirm</button>
				</Dialog>,
			);

			expect(clearTimeoutSpy).not.toHaveBeenCalled();

			unmount();

			expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
		} finally {
			clearTimeoutSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it('only closes the topmost dialog on Escape when dialogs are nested', () => {
		const closeOuter = vi.fn();
		const closeInner = vi.fn();

		render(
			<Dialog ariaLabel="Outer drawer" onClose={closeOuter}>
				<Dialog ariaLabel="Inner modal" onClose={closeInner}>
					<button type="button">Action</button>
				</Dialog>
			</Dialog>,
		);

		fireEvent.keyDown(window, { key: 'Escape' });

		expect(closeInner).toHaveBeenCalledTimes(1);
		expect(closeOuter).not.toHaveBeenCalled();
	});
});
