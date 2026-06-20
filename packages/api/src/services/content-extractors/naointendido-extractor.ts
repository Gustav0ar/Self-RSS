import type { ContentExtractor, ExtractedContent } from './types.js';

interface NaointendoPost {
	media?: {
		type: 'image' | 'twitter' | 'html' | 'video' | string;
		content?: string;
	};
	description?: string;
}

interface NaointendoApiResponse {
	post?: NaointendoPost;
}

const POST_SLUG_REGEX = /\/posts\/([a-zA-Z0-9_-]+)/;
const BASE_URL = 'https://www.naointendo.com.br';

/**
 * Site-specific content extractor for naointendido.com.br.
 * Uses the site's internal API to fetch structured post content.
 */
export class NaointendidoContentExtractor implements ContentExtractor {
	private readonly fetch: typeof globalThis.fetch;
	private readonly allowPrivateHosts: boolean;

	constructor(options?: { fetch?: typeof globalThis.fetch; allowPrivateHosts?: boolean }) {
		this.fetch = options?.fetch ?? globalThis.fetch;
		this.allowPrivateHosts = options?.allowPrivateHosts ?? false;
	}

	/**
	 * Checks if the URL is a naointendido.com.br or naointendo.com.br post page.
	 */
	canHandle(url: string): boolean {
		return url.includes('naointendido.com.br/posts/') || url.includes('naointendo.com.br/posts/');
	}

	/**
	 * Extract content from naointenido.com.br using their internal API.
	 * The API returns structured post data including media and description.
	 */
	async extract(_html: string, url: string): Promise<ExtractedContent | null> {
		const match = url.match(POST_SLUG_REGEX);
		if (!match) {
			return null;
		}

		const slug = match[1];
		const apiUrl = `${BASE_URL}/api/posts/${slug}`;

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

			const data: NaointendoApiResponse = await response.json();
			const post = data?.post;

			if (!post) {
				return null;
			}

			const content = this.reconstructHtml(post);
			if (!content) {
				return null;
			}

			return { content };
		} catch {
			// API fetch failed, fall back to generic extraction
			return null;
		}
	}

	/**
	 * Reconstruct HTML from the structured post data.
	 */
	private reconstructHtml(post: NaointendoPost): string | null {
		let reconstructedHtml = '';

		if (post.media) {
			const media = post.media;
			if (media.type === 'image') {
				reconstructedHtml += `<img src="${media.content ?? ''}" />`;
			} else if (media.type === 'twitter') {
				reconstructedHtml += `<iframe class="embedded-media embedded-media--x" src="https://platform.twitter.com/embed/Tweet.html?id=${media.content ?? ''}"></iframe>`;
			} else if (media.type === 'html') {
				reconstructedHtml += media.content ?? '';
			} else if (media.type === 'video') {
				reconstructedHtml += `<video src="${media.content ?? ''}" controls></video>`;
			} else {
				reconstructedHtml += media.content ?? '';
			}
		}

		if (post.description && typeof post.description === 'string') {
			reconstructedHtml += post.description;
		}

		return reconstructedHtml || null;
	}
}
