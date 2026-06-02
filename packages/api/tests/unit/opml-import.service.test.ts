import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/middleware/errors.js';
import { OpmlImportService } from '../../src/services/opml-import.service.js';

describe('OpmlImportService', () => {
	it('parses nested category outlines into feed entries', () => {
		const service = new OpmlImportService({} as never, {} as never, {} as never);

		const entries = service.parse(`<?xml version="1.0" encoding="UTF-8"?>
		<opml version="2.0">
			<body>
				<outline text="Engineering">
					<outline text="Frontend">
						<outline text="DevTools Digest" xmlUrl="https://example.com/devtools.xml" />
					</outline>
				</outline>
			</body>
		</opml>`);

		expect(entries).toEqual([
			{
				feedUrl: 'https://example.com/devtools.xml',
				title: 'DevTools Digest',
				categoryPath: ['Engineering', 'Frontend'],
			},
		]);
	});

	it('creates missing categories and skips duplicate feeds during import', async () => {
		const createdCategories: Array<{ id: string; name: string; parentCategoryId: string | null }> =
			[];
		const createdFeeds: Array<{ categoryId: string; feedUrl: string; title?: string }> = [];

		const categoryRepo = {
			findByName: vi.fn(async (_userId: string, name: string, parentCategoryId: string | null) => {
				return (
					createdCategories.find(
						(category) => category.name === name && category.parentCategoryId === parentCategoryId,
					) ?? null
				);
			}),
			create: vi.fn(
				async (data: {
					userId: string;
					name: string;
					slug: string;
					parentCategoryId?: string | null;
					sortOrder?: number;
				}) => {
					const category = {
						id: `category-${createdCategories.length + 1}`,
						name: data.name,
						parentCategoryId: data.parentCategoryId ?? null,
					};
					createdCategories.push(category);
					return category;
				},
			),
		};

		const feedRepo = {
			findByUrl: vi.fn(async (_userId: string, feedUrl: string) => {
				if (feedUrl === 'https://example.com/already.xml') {
					return { id: 'existing-feed' };
				}
				return null;
			}),
		};

		const feedService = {
			normalizeFeedUrl: vi.fn((feedUrl: string) => feedUrl),
			create: vi.fn(
				async (_userId: string, data: { categoryId: string; feedUrl: string; title?: string }) => {
					createdFeeds.push(data);
					return { id: `feed-${createdFeeds.length}` };
				},
			),
		};

		const service = new OpmlImportService(
			categoryRepo as never,
			feedRepo as never,
			feedService as never,
		);

		const summary = await service.import(
			'user-1',
			'feeds.opml',
			`<?xml version="1.0" encoding="UTF-8"?>
			<opml version="2.0">
				<body>
					<outline text="Engineering">
						<outline text="Frontend">
							<outline text="DevTools Digest" xmlUrl="https://example.com/devtools.xml" />
							<outline text="Already Added" xmlUrl="https://example.com/already.xml" />
						</outline>
					</outline>
				</body>
			</opml>`,
		);

		expect(summary.createdCategories).toBe(2);
		expect(summary.createdFeeds).toBe(1);
		expect(summary.skippedDuplicates).toBe(1);
		expect(summary.invalidEntries).toBe(0);
		expect(createdFeeds).toEqual([
			{
				categoryId: 'category-2',
				feedUrl: 'https://example.com/devtools.xml',
				title: 'DevTools Digest',
			},
		]);
	});

	it('rejects malformed OPML documents', () => {
		const service = new OpmlImportService({} as never, {} as never, {} as never);

		expect(() => service.parse('<opml><body><outline></body>')).toThrowError(AppError);
	});
});
