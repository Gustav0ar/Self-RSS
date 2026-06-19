import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/middleware/errors.js';
import { CategoryService } from '../../src/services/category.service.js';

function buildCategory(
	overrides: Partial<{ id: string; parentCategoryId: string | null; name: string }> = {},
) {
	return {
		id: 'cat-1',
		userId: 'user-1',
		parentCategoryId: null,
		name: 'Tech',
		slug: 'tech',
		sortOrder: 0,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	};
}

describe('CategoryService - getTree', () => {
	it('returns empty categories with zero counts when the user has no feeds', async () => {
		const categoryRepo = {
			findAllByUser: vi.fn().mockResolvedValue([buildCategory()]),
		};
		const feedRepo = {
			findAllByUser: vi.fn().mockResolvedValue([]),
		};
		const articleRepo = {
			unreadCountByFeed: vi.fn().mockResolvedValue(new Map()),
		};

		const service = new CategoryService(
			categoryRepo as never,
			feedRepo as never,
			articleRepo as never,
		);

		const result = await service.getTree('user-1');

		expect(result.totalUnread).toBe(0);
		expect(result.categories).toHaveLength(1);
		expect(result.categories[0]).toMatchObject({
			feedCount: 0,
			unreadCount: 0,
			feeds: [],
		});
		expect(articleRepo.unreadCountByFeed).toHaveBeenCalledWith('user-1', []);
	});

	it('groups feeds under their category and sums unread counts', async () => {
		const cats = [
			buildCategory({ id: 'cat-tech', name: 'Tech' }),
			buildCategory({ id: 'cat-news', name: 'News' }),
		];
		const now = new Date('2026-01-01T00:00:00.000Z');
		const feeds = [
			{
				id: 'feed-1',
				categoryId: 'cat-tech',
				title: 'Tech Feed',
				createdAt: now,
				updatedAt: now,
				lastSyncedAt: null,
			},
			{
				id: 'feed-2',
				categoryId: 'cat-tech',
				title: 'Another Tech',
				createdAt: now,
				updatedAt: now,
				lastSyncedAt: null,
			},
			{
				id: 'feed-3',
				categoryId: 'cat-news',
				title: 'News Feed',
				createdAt: now,
				updatedAt: now,
				lastSyncedAt: null,
			},
		];
		const unread = new Map<string, number>([
			['feed-1', 3],
			['feed-2', 0],
			['feed-3', 5],
		]);
		const categoryRepo = { findAllByUser: vi.fn().mockResolvedValue(cats) };
		const feedRepo = { findAllByUser: vi.fn().mockResolvedValue(feeds) };
		const articleRepo = { unreadCountByFeed: vi.fn().mockResolvedValue(unread) };

		const service = new CategoryService(
			categoryRepo as never,
			feedRepo as never,
			articleRepo as never,
		);

		const result = await service.getTree('user-1');

		expect(result.totalUnread).toBe(8);
		const tech = result.categories.find((c) => c.id === 'cat-tech');
		const news = result.categories.find((c) => c.id === 'cat-news');
		expect(tech?.feedCount).toBe(2);
		expect(tech?.unreadCount).toBe(3);
		expect(news?.feedCount).toBe(1);
		expect(news?.unreadCount).toBe(5);
	});

	it('returns nested categories with descendant feed and unread totals', async () => {
		const cats = [
			buildCategory({ id: 'cat-tech', name: 'Tech' }),
			buildCategory({ id: 'cat-web', name: 'Web', parentCategoryId: 'cat-tech' }),
			buildCategory({ id: 'cat-react', name: 'React', parentCategoryId: 'cat-web' }),
		];
		const now = new Date('2026-01-01T00:00:00.000Z');
		const feeds = [
			{
				id: 'feed-parent',
				categoryId: 'cat-tech',
				title: 'Tech Feed',
				createdAt: now,
				updatedAt: now,
				lastSyncedAt: null,
			},
			{
				id: 'feed-child',
				categoryId: 'cat-react',
				title: 'React Feed',
				createdAt: now,
				updatedAt: now,
				lastSyncedAt: null,
			},
		];
		const unread = new Map<string, number>([
			['feed-parent', 1],
			['feed-child', 4],
		]);
		const service = new CategoryService(
			{ findAllByUser: vi.fn().mockResolvedValue(cats) } as never,
			{ findAllByUser: vi.fn().mockResolvedValue(feeds) } as never,
			{ unreadCountByFeed: vi.fn().mockResolvedValue(unread) } as never,
		);

		const result = await service.getTree('user-1');

		expect(result.categories).toHaveLength(1);
		expect(result.categories[0]).toMatchObject({
			id: 'cat-tech',
			feedCount: 2,
			unreadCount: 5,
			children: [
				{
					id: 'cat-web',
					feedCount: 1,
					unreadCount: 4,
					children: [{ id: 'cat-react', feedCount: 1, unreadCount: 4 }],
				},
			],
		});
		expect(result.categories[0]?.feeds).toHaveLength(1);
		expect(result.totalUnread).toBe(5);
	});
});

