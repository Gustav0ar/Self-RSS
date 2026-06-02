import type { OpmlImportSummary } from '@self-feed/shared';
import { JSDOM } from 'jsdom';
import { AppError } from '../middleware/errors.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { FeedService } from './feed.service.js';

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

export class OpmlImportService {
	constructor(
		private categoryRepo: CategoryRepository,
		private feedRepo: FeedRepository,
		private feedService: FeedService,
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
					feedUrl: entry.feedUrl,
				});
				continue;
			}

			const normalizedFeedUrl = await this.feedService.normalizeFeedUrl(entry.feedUrl);
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

			try {
				await this.feedService.create(userId, {
					categoryId,
					feedUrl: normalizedFeedUrl,
					title: entry.title?.trim() || undefined,
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
