import type { OpmlImportSummary } from '@self-feed/shared';
import { useState } from 'react';
import { useImportOpml } from '@/hooks/queries';
import { ModalShell } from './modal-shell';

interface OpmlImportDialogProps {
	onClose: () => void;
}

export function OpmlImportDialog({ onClose }: OpmlImportDialogProps) {
	const importOpml = useImportOpml();
	const [file, setFile] = useState<File | null>(null);
	const [summary, setSummary] = useState<OpmlImportSummary | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!file) {
			setError('Select an OPML file to import');
			return;
		}

		setError(null);
		try {
			const result = await importOpml.mutateAsync(file);
			setSummary(result);
		} catch (submitError) {
			setSummary(null);
			setError(submitError instanceof Error ? submitError.message : 'Import failed');
		}
	}

	return (
		<ModalShell title="Import OPML" onClose={onClose}>
			<p className="text-sm leading-6 text-muted-foreground">
				Upload an OPML file to import feeds and create any missing categories.
			</p>
			{error ? (
				<div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
					{error}
				</div>
			) : null}
			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="opml-file" className="mb-2 block text-sm font-medium">
						OPML file
					</label>
					<input
						id="opml-file"
						type="file"
						accept=".opml,.xml,text/xml,application/xml"
						onChange={(event) => setFile(event.target.files?.[0] ?? null)}
						className="block w-full rounded-2xl border border-dashed border-border bg-background/40 px-4 py-4 text-sm text-muted-foreground"
					/>
				</div>

				<div className="flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-2xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={importOpml.isPending}
						className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{importOpml.isPending ? 'Importing...' : 'Import feeds'}
					</button>
				</div>
			</form>

			{summary ? (
				<div className="surface-muted rounded-[1.5rem] p-5">
					<h3 className="text-sm font-semibold">Import summary</h3>
					<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
						<div>
							<p className="text-muted-foreground">Created categories</p>
							<p className="mt-1 text-lg font-semibold">{summary.createdCategories}</p>
						</div>
						<div>
							<p className="text-muted-foreground">Created feeds</p>
							<p className="mt-1 text-lg font-semibold">{summary.createdFeeds}</p>
						</div>
						<div>
							<p className="text-muted-foreground">Skipped duplicates</p>
							<p className="mt-1 text-lg font-semibold">{summary.skippedDuplicates}</p>
						</div>
						<div>
							<p className="text-muted-foreground">Invalid entries</p>
							<p className="mt-1 text-lg font-semibold">{summary.invalidEntries}</p>
						</div>
					</div>
					{summary.warnings.length > 0 ? (
						<div className="mt-4 space-y-2">
							<p className="text-sm font-medium">Warnings</p>
							<ul className="space-y-1 text-sm text-muted-foreground">
								{summary.warnings.map((warning, index) => (
									<li key={`${warning.code}-${warning.feedUrl ?? index}`}>{warning.message}</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			) : null}
		</ModalShell>
	);
}
