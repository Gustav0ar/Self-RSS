import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpmlImportDialog } from '../../src/components/management/opml-import-dialog';

const importMutateAsync = vi.fn();

vi.mock('@/hooks/queries', () => ({
	useImportOpml: () => ({
		mutateAsync: importMutateAsync,
		isPending: false,
	}),
}));

describe('OpmlImportDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not submit when no file has been chosen', async () => {
		const onClose = vi.fn();
		render(<OpmlImportDialog onClose={onClose} />);

		fireEvent.click(screen.getByRole('button', { name: 'Import feeds' }));

		await waitFor(() => {
			expect(importMutateAsync).not.toHaveBeenCalled();
		});
	});

	it('submits the selected file and shows the summary on success', async () => {
		importMutateAsync.mockResolvedValue({
			createdCategories: 1,
			createdFeeds: 2,
			skippedDuplicates: 1,
			invalidEntries: 0,
			warnings: [],
		});
		const onClose = vi.fn();

		render(<OpmlImportDialog onClose={onClose} />);

		const file = new File(
			['<?xml version="1.0"?><opml version="2.0"><body/></opml>'],
			'feeds.opml',
			{
				type: 'text/xml',
			},
		);
		const input = screen.getByLabelText('OPML file') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [file] } });

		fireEvent.click(screen.getByRole('button', { name: 'Import feeds' }));

		await waitFor(() => {
			expect(importMutateAsync).toHaveBeenCalledWith(file);
		});
		expect(await screen.findByText('Import summary')).toBeTruthy();
		expect(screen.getByText('Created categories')).toBeTruthy();
		expect(screen.getByText('Created feeds')).toBeTruthy();
		expect(screen.getByText('Skipped duplicates')).toBeTruthy();
	});

	it('surfaces the error message when the import fails', async () => {
		importMutateAsync.mockRejectedValue(new Error('Invalid OPML file'));

		render(<OpmlImportDialog onClose={() => {}} />);

		const file = new File(['not xml'], 'broken.opml', { type: 'text/xml' });
		const input = screen.getByLabelText('OPML file') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [file] } });
		fireEvent.click(screen.getByRole('button', { name: 'Import feeds' }));

		await waitFor(() => {
			expect(screen.getByText('Invalid OPML file')).toBeTruthy();
		});
	});
});
