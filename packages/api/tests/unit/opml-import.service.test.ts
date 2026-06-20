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

	it('creates categories with the same slug name under different parents', async () => {
		// This tests that the slug uniqueness is now (userId, parentId, slug),
		// not just (userId, slug)
		const createdCategories: Array<{
			id: string;
			name: string;
			slug: string;
			parentCategoryId: string | null;
		}> = [];
		const createdFeeds: Array<{
			userId: string;
			categoryId: string;
			feedUrl: string;
			title: string;
		}> = [];

		const categoryRepo = {
			findAllByUser: vi.fn(async () => []),
			createManyInTransaction: vi.fn(
				async (rows: Array<{ name: string; slug: string; parentCategoryId: string | null }>) => {
					const inserted: Array<{
						id: string;
						name: string;
						slug: string;
						parentCategoryId: string | null;
					}> = [];
					// Simulate how the real implementation resolves __pending__ placeholders
					for (const r of rows) {
						let resolvedParent: string | null = r.parentCategoryId;
						if (typeof resolvedParent === 'string' && resolvedParent.startsWith('__pending__:')) {
							const idx = Number.parseInt(resolvedParent.slice('__pending__:'.length), 10);
							resolvedParent =
								Number.isInteger(idx) && idx >= 0 && idx < inserted.length
									? (inserted[idx]?.id ?? null)
									: null;
						}
						const category = {
							id: `category-${createdCategories.length + 1}`,
							name: r.name,
							slug: r.slug,
							parentCategoryId: resolvedParent,
						};
						createdCategories.push(category);
						inserted.push(category);
					}
					return inserted;
				},
			),
		};

		const feedRepo = {
			findByUrls: vi.fn(async () => []),
			createMany: vi.fn(
				async (
					rows: Array<{
						userId: string;
						categoryId: string;
						feedUrl: string;
						title: string;
					}>,
				) => {
					for (const row of rows) {
						createdFeeds.push({
							userId: row.userId,
							categoryId: row.categoryId,
							feedUrl: row.feedUrl,
							title: row.title,
						});
					}
					return rows.map((_, i) => ({ id: `feed-${i + 1}` }));
				},
			),
		};

		const service = new OpmlImportService(categoryRepo as never, feedRepo as never, {
			allowPrivateHosts: true,
		});

		const summary = await service.import(
			'user-1',
			'feeds.opml',
			`<?xml version="1.0" encoding="UTF-8"?>
			<opml version="2.0">
				<body>
					<outline text="Work">
						<outline text="News">
							<outline text="Work News Feed" xmlUrl="https://example.com/work-news.xml" />
						</outline>
					</outline>
					<outline text="Personal">
						<outline text="News">
							<outline text="Personal News Feed" xmlUrl="https://example.com/personal-news.xml" />
						</outline>
					</outline>
				</body>
			</opml>`,
		);

		// Categories created: Work, Personal, News (under Work), News (under Personal) = 4
		expect(summary.createdCategories).toBe(4);
		expect(summary.createdFeeds).toBe(2);
		expect(summary.invalidEntries).toBe(0);

		// Both "News" categories should have the same slug "news"
		const newsCategories = createdCategories.filter((c) => c.name === 'News');
		expect(newsCategories).toHaveLength(2);
		expect(newsCategories[0]?.slug).toBe('news');
		expect(newsCategories[1]?.slug).toBe('news');

		// Both "News" categories should have different parents
		const workParentId = createdCategories.find((c) => c.name === 'Work')?.id;
		const personalParentId = createdCategories.find((c) => c.name === 'Personal')?.id;
		expect(newsCategories[0]?.parentCategoryId).toBe(workParentId);
		expect(newsCategories[1]?.parentCategoryId).toBe(personalParentId);
		expect(workParentId).not.toBe(personalParentId);
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
			findAllByUser: vi.fn(async () => createdCategories),
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
			createManyInTransaction: vi.fn(
				async (rows: Array<{ name: string; parentCategoryId: string | null }>) => {
					const inserted: Array<{
						id: string;
						name: string;
						parentCategoryId: string | null;
					}> = [];
					for (const r of rows) {
						const category = {
							id: `category-${createdCategories.length + 1}`,
							name: r.name,
							parentCategoryId: r.parentCategoryId,
						};
						createdCategories.push(category);
						inserted.push(category);
					}
					return inserted;
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
			findByUrls: vi.fn(async (_userId: string, urls: string[]) =>
				urls.filter((u) => u === 'https://example.com/already.xml').map((feedUrl) => ({ feedUrl })),
			),
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
			createMany: vi.fn(
				async (
					rows: Array<{
						userId: string;
						categoryId: string;
						feedUrl: string;
						title: string;
					}>,
				) => {
					for (const row of rows) {
						createdFeeds.push({
							userId: row.userId,
							categoryId: row.categoryId,
							feedUrl: row.feedUrl,
							title: row.title,
							siteUrl: null,
							faviconUrl: null,
							description: null,
						});
					}
					return rows.map((_, i) => ({ id: `feed-${createdFeeds.length - rows.length + i + 1}` }));
				},
			),
		};

		const service = new OpmlImportService(categoryRepo as never, feedRepo as never, {
			allowPrivateHosts: true,
		});

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
		expect(categoryRepo.createManyInTransaction).toHaveBeenCalledTimes(1);
		expect(feedRepo.createMany).toHaveBeenCalledTimes(1);
	});

	it('rolls back categories created by the import when feed batch insertion fails', async () => {
		const categoryRepo = {
			findAllByUser: vi.fn(async () => []),
			createManyInTransaction: vi.fn(
				async (rows: Array<{ name: string; parentCategoryId: string | null }>) =>
					rows.map((row, index) => ({
						id: `category-${index + 1}`,
						name: row.name,
						parentCategoryId: row.parentCategoryId,
					})),
			),
			delete: vi.fn(async (id: string) => ({ id })),
		};
		const feedRepo = {
			findByUrls: vi.fn(async () => []),
			createMany: vi.fn(async () => {
				throw new Error('feed batch failed');
			}),
		};
		const service = new OpmlImportService(categoryRepo as never, feedRepo as never, {
			allowPrivateHosts: true,
		});

		const summary = await service.import(
			'user-1',
			'feeds.opml',
			`<?xml version="1.0" encoding="UTF-8"?>
			<opml version="2.0">
				<body>
					<outline text="Engineering">
						<outline text="Frontend">
							<outline text="DevTools Digest" xmlUrl="https://example.com/devtools.xml" />
						</outline>
					</outline>
				</body>
			</opml>`,
		);

		expect(summary.createdCategories).toBe(0);
		expect(summary.createdFeeds).toBe(0);
		expect(summary.warnings).toEqual([
			{
				code: 'IMPORT_FAILED',
				message: 'feed batch failed',
			},
		]);
		expect(categoryRepo.delete).toHaveBeenNthCalledWith(1, 'category-2', 'user-1');
		expect(categoryRepo.delete).toHaveBeenNthCalledWith(2, 'category-1', 'user-1');
	});

	it('rejects malformed OPML documents', () => {
		const service = new OpmlImportService({} as never, {} as never);

		expect(() => service.parse('<opml><body><outline></body>')).toThrowError(AppError);
	});

	it('reports invalid feed URLs without aborting the whole import', async () => {
		const categoryRepo = {
			findAllByUser: vi.fn(async () => []),
			findByName: vi.fn(),
			create: vi.fn(),
			createManyInTransaction: vi.fn(),
		};
		const feedRepo = {
			findByUrl: vi.fn(),
			findByUrls: vi.fn(async () => []),
			create: vi.fn(),
			createMany: vi.fn(),
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
		expect(categoryRepo.createManyInTransaction).not.toHaveBeenCalled();
		expect(feedRepo.createMany).not.toHaveBeenCalled();
	});

	it('rejects private or local feed URLs during import before creating data', async () => {
		const categoryRepo = {
			findAllByUser: vi.fn(async () => []),
			findByName: vi.fn(),
			create: vi.fn(),
			createManyInTransaction: vi.fn(),
		};
		const feedRepo = {
			findByUrl: vi.fn(),
			findByUrls: vi.fn(async () => []),
			create: vi.fn(),
			createMany: vi.fn(),
		};
		const service = new OpmlImportService(categoryRepo as never, feedRepo as never, {
			allowPrivateHosts: false,
		});

		const summary = await service.import(
			'user-1',
			'feeds.opml',
			`<?xml version="1.0" encoding="UTF-8"?>
			<opml version="2.0">
				<body>
					<outline text="Internal">
						<outline text="Localhost" xmlUrl="http://localhost/feed.xml" />
						<outline text="Loopback" xmlUrl="http://127.0.0.1/feed.xml" />
					</outline>
				</body>
			</opml>`,
		);

		expect(summary.createdCategories).toBe(0);
		expect(summary.createdFeeds).toBe(0);
		expect(summary.invalidEntries).toBe(2);
		expect(summary.warnings.map((warning) => warning.code)).toEqual([
			'INVALID_FEED_URL',
			'INVALID_FEED_URL',
		]);
		expect(summary.warnings.map((warning) => warning.message)).toEqual([
			'Feed URL must not target a local or private network host',
			'Feed URL must not target a local or private network host',
		]);
		expect(feedRepo.findByUrls).toHaveBeenCalledWith('user-1', []);
		expect(categoryRepo.createManyInTransaction).not.toHaveBeenCalled();
		expect(feedRepo.createMany).not.toHaveBeenCalled();
	});
});
