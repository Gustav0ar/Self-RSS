export interface ExtractedContent {
	title?: string;
	content?: string;
	author?: string;
	publishedAt?: Date;
}

/**
 * Content extractor plugin interface.
 * Implement this interface to create site-specific content extraction logic.
 */
export interface ContentExtractor {
	/**
	 * Returns true if this extractor can handle the given URL.
	 */
	canHandle(url: string): boolean;

	/**
	 * Extract structured content from HTML or API response.
	 * Returns extracted content fields, or null if extraction failed.
	 */
	extract(html: string, url: string): Promise<ExtractedContent | null>;
}

/**
 * Registry for managing content extractor plugins.
 */
export interface ContentExtractorRegistry {
	/**
	 * Register a content extractor.
	 */
	register(extractor: ContentExtractor): void;

	/**
	 * Find the first extractor that can handle the given URL.
	 * Returns undefined if no extractor matches.
	 */
	findExtractor(url: string): ContentExtractor | undefined;

	/**
	 * Extract content using the appropriate extractor for the URL.
	 * Falls back to the default extractor if no site-specific extractor matches.
	 */
	extract(url: string, html: string): Promise<ExtractedContent | null>;
}
