import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';

interface ExportCategory {
	id: string;
	parentCategoryId: string | null;
	name: string;
}

interface ExportFeed {
	categoryId: string | null;
	title: string;
	feedUrl: string;
	siteUrl: string | null;
}

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export class OpmlExportService {
	constructor(
		private categoryRepo: CategoryRepository,
		private feedRepo: FeedRepository,
	) {}

	async export(userId: string) {
		const [categories, feeds] = await Promise.all([
			this.categoryRepo.findAllByUser(userId),
			this.feedRepo.findAllByUser(userId),
		]);

		const categoryGroups = new Map<string | null, ExportCategory[]>();
		for (const category of categories) {
			const key = category.parentCategoryId;
			const siblings = categoryGroups.get(key) ?? [];
			siblings.push(category);
			categoryGroups.set(key, siblings);
		}

		const feedGroups = new Map<string | null, ExportFeed[]>();
		for (const feed of feeds) {
			const siblings = feedGroups.get(feed.categoryId) ?? [];
			siblings.push(feed);
			feedGroups.set(feed.categoryId, siblings);
		}

		const outlines = [
			...this.renderCategoryGroup(null, categoryGroups, feedGroups, 2),
			...this.renderFeedGroup(feedGroups.get(null) ?? [], 2),
		];

		const createdAt = new Date().toUTCString();
		const body = outlines.length > 0 ? `${outlines.join('\n')}\n` : '';

		return {
			filename: `self-feed-feeds-${new Date().toISOString().slice(0, 10)}.opml`,
			content:
				`<?xml version="1.0" encoding="UTF-8"?>\n` +
				`<opml version="2.0">\n` +
				`  <head>\n` +
				`    <title>SelfFeed Feeds</title>\n` +
				`    <dateCreated>${escapeXml(createdAt)}</dateCreated>\n` +
				`  </head>\n` +
				`  <body>\n` +
				body +
				`  </body>\n` +
				`</opml>\n`,
		};
	}

	private renderCategoryGroup(
		parentCategoryId: string | null,
		categoryGroups: Map<string | null, ExportCategory[]>,
		feedGroups: Map<string | null, ExportFeed[]>,
		depth: number,
	): string[] {
		const categories = categoryGroups.get(parentCategoryId) ?? [];
		return categories.flatMap((category) =>
			this.renderCategory(category, categoryGroups, feedGroups, depth),
		);
	}

	private renderCategory(
		category: ExportCategory,
		categoryGroups: Map<string | null, ExportCategory[]>,
		feedGroups: Map<string | null, ExportFeed[]>,
		depth: number,
	): string[] {
		const indentation = '  '.repeat(depth);
		const nestedLines = [
			...this.renderCategoryGroup(category.id, categoryGroups, feedGroups, depth + 1),
			...this.renderFeedGroup(feedGroups.get(category.id) ?? [], depth + 1),
		];

		if (nestedLines.length === 0) {
			return [
				`${indentation}<outline text="${escapeXml(category.name)}" title="${escapeXml(category.name)}" />`,
			];
		}

		return [
			`${indentation}<outline text="${escapeXml(category.name)}" title="${escapeXml(category.name)}">`,
			...nestedLines,
			`${indentation}</outline>`,
		];
	}

	private renderFeedGroup(feeds: ExportFeed[], depth: number) {
		const indentation = '  '.repeat(depth);
		return feeds.map((feed) => {
			const title = escapeXml(feed.title);
			const xmlUrl = escapeXml(feed.feedUrl);
			const htmlUrl = feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : '';
			return `${indentation}<outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}"${htmlUrl} />`;
		});
	}
}