describe('CategoryService - create', () => {
	it('rejects an unknown parent category', async () => {
		const categoryRepo = {
			findById: vi.fn().mockResolvedValue(null),
			create: vi.fn(),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await expect(
			service.create('user-1', { name: 'Sub', parentCategoryId: 'missing' }),
		).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
		expect(categoryRepo.create).not.toHaveBeenCalled();
	});

	it('creates the category with a slug and stores the parent reference', async () => {
		const categoryRepo = {
			findById: vi.fn().mockResolvedValue(buildCategory({ id: 'parent' })),
			create: vi.fn().mockResolvedValue({ id: 'new', name: 'Engineering', slug: 'engineering' }),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await service.create('user-1', {
			name: 'Engineering',
			parentCategoryId: 'parent',
			sortOrder: 4,
		});

		expect(categoryRepo.create).toHaveBeenCalledWith({
			userId: 'user-1',
			name: 'Engineering',
			slug: 'engineering',
			parentCategoryId: 'parent',
			sortOrder: 4,
		});
	});
});

describe('CategoryService - update', () => {
	it('rejects updates for categories the user does not own', async () => {
		const categoryRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await expect(service.update('user-1', 'missing', { name: 'X' })).rejects.toBeInstanceOf(
			AppError,
		);
	});

	it('refuses to make a category its own parent', async () => {
		const categoryRepo = { findById: vi.fn().mockResolvedValue(buildCategory({ id: 'cat-1' })) };
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await expect(
			service.update('user-1', 'cat-1', { parentCategoryId: 'cat-1' }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
	});

	it('refuses to move a category under one of its descendants', async () => {
		const categoryRepo = {
			findById: vi
				.fn()
				.mockResolvedValueOnce(buildCategory({ id: 'cat-1' }))
				.mockResolvedValueOnce(buildCategory({ id: 'cat-child', parentCategoryId: 'cat-1' })),
			isDescendant: vi.fn().mockResolvedValue(true),
			update: vi.fn(),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await expect(
			service.update('user-1', 'cat-1', { parentCategoryId: 'cat-child' }),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			statusCode: 400,
			message: 'Category cannot be moved under one of its descendants.',
		});
		expect(categoryRepo.update).not.toHaveBeenCalled();
	});

	it('recomputes the slug when the name changes', async () => {
		const categoryRepo = {
			findById: vi.fn().mockResolvedValue(buildCategory({ id: 'cat-1', name: 'Old' })),
			update: vi.fn().mockResolvedValue({ id: 'cat-1', name: 'New Name' }),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await service.update('user-1', 'cat-1', { name: 'New Name' });

		expect(categoryRepo.update).toHaveBeenCalledWith(
			'cat-1',
			'user-1',
			expect.objectContaining({ name: 'New Name', slug: 'new-name' }),
		);
	});
});

describe('CategoryService - delete', () => {
	it('rejects deletion when feeds still reference the category', async () => {
		const categoryRepo = {
			findById: vi.fn().mockResolvedValue(buildCategory({ id: 'cat-1' })),
			feedCount: vi.fn().mockResolvedValue(3),
			childCount: vi.fn(),
			delete: vi.fn(),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await expect(service.delete('user-1', 'cat-1')).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			statusCode: 400,
			message: 'Cannot delete category with feeds. Move or delete feeds first.',
		});
		expect(categoryRepo.delete).not.toHaveBeenCalled();
	});

	it('rejects deletion when child categories still reference the category', async () => {
		const categoryRepo = {
			findById: vi.fn().mockResolvedValue(buildCategory({ id: 'cat-1' })),
			feedCount: vi.fn().mockResolvedValue(0),
			childCount: vi.fn().mockResolvedValue(1),
			delete: vi.fn(),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await expect(service.delete('user-1', 'cat-1')).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			statusCode: 400,
			message: 'Cannot delete category with subcategories. Move or delete subcategories first.',
		});
		expect(categoryRepo.delete).not.toHaveBeenCalled();
	});

	it('deletes when the category has no feeds', async () => {
		const categoryRepo = {
			findById: vi.fn().mockResolvedValue(buildCategory({ id: 'cat-1' })),
			feedCount: vi.fn().mockResolvedValue(0),
			childCount: vi.fn().mockResolvedValue(0),
			delete: vi.fn().mockResolvedValue(undefined),
		};
		const service = new CategoryService(categoryRepo as never, {} as never, {} as never);

		await service.delete('user-1', 'cat-1');
		expect(categoryRepo.delete).toHaveBeenCalledWith('cat-1', 'user-1');
	});
});
