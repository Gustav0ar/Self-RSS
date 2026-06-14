import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/components/management/confirm-dialog';

describe('ConfirmDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the title, description, and action button labels', () => {
		render(
			<ConfirmDialog
				title="Delete category"
				description="This action cannot be undone."
				confirmLabel="Delete"
				onConfirm={() => {}}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByRole('heading', { name: 'Delete category' })).toBeTruthy();
		expect(screen.getByText('This action cannot be undone.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
	});

	it('calls onClose when the Cancel button is clicked', () => {
		const onClose = vi.fn();

		render(
			<ConfirmDialog
				title="Delete"
				description="x"
				confirmLabel="Yes"
				onConfirm={() => {}}
				onClose={onClose}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalled();
	});

	it('calls onConfirm when the confirm button is clicked', () => {
		const onConfirm = vi.fn();

		render(
			<ConfirmDialog
				title="Delete"
				description="x"
				confirmLabel="Yes"
				onConfirm={onConfirm}
				onClose={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
		expect(onConfirm).toHaveBeenCalled();
	});

	it('shows the in-flight label and disables both buttons while pending', () => {
		render(
			<ConfirmDialog
				title="Delete"
				description="x"
				confirmLabel="Delete"
				isPending
				onConfirm={() => {}}
				onClose={() => {}}
			/>,
		);

		const confirmButton = screen.getByRole('button', { name: 'Working...' });
		expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
	});

	it('renders the error message when the error prop is set', () => {
		render(
			<ConfirmDialog
				title="Delete"
				description="x"
				confirmLabel="Delete"
				error="Server says no"
				onConfirm={() => {}}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByText('Server says no')).toBeTruthy();
	});

	it('uses the danger tone for destructive confirmations', () => {
		render(
			<ConfirmDialog
				title="Delete"
				description="x"
				confirmLabel="Delete"
				confirmTone="danger"
				onConfirm={() => {}}
				onClose={() => {}}
			/>,
		);

		const confirmButton = screen.getByRole('button', { name: 'Delete' });
		expect(confirmButton.className).toContain('bg-red-600');
	});
});
