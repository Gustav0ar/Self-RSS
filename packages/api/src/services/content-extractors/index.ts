import { DefaultContentExtractor } from './default-extractor.js';
import { NaointendidoContentExtractor } from './naointendido-extractor.js';
import type { ContentExtractor, ContentExtractorRegistry, ExtractedContent } from './types.js';

export type { ContentExtractor, ContentExtractorRegistry, ExtractedContent };

/**
 * Creates a content extractor registry with the built-in extractors.
 * Extractors are checked in registration order; the first match wins.
 */
export function createExtractorRegistry(): ContentExtractorRegistry {
	const extractors: ContentExtractor[] = [
		// Site-specific extractors first (higher priority)
		new NaointendidoContentExtractor(),
		// Default fallback last
		new DefaultContentExtractor(),
	];

	return {
		register(extractor: ContentExtractor): void {
			// Insert before the default extractor (assumes default is always last)
			extractors.splice(extractors.length - 1, 0, extractor);
		},

		findExtractor(url: string): ContentExtractor | undefined {
			return extractors.find((extractor) => extractor.canHandle(url));
		},

		async extract(url: string, html: string): Promise<ExtractedContent | null> {
			const extractor = this.findExtractor(url);
			if (!extractor) {
				return null;
			}
			return extractor.extract(html, url);
		},
	};
}

// Re-export extractors for testing and direct usage
export { DefaultContentExtractor, NaointendidoContentExtractor };
