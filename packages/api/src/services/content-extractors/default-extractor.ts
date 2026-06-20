import { extractArticleContentFromPage } from '../../utils/sanitizer.js';
import type { ContentExtractor, ExtractedContent } from './types.js';

/**
 * Default content extractor that uses the generic article content extraction logic.
 * This extractor handles any URL and falls back to JSDOM-based content extraction.
 */
export class DefaultContentExtractor implements ContentExtractor {
	/**
	 * Default extractor handles all URLs (it's the fallback).
	 */
	canHandle(_url: string): boolean {
		return true;
	}

	/**
	 * Extract content using the generic article extraction algorithm.
	 */
	async extract(html: string, _url: string): Promise<ExtractedContent | null> {
		const content = extractArticleContentFromPage(html);
		if (!content) {
			return null;
		}
		return { content };
	}
}
