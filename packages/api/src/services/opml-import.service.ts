import type { OpmlImportSummary } from '@self-feed/shared';
import { JSDOM } from 'jsdom';
import { AppError } from '../middleware/errors.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';

interface ParsedOpmlFeed {
	feedUrl: string;
	title?: string;
	categoryPath: string[];
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function titleFromUrl(feedUrl: string): string {
	try {
		const url = new URL(feedUrl);
		return url.hostname.replace(/^www\./, '') || feedUrl;
	} catch {
		return feedUrl;
	}
}

function normalizeFeedUrlForImport(rawUrl: string): string {
	let url: URL;
	try {
		url = new URL(rawUrl.trim());
	} catch {
		throw AppError.badRequest('Invalid remote URL');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw AppError.badRequest('Only HTTP and HTTPS feed URLs are allowed');
	}

	if (url.username || url.password) {
		throw AppError.badRequest('Feed URLs must not include credentials');
	}

	if (!url.hostname) {
		throw AppError.badRequest('Remote URL must include a hostname');
	}

	return url.toString();
}

export class OpmlImportService {
	constructor(
		private categoryRepo: CategoryRepository,
		private feedRepo: FeedRepository,
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

			let normalizedFeedUrl: string;
			try {
				normalizedFeedUrl = normalizeFeedUrlForImport(entry.feedUrl);
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

			const existingFeed = await this.feedRepo.findByUrl(userId, normalizedFeedUrl);
			if (existingFeed) {
				summary.skippedDuplicates += 1;
				summary.warnings.push({
					code: 'DUPLICATE_FEED',
					message: 'Feed already subscribed and was skipped',
					feedUrl: normalizedFeedUrl,
					categoryPath: entry.categoryPath,
				});
				continue;
			}

			let categoryId: string | null = null;
			for (const rawName of entry.categoryPath) {
				const name = rawName.trim();
				if (!name) {
					continue;
				}

				const existingCategory = await this.categoryRepo.findByName(userId, name, categoryId);
				if (existingCategory) {
					categoryId = existingCategory.id;
					continue;
				}

				const createdCategory = await this.categoryRepo.create({
					userId,
					name,
					slug: slugify(name),
					parentCategoryId: categoryId,
					sortOrder: 0,
				});
				summary.createdCategories += 1;
				categoryId = createdCategory.id;
			}

			if (!categoryId) {
				summary.invalidEntries += 1;
				summary.warnings.push({
					code: 'UNCATEGORIZED_ENTRY',
					message: 'Feed entry is missing a category path',
					feedUrl: normalizedFeedUrl,
				});
				continue;
			}

			try {
				await this.feedRepo.create({
					userId,
					categoryId,
					feedUrl: normalizedFeedUrl,
					title: entry.title?.trim() || titleFromUrl(normalizedFeedUrl),
					siteUrl: null,
					faviconUrl: null,
					description: null,
				});
				summary.createdFeeds += 1;
			} catch (error) {
				summary.invalidEntries += 1;
				summary.warnings.push({
					code: 'IMPORT_FAILED',
					message: error instanceof Error ? error.message : 'Failed to import feed',
					feedUrl: normalizedFeedUrl,
					categoryPath: entry.categoryPath,
				});
			}
		}

		return summary;
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
