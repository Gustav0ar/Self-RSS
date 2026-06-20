import { render } from '@testing-library/react';
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
});
