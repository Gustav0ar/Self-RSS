import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import { uniqueCategorySlug } from '../utils/category-slug.js';

type CategoryRow = Awaited<ReturnType<CategoryRepository['findAllByUser']>>[number];
type FeedRow = Awaited<ReturnType<FeedRepository['findAllByUser']>>[number];
type SerializedFeed = ReturnType<typeof serializeFeed>;

interface CategoryTreeNode extends Omit<CategoryRow, 'createdAt' | 'updatedAt'> {
	createdAt: string;
	updatedAt: string;
	feedCount: number;
	unreadCount: number;
	feeds: SerializedFeed[];
	children: CategoryTreeNode[];
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
			categories: buildCategoryTree(cats, feedsByCategory, unreadCountByFeedId),
			totalUnread,
		};
	}

	async create(
		userId: string,
		data: { name: string; parentCategoryId?: string | null; sortOrder?: number },
	) {
		const name = data.name.trim();
		if (!name) {
			throw AppError.badRequest('Category name is required');
		}
		const parentCategoryId = data.parentCategoryId ?? null;
		if (data.parentCategoryId) {
			const parent = await this.categoryRepo.findById(data.parentCategoryId, userId);
			if (!parent) throw AppError.notFound('Parent category not found');
		}
		const slug = await this.uniqueSlugForParent(userId, parentCategoryId, name);

		return this.categoryRepo.create({
			userId,
			name,
			slug,
			parentCategoryId,
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
			const wouldCreateCycle = await this.categoryRepo.isDescendant(
				userId,
				categoryId,
				data.parentCategoryId,
			);
			if (wouldCreateCycle) {
				throw AppError.badRequest('Category cannot be moved under one of its descendants.');
			}
		}

		const parentCategoryId =
			data.parentCategoryId !== undefined ? data.parentCategoryId : cat.parentCategoryId;
		const name = data.name !== undefined ? data.name.trim() : cat.name;
		if (!name) {
			throw AppError.badRequest('Category name is required');
		}

		const updates: Record<string, unknown> = {};
		if (data.name !== undefined) {
			updates.name = name;
		}
		if (data.name !== undefined || data.parentCategoryId !== undefined) {
			updates.slug = await this.uniqueSlugForParent(
				userId,
				parentCategoryId ?? null,
				name,
				categoryId,
			);
		}
		if (data.parentCategoryId !== undefined) updates.parentCategoryId = data.parentCategoryId;
		if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

		return this.categoryRepo.update(categoryId, userId, updates);
	}

	async reorder(userId: string, updates: { id: string; sortOrder: number }[]) {
		const uniqueIds = new Set(updates.map((update) => update.id));
		if (uniqueIds.size !== updates.length) {
			throw AppError.badRequest('Category reorder contains duplicate category ids');
		}

		const allCategories = await this.categoryRepo.findAllByUser(userId);
		const byId = new Map(allCategories.map((category) => [category.id, category]));
		const targetCategories = updates.map((update) => byId.get(update.id));
		if (targetCategories.some((category) => !category)) {
			throw AppError.notFound('Category not found');
		}

		const parentId = targetCategories[0]?.parentCategoryId ?? null;
		if (targetCategories.some((category) => (category?.parentCategoryId ?? null) !== parentId)) {
			throw AppError.badRequest('Categories can only be reordered within the same parent');
		}

		const updatedCount = await this.categoryRepo.updateSortOrders(userId, updates);
		return { updatedCount };
	}

	async delete(userId: string, categoryId: string) {
		const cat = await this.categoryRepo.findById(categoryId, userId);
		if (!cat) throw AppError.notFound('Category not found');

		const feedCount = await this.categoryRepo.feedCount(categoryId);
		if (feedCount > 0) {
			throw AppError.badRequest('Cannot delete category with feeds. Move or delete feeds first.');
		}
		const childCount = await this.categoryRepo.childCount(categoryId, userId);
		if (childCount > 0) {
			throw AppError.badRequest(
				'Cannot delete category with subcategories. Move or delete subcategories first.',
			);
		}

		return this.categoryRepo.delete(categoryId, userId);
	}

	private async uniqueSlugForParent(
		userId: string,
		parentCategoryId: string | null,
		name: string,
		excludeCategoryId?: string,
	) {
		const categories = await this.categoryRepo.findAllByUser(userId);
		const normalizedName = name.trim().toLocaleLowerCase();
		const siblings = categories.filter(
			(category) =>
				(category.parentCategoryId ?? null) === parentCategoryId &&
				category.id !== excludeCategoryId,
		);

		const duplicateName = siblings.find(
			(category) => category.name.trim().toLocaleLowerCase() === normalizedName,
		);
		if (duplicateName) {
			throw AppError.conflict('Category already exists in this parent');
		}

		return uniqueCategorySlug(name, new Set(siblings.map((category) => category.slug)));
	}
}

function serializeFeed(feed: FeedRow, unreadCountByFeedId: Map<string, number>) {
	return {
		...feed,
		unreadCount: unreadCountByFeedId.get(feed.id) ?? 0,
		createdAt: feed.createdAt.toISOString(),
		updatedAt: feed.updatedAt.toISOString(),
		lastSyncedAt: feed.lastSyncedAt?.toISOString() ?? null,
		lastSyncErrorAt: feed.lastSyncErrorAt?.toISOString() ?? null,
	};
}

function buildCategoryTree(
	categories: CategoryRow[],
	feedsByCategory: Map<string, FeedRow[]>,
	unreadCountByFeedId: Map<string, number>,
): CategoryTreeNode[] {
	const childrenByParent = new Map<string | null, CategoryRow[]>();
	for (const category of categories) {
		const parentId = category.parentCategoryId ?? null;
		const siblings = childrenByParent.get(parentId) ?? [];
		siblings.push(category);
		childrenByParent.set(parentId, siblings);
	}

	const buildNode = (category: CategoryRow, ancestors: Set<string>): CategoryTreeNode => {
		const directFeeds = (feedsByCategory.get(category.id) ?? []).map((feed) =>
			serializeFeed(feed, unreadCountByFeedId),
		);
		const nextAncestors = new Set(ancestors);
		nextAncestors.add(category.id);
		const children: CategoryTreeNode[] = (childrenByParent.get(category.id) ?? [])
			.filter((child) => !nextAncestors.has(child.id))
			.map((child) => buildNode(child, nextAncestors));

		const directUnreadCount = directFeeds.reduce((count, feed) => count + feed.unreadCount, 0);
		const descendantFeedCount = children.reduce((count, child) => count + child.feedCount, 0);
		const descendantUnreadCount = children.reduce((count, child) => count + child.unreadCount, 0);

		return {
			...category,
			createdAt: category.createdAt.toISOString(),
			updatedAt: category.updatedAt.toISOString(),
			feedCount: directFeeds.length + descendantFeedCount,
			unreadCount: directUnreadCount + descendantUnreadCount,
			feeds: directFeeds,
			children,
		};
	};

	const knownCategoryIds = new Set(categories.map((category) => category.id));
	const roots = categories.filter(
		(category) => !category.parentCategoryId || !knownCategoryIds.has(category.parentCategoryId),
	);
	return roots.map((category) => buildNode(category, new Set()));
}
