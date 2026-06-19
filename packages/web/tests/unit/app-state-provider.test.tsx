import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppStateProvider, useAppState } from '../../src/providers/app-state';

function AppStateProbe() {
	const state = useAppState();
	return (
		<div>
			<div>feed:{state.selectedFeedId ?? 'none'}</div>
			<button type="button" onClick={() => state.selectFeed('feed-1')}>
				select feed
			</button>
		</div>
	);
}

describe('AppStateProvider', () => {
	it('resets selection state when the reset key changes', () => {
		const { rerender } = render(
			<AppStateProvider resetKey="user-a">
				<AppStateProbe />
			</AppStateProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'select feed' }));
		expect(screen.getByText('feed:feed-1')).toBeTruthy();

		rerender(
			<AppStateProvider resetKey="user-b">
				<AppStateProbe />
			</AppStateProvider>,
		);

		expect(screen.getByText('feed:none')).toBeTruthy();
	});
});
