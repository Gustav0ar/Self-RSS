import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/middleware/errors.js';
import { OpmlImportService } from '../../src/services/opml-import.service.js';

describe('OpmlImportService', () => {
	it('parses nested category outlines into feed entries', () => {
		const service = new OpmlImportService({} as never, {} as never);

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
		const createdFeeds: Array<{
			userId: string;
			categoryId: string;
			feedUrl: string;
			title: string;
			siteUrl?: string | null;
			faviconUrl?: string | null;
			description?: string | null;
		}> = [];

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
			create: vi.fn(
				async (data: {
					userId: string;
					categoryId: string;
					feedUrl: string;
					title: string;
					siteUrl?: string | null;
					faviconUrl?: string | null;
					description?: string | null;
				}) => {
					createdFeeds.push(data);
					return { id: `feed-${createdFeeds.length}` };
				},
			),
		};

		const service = new OpmlImportService(categoryRepo as never, feedRepo as never);

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
				userId: 'user-1',
				categoryId: 'category-2',
				feedUrl: 'https://example.com/devtools.xml',
				title: 'DevTools Digest',
				siteUrl: null,
				faviconUrl: null,
				description: null,
			},
		]);
		expect(categoryRepo.create).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed OPML documents', () => {
		const service = new OpmlImportService({} as never, {} as never);

		expect(() => service.parse('<opml><body><outline></body>')).toThrowError(AppError);
	});

	it('reports invalid feed URLs without aborting the whole import', async () => {
		const categoryRepo = {
			findByName: vi.fn(),
			create: vi.fn(),
		};
		const feedRepo = {
			findByUrl: vi.fn(),
			create: vi.fn(),
		};
		const service = new OpmlImportService(categoryRepo as never, feedRepo as never);

		const summary = await service.import(
			'user-1',
			'feeds.opml',
			`<?xml version="1.0" encoding="UTF-8"?>
			<opml version="2.0">
				<body>
					<outline text="Engineering">
						<outline text="Invalid" xmlUrl="ftp://example.com/feed.xml" />
					</outline>
				</body>
			</opml>`,
		);

		expect(summary.createdCategories).toBe(0);
		expect(summary.createdFeeds).toBe(0);
		expect(summary.invalidEntries).toBe(1);
		expect(summary.warnings).toEqual([
			{
				code: 'INVALID_FEED_URL',
				message: 'Only HTTP and HTTPS feed URLs are allowed',
				feedUrl: 'ftp://example.com/feed.xml',
				categoryPath: ['Engineering'],
			},
		]);
		expect(categoryRepo.create).not.toHaveBeenCalled();
		expect(feedRepo.create).not.toHaveBeenCalled();
	});
});
