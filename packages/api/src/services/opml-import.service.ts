import type { OpmlImportSummary } from '@self-feed/shared';
import { JSDOM } from 'jsdom';
import { AppError } from '../middleware/errors.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import { uniqueCategorySlug } from '../utils/category-slug.js';
import { assertSafeRemoteUrl } from '../utils/safe-fetch.js';

interface ParsedOpmlFeed {
	feedUrl: string;
	title?: string;
	categoryPath: string[];
}

function titleFromUrl(feedUrl: string): string {
	try {
		const url = new URL(feedUrl);
		return url.hostname.replace(/^www\./, '') || feedUrl;
	} catch {
		return feedUrl;
	}
}

interface OpmlImportConfig {
	allowPrivateHosts: boolean;
}

export class OpmlImportService {
	constructor(
		private categoryRepo: CategoryRepository,
		private feedRepo: FeedRepository,
		private config: OpmlImportConfig = { allowPrivateHosts: false },
	) {}

	async import(userId: string, filename: string, content: string): Promise<OpmlImportSummary> {
		if (!filename.toLowerCase().endsWith('.opml') && !filename.toLowerCase().endsWith('.xml')) {
			throw AppError.badRequest('Invalid OPML file name');
		}

		const feeds = this.parse(content);
		const summary: OpmlImportSummary = {
			createdCategories: 0,
			createdFeeds: 0,
			skippedDuplicates: 0,
			invalidEntries: 0,
			warnings: [],
		};

		const normalizedEntries: ParsedOpmlFeed[] = [];
		const normalizedUrlCache = new Map<string, string>();
		for (const entry of feeds) {
			if (!entry.feedUrl) {
				summary.invalidEntries += 1;
				summary.warnings.push({
					code: 'INVALID_ENTRY',
					message: 'Feed outline is missing xmlUrl',
					categoryPath: entry.categoryPath,
				});
				continue;
			}

			let normalizedFeedUrl = normalizedUrlCache.get(entry.feedUrl);
			try {
				if (!normalizedFeedUrl) {
					normalizedFeedUrl = await assertSafeRemoteUrl(entry.feedUrl.trim(), {
						allowPrivateHosts: this.config.allowPrivateHosts,
					});
					normalizedUrlCache.set(entry.feedUrl, normalizedFeedUrl);
				}
			} catch (error) {
				summary.invalidEntries += 1;
				summary.warnings.push({
					code: 'INVALID_FEED_URL',
					message: error instanceof Error ? error.message : 'Invalid feed URL',
					feedUrl: entry.feedUrl,
					categoryPath: entry.categoryPath,
				});
				continue;
			}

			normalizedEntries.push({ ...entry, feedUrl: normalizedFeedUrl });
		}

		// Pre-fetch the user's existing feed URLs and category tree in one
		// round-trip each. Without this, a 500-entry OPML would issue 1500+
		// individual `findByUrl` / `findByName` calls (1 per category, 1 per
		// feed, plus 1 per feed for the dup check) and run an insert per
		// category and per feed. We build the inserts in memory and let the
		// repository batch them in a single transaction.
		const existingFeedUrls = new Set(
			(
				await this.feedRepo.findByUrls(
					userId,
					normalizedEntries.map((entry) => entry.feedUrl),
				)
			).map((feed) => feed.feedUrl),
		);
		const existingCategories = await this.categoryRepo.findAllByUser(userId);
		const categoryByPath = new Map<string, string>();
		const usedSlugsByParent = new Map<string, Set<string>>();
		for (const cat of existingCategories) {
			categoryByPath.set(this.categoryPathKey(cat.parentCategoryId, cat.name), cat.id);
			this.usedSlugsForParent(usedSlugsByParent, cat.parentCategoryId).add(cat.slug);
		}

		const categoriesToCreate: {
			row: typeof import('../db/schema.js').categories.$inferInsert;
			key: string;
		}[] = [];
		const feedsToCreate: typeof import('../db/schema.js').feeds.$inferInsert[] = [];

		for (const entry of normalizedEntries) {
			if (existingFeedUrls.has(entry.feedUrl)) {
				summary.skippedDuplicates += 1;
				summary.warnings.push({
					code: 'DUPLICATE_FEED',
					message: 'Feed already subscribed and was skipped',
					feedUrl: entry.feedUrl,
					categoryPath: entry.categoryPath,
				});
				continue;
			}
			// Mark the URL as seen so a second entry with the same URL
			// within this import is correctly flagged as a duplicate.
			// Without this, two entries with the same URL would both be
			// queued and the second would either be rejected by the
			// unique constraint or — with onConflictDoNothing — silently
			// dropped without bumping `skippedDuplicates`.
			existingFeedUrls.add(entry.feedUrl);

			// Resolve category chain. We do not insert anything yet: we collect
			// the desired categories and feeds and let the repository batch
			// the writes in a single transaction at the end of the loop.
			let parentCategoryId: string | null = null;
			for (const rawName of entry.categoryPath) {
				const name = rawName.trim();
				if (!name) {
					continue;
				}
				const key = this.categoryPathKey(parentCategoryId, name);
				// Resolve the parent for this segment. We check three sources,
				// in order: a category that already exists in the database
				// (looked up via `findAllByUser`), a category that this
				// import has already queued for insertion in a previous
				// entry, or nothing (in which case we queue a new insert).
				let resolvedId = categoryByPath.get(key);
				if (!resolvedId) {
					const queuedIdx = categoriesToCreate.findIndex((c) => c.key === key);
					if (queuedIdx >= 0) {
						resolvedId = `__pending__:${queuedIdx}`;
					}
				}
				if (resolvedId) {
					parentCategoryId = resolvedId;
					continue;
				}
				const usedSlugs = this.usedSlugsForParent(usedSlugsByParent, parentCategoryId);
				const slug = uniqueCategorySlug(name, usedSlugs);
				usedSlugs.add(slug);

				categoriesToCreate.push({
					key,
					row: {
						userId,
						name,
						slug,
						parentCategoryId,
						sortOrder: 0,
					},
				});
				// We don't know the new id yet, so we resolve the rest of the
				// chain against the queue. For correctness, the actual parent
				// id is patched after the batch insert below.
				parentCategoryId = `__pending__:${categoriesToCreate.length - 1}`;
			}

			if (!parentCategoryId) {
				summary.invalidEntries += 1;
				summary.warnings.push({
					code: 'UNCATEGORIZED_ENTRY',
					message: 'Feed entry is missing a category path',
					feedUrl: entry.feedUrl,
				});
				continue;
			}

			feedsToCreate.push({
				userId,
				// Patched after the category insert below.
				categoryId: parentCategoryId as string,
				feedUrl: entry.feedUrl,
				title: entry.title?.trim() || titleFromUrl(entry.feedUrl),
				siteUrl: null,
				faviconUrl: null,
				description: null,
			});
		}

		// Insert the categories in one transaction. Newly created categories
		// may be parents of other categories in the same batch, so we use a
		// sequential insert helper that returns the new id for each row in
		// order. The caller passes the parent id it has for each row
		// (either a pre-existing id from `categoryByPath` or a placeholder
		// pointing to the queue index of the yet-to-be-inserted parent);
		// the helper rewrites the placeholder to the real id as the batch
		// progresses. If anything fails, the whole transaction rolls back
		// and the partial state is never visible.
		const createdCategoryIdsByQueueIdx: string[] = [];
		if (categoriesToCreate.length > 0) {
			const rowsToInsert = categoriesToCreate.map(({ row }) => row);

			try {
				const insertedRows = await this.categoryRepo.createManyInTransaction(rowsToInsert);
				summary.createdCategories = insertedRows.length;
				for (let i = 0; i < insertedRows.length; i++) {
					const row = insertedRows[i];
					const queued = categoriesToCreate[i];
					if (row && queued) {
						categoryByPath.set(queued.key, row.id);
						createdCategoryIdsByQueueIdx[i] = row.id;
					}
				}
			} catch (error) {
				summary.warnings.push({
					code: 'IMPORT_FAILED',
					message: error instanceof Error ? error.message : 'Failed to import categories',
				});
				return summary;
			}
		}

		// Resolve the pending category placeholders to real ids and insert
		// the feeds in one transaction.
		if (feedsToCreate.length > 0) {
			const rows = feedsToCreate.map((row) => {
				const categoryId = row.categoryId;
				if (typeof categoryId === 'string' && categoryId.startsWith('__pending__:')) {
					const idx = Number.parseInt(categoryId.slice('__pending__:'.length), 10);
					return { ...row, categoryId: createdCategoryIdsByQueueIdx[idx] ?? '' };
				}
				return row;
			});
			const insertable = rows.filter((row) => row.categoryId);
			if (insertable.length > 0) {
				try {
					const inserted = await this.feedRepo.createMany(insertable);
					summary.createdFeeds = inserted.length;
					// Mark the URLs as already-known so the remaining loop
					// (if any) won't try to re-create them.
					for (const row of inserted) {
						existingFeedUrls.add(row.feedUrl);
					}
				} catch (error) {
					const rollback = await this.rollbackCreatedCategories(
						userId,
						createdCategoryIdsByQueueIdx,
					);
					if (rollback.failed.length === 0) {
						summary.createdCategories = 0;
					} else {
						summary.warnings.push({
							code: 'IMPORT_ROLLBACK_FAILED',
							message: `Failed to roll back ${rollback.failed.length} created categories after feed import failure`,
						});
					}
					summary.warnings.push({
						code: 'IMPORT_FAILED',
						message: error instanceof Error ? error.message : 'Failed to import feeds',
					});
				}
			}
		}

		return summary;
	}

