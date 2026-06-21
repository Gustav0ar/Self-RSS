import {
	buildNaointendidoApiUrl,
	canHandleNaointendidoPostUrl,
	parseNaointendidoPost,
	reconstructNaointendidoPostHtml,
} from './naointendido-post.js';
import type { ContentExtractor, ExtractedContent } from './types.js';

/**
 * Site-specific content extractor for naointendido.com.br.
 * Uses the site's internal API to fetch structured post content.
 */
export class NaointendidoContentExtractor implements ContentExtractor {
	private readonly fetch: typeof globalThis.fetch;

	constructor(options?: { fetch?: typeof globalThis.fetch }) {
		this.fetch = options?.fetch ?? globalThis.fetch;
	}

	/**
	 * Checks if the URL is a naointendido.com.br or naointendo.com.br post page.
	 */
	canHandle(url: string): boolean {
		return canHandleNaointendidoPostUrl(url);
	}

	/**
	 * Extract content from naointenido.com.br using their internal API.
	 * The API returns structured post data including media and description.
	 */
	async extract(_html: string, url: string): Promise<ExtractedContent | null> {
		const apiUrl = buildNaointendidoApiUrl(url);
		if (!apiUrl) return null;

		try {
			const response = await this.fetch(apiUrl, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					Accept: 'application/json',
					'X-Requested-With': 'XMLHttpRequest',
				},
			});

			if (!response.ok) {
				return null;
			}

			const post = parseNaointendidoPost(await response.json());
			if (!post) {
				return null;
			}

			const content = reconstructNaointendidoPostHtml(post);
			if (!content) {
				return null;
			}

			return { content };
		} catch {
			// API fetch failed, fall back to generic extraction
			return null;
		}
	}
}
