import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export class CategoryService {
	constructor(
		private categoryRepo: CategoryRepository,
		private feedRepo: FeedRepository,
		private articleRepo: ArticleRepository,
	) {}

	async getTree(userId: string) {
		// Fetch categories and feeds in parallel, then issue the unread-count
		// query as soon as the feed ids are known. This removes the serial
		// chain that previously dominated the category tree endpoint.
		const [cats, allFeeds] = await Promise.all([
			this.categoryRepo.findAllByUser(userId),
			this.feedRepo.findAllByUser(userId),
		]);

		const unreadCountByFeedId = await this.articleRepo.unreadCountByFeed(
			userId,
			allFeeds.map((f) => f.id),
		);

		const feedsByCategory = new Map<string, typeof allFeeds>();
		for (const feed of allFeeds) {
			const list = feedsByCategory.get(feed.categoryId) ?? [];
			list.push(feed);
			feedsByCategory.set(feed.categoryId, list);
		}

		const totalUnread = Array.from(unreadCountByFeedId.values()).reduce((a, b) => a + b, 0);

		return {
			categories: cats.map((cat) => {
				const catFeeds = feedsByCategory.get(cat.id) ?? [];
				const unreadCount = catFeeds.reduce(
					(acc, f) => acc + (unreadCountByFeedId.get(f.id) ?? 0),
					0,
				);

				return {
					...cat,
					createdAt: cat.createdAt.toISOString(),
					updatedAt: cat.updatedAt.toISOString(),
					feedCount: catFeeds.length,
					unreadCount,
					feeds: catFeeds.map((f) => ({
						...f,
						unreadCount: unreadCountByFeedId.get(f.id) ?? 0,
						createdAt: f.createdAt.toISOString(),
						updatedAt: f.updatedAt.toISOString(),
						lastSyncedAt: f.lastSyncedAt?.toISOString() ?? null,
					})),
				};
			}),
			totalUnread,
		};
	}

	async create(
		userId: string,
		data: { name: string; parentCategoryId?: string | null; sortOrder?: number },
	) {
		const slug = slugify(data.name);
		if (data.parentCategoryId) {
			const parent = await this.categoryRepo.findById(data.parentCategoryId, userId);
			if (!parent) throw AppError.notFound('Parent category not found');
		}
		return this.categoryRepo.create({
			userId,
			name: data.name,
			slug,
			parentCategoryId: data.parentCategoryId ?? null,
			sortOrder: data.sortOrder ?? 0,
		});
	}

	async update(
		userId: string,
		categoryId: string,
		data: { name?: string; parentCategoryId?: string | null; sortOrder?: number },
	) {
		const cat = await this.categoryRepo.findById(categoryId, userId);
		if (!cat) throw AppError.notFound('Category not found');

		if (data.parentCategoryId === categoryId) {
			throw AppError.badRequest('Category cannot be its own parent');
		}
		if (data.parentCategoryId) {
			const parent = await this.categoryRepo.findById(data.parentCategoryId, userId);
			if (!parent) throw AppError.notFound('Parent category not found');
		}

		const updates: Record<string, unknown> = {};
		if (data.name !== undefined) {
			updates.name = data.name;
			updates.slug = slugify(data.name);
		}
		if (data.parentCategoryId !== undefined) updates.parentCategoryId = data.parentCategoryId;
		if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

		return this.categoryRepo.update(categoryId, userId, updates);
	}

	async delete(userId: string, categoryId: string) {
		const cat = await this.categoryRepo.findById(categoryId, userId);
		if (!cat) throw AppError.notFound('Category not found');

		const feedCount = await this.categoryRepo.feedCount(categoryId);
		if (feedCount > 0) {
			throw AppError.badRequest('Cannot delete category with feeds. Move or delete feeds first.');
		}

		return this.categoryRepo.delete(categoryId, userId);
	}
}