	private async rollbackCreatedCategories(userId: string, categoryIds: string[]) {
		const uniqueCategoryIds = Array.from(new Set(categoryIds.filter(Boolean))).reverse();
		const failed: string[] = [];

		for (const categoryId of uniqueCategoryIds) {
			try {
				await this.categoryRepo.delete(categoryId, userId);
			} catch {
				failed.push(categoryId);
			}
		}

		return { attempted: uniqueCategoryIds.length, failed };
	}

	private categoryPathKey(parentCategoryId: string | null, name: string): string {
		return `${parentCategoryId ?? '__root__'}::${name.trim().toLocaleLowerCase()}`;
	}

	private usedSlugsForParent(
		usedSlugsByParent: Map<string, Set<string>>,
		parentCategoryId: string | null,
	) {
		const key = parentCategoryId ?? '__root__';
		const usedSlugs = usedSlugsByParent.get(key) ?? new Set<string>();
		usedSlugsByParent.set(key, usedSlugs);
		return usedSlugs;
	}

	parse(content: string): ParsedOpmlFeed[] {
		let document: Document;
		try {
			document = new JSDOM(content, { contentType: 'text/xml' }).window.document;
		} catch (error) {
			throw AppError.badRequest(
				'Invalid OPML file',
				error instanceof Error ? error.message : String(error),
			);
		}

		const parserErrors = document.getElementsByTagName('parsererror');
		if (parserErrors.length > 0) {
			throw AppError.badRequest('Invalid OPML file');
		}

		const body = document.querySelector('body');
		if (!body) {
			throw AppError.badRequest('Invalid OPML file');
		}

		const entries: ParsedOpmlFeed[] = [];
		for (const node of Array.from(body.children)) {
			if (node.tagName.toLowerCase() !== 'outline') {
				continue;
			}
			entries.push(...this.readOutline(node, []));
		}

		if (entries.length === 0) {
			throw AppError.badRequest('OPML file does not contain any feed entries');
		}

		return entries;
	}

	private readOutline(node: Element, parentPath: string[]): ParsedOpmlFeed[] {
		const text = node.getAttribute('title') ?? node.getAttribute('text') ?? '';
		const xmlUrl = node.getAttribute('xmlUrl') ?? '';
		const currentPath = xmlUrl ? parentPath : [...parentPath, text].filter(Boolean);

		if (xmlUrl) {
			return [
				{
					feedUrl: xmlUrl,
					title: text || undefined,
					categoryPath: parentPath,
				},
			];
		}

		const children = Array.from(node.children).filter(
			(child) => child.tagName.toLowerCase() === 'outline',
		);

		return children.flatMap((child) => this.readOutline(child, currentPath));
	}
}
